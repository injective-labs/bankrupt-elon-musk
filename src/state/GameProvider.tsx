"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as defaultApi from "@/client/gameApi";
import type { MessageSigner, SessionView, TradeInput, TransactionPage } from "@/client/gameApi";
import { ALL_SUBCATEGORY } from "@/data/categories";
import { isSettlementLocked } from "@/game/marketClock";
import type { AccountProjection, GameState, LeaderboardSnapshot, Locale, MarketProjection, SortMode, TradeReceipt } from "@/types";
import { applyTradeReceipt } from "./applyReceipt";

export interface GameApi {
  getSession(): Promise<SessionView | null>;
  getMarket(): Promise<MarketProjection>;
  loginWithSignature(address: string, walletName: string | null, signer: MessageSigner): Promise<SessionView>;
  logout(): Promise<void>;
  getGame(): Promise<AccountProjection>;
  submitTrade(command: TradeInput): Promise<TradeReceipt | AccountProjection>;
  resetGame(idempotencyKey: string): Promise<AccountProjection>;
  getTransactions(cursor?: string, limit?: number): Promise<TransactionPage>;
  getLeaderboard(): Promise<LeaderboardSnapshot>;
}

export type AuthStatus = "loading" | "locked" | "authenticated" | "expired";
type PendingCommand = "login" | "logout" | "trade" | "reset" | "refresh";
export interface PendingOperation {
  kind: PendingCommand;
  assetId?: string;
  side?: "BUY" | "SELL";
}
export interface OperationFeedback extends PendingOperation {
  id: number;
  status: "success" | "error";
  code?: string;
  quantity?: string;
  usdAmount?: string;
}

interface Preferences { locale: Locale; sound: boolean; selectedCategory: string; selectedSubcategory: string; search: string; sort: SortMode }
const initialPreferences: Preferences = { locale: "zh", sound: true, selectedCategory: "全部", selectedSubcategory: ALL_SUBCATEGORY, search: "", sort: "price-asc" };

function projectionState(preferences: Preferences): GameState {
  return {
    locale: preferences.locale,
    selectedCategory: preferences.selectedCategory,
    selectedSubcategory: preferences.selectedSubcategory,
    search: preferences.search,
    sort: preferences.sort,
    sound: preferences.sound,
  };
}

function idempotencyKey(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (digit) => (Number(digit) ^ Math.floor(Math.random() * 16) >> Number(digit) / 4).toString(16));
}

function errorInfo(error: unknown): { code: string; expired: boolean } {
  if (error && typeof error === "object") {
    const value = error as { status?: unknown; code?: unknown; message?: unknown };
    return { code: typeof value.code === "string" ? value.code : error instanceof Error ? error.message : "REQUEST_FAILED", expired: value.status === 401 };
  }
  return { code: String(error), expired: false };
}

export interface GameActions {
  login(address: string, walletName: string | null, signer: MessageSigner): Promise<boolean>;
  logout(): Promise<boolean>;
  buy(id: string): Promise<void>; buyQty(id: string, quantity: string): Promise<void>; buyMax(id: string): Promise<void>;
  sell(id: string): Promise<void>; sellQty(id: string, quantity: string): Promise<void>; sellAll(id: string): Promise<void>;
  reset(): Promise<void>; refreshPricesNow(): Promise<void>; retryMarket(): Promise<void>;
  dismissFeedback(): void;
  toggleSound(): void; toggleLocale(): void; setCategory(category: string): void; setSubcategory(subcategory: string): void; setSearch(search: string): void; setSort(sort: SortMode): void; focusProduct(id: string): void;
}

interface GameContextValue { authStatus: AuthStatus; account: AccountProjection | null; market: MarketProjection | null; marketStatus: "loading" | "loaded" | "error"; marketError: boolean; clockNow: Date; tradingLocked: boolean; leaderboard: LeaderboardSnapshot | null; leaderboardStatus: "idle" | "loading" | "loaded" | "error"; leaderboardError: boolean; state: GameState; actions: GameActions; pendingCommand: PendingCommand | null; pendingOperation: PendingOperation | null; feedback: OperationFeedback | null; lastError: string | null; focusedProductId: string | null; flashTick: number; ready: boolean }
const GameContext = createContext<GameContextValue | null>(null);
export function useGame() { const value = useContext(GameContext); if (!value) throw new Error("useGame must be used within GameProvider"); return value; }

export function GameProvider({ children, api = defaultApi }: { children: ReactNode; api?: GameApi }) {
  const [authStatus, setAuthStatus] = useState<AuthStatus>("loading");
  const [account, setAccount] = useState<AccountProjection | null>(null);
  const [market, setMarket] = useState<MarketProjection | null>(null);
  const [marketStatus, setMarketStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [marketError, setMarketError] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardSnapshot | null>(null);
  const [leaderboardError, setLeaderboardError] = useState(false);
  const [leaderboardStatus, setLeaderboardStatus] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const [clockNow, setClockNow] = useState(() => new Date());
  const [preferences, setPreferences] = useState(initialPreferences);
  const [pendingCommand, setPendingCommand] = useState<PendingCommand | null>(null);
  const [pendingOperation, setPendingOperation] = useState<PendingOperation | null>(null);
  const [feedback, setFeedback] = useState<OperationFeedback | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [focusedProductId, setFocusedProductId] = useState<string | null>(null);
  const epochRef = useRef(0);
  const mountedRef = useRef(true);
  const pendingRef = useRef<{ kind: PendingCommand; epoch: number } | null>(null);
  const authTransitionRef = useRef<symbol | null>(null);
  const marketRequestRef = useRef(0);
  const feedbackIdRef = useRef(0);

  const fail = useCallback((error: unknown, epoch: number, operation?: PendingOperation) => {
    if (!mountedRef.current || epoch !== epochRef.current) return;
    const info = errorInfo(error);
    setLastError(info.code);
    if (operation) setFeedback({ ...operation, id: ++feedbackIdRef.current, status: "error", code: info.code });
    if (info.expired) {
      epochRef.current += 1;
      pendingRef.current = null;
      setPendingCommand(null);
      setPendingOperation(null);
      setAccount(null);
      setAuthStatus("expired");
    }
  }, []);

  const loadGame = useCallback(async (epoch: number) => {
    const next = await api.getGame();
    if (!mountedRef.current || epoch !== epochRef.current) return;
    setAccount(next);
    setMarket({ assets: next.assets, marketAsOf: next.marketAsOf });
    setMarketStatus("loaded");
    setMarketError(false);
    setAuthStatus("authenticated");
  }, [api]);

  const loadMarket = useCallback(async () => {
    const request = ++marketRequestRef.current;
    setMarketStatus("loading");
    setMarketError(false);
    try {
      const next = await api.getMarket();
      if (!mountedRef.current || request !== marketRequestRef.current) return;
      setMarket(next);
      setMarketStatus("loaded");
    } catch {
      if (!mountedRef.current || request !== marketRequestRef.current) return;
      setMarketError(true);
      setMarketStatus("error");
    }
  }, [api]);

  useEffect(() => {
    mountedRef.current = true;
    void loadMarket();
    const epoch = epochRef.current;
    void api.getSession().then(async (session) => {
      if (!mountedRef.current || epoch !== epochRef.current) return;
      if (!session) { setAuthStatus("locked"); return; }
      try { await loadGame(epoch); }
      catch (error) { if (mountedRef.current && epoch === epochRef.current) { fail(error, epoch); if (!errorInfo(error).expired) setAuthStatus("locked"); } }
    }).catch((error) => { if (mountedRef.current && epoch === epochRef.current) { fail(error, epoch); setAuthStatus("locked"); } });
    return () => { mountedRef.current = false; epochRef.current += 1; pendingRef.current = null; authTransitionRef.current = null; };
  }, [api, fail, loadGame, loadMarket]);

  const command = useCallback(async (kind: PendingCommand, run: () => Promise<AccountProjection>) => {
    if (!account || pendingRef.current) return;
    const token = { kind, epoch: epochRef.current };
    const operation: PendingOperation = { kind };
    pendingRef.current = token;
    setPendingCommand(kind); setPendingOperation(operation); setLastError(null);
    try {
      const next = await run();
      if (mountedRef.current && token.epoch === epochRef.current) {
        setAccount(next);
        setFeedback({ ...operation, id: ++feedbackIdRef.current, status: "success" });
      }
    } catch (error) { fail(error, token.epoch, operation); }
    finally { if (pendingRef.current === token) { pendingRef.current = null; setPendingCommand(null); setPendingOperation(null); } }
  }, [account, fail]);
  const trade = useCallback(async (assetId: string, side: "BUY" | "SELL", quantity: string | "MAX") => {
    if (!account || !market || pendingRef.current) return;
    const token = { kind: "trade" as const, epoch: epochRef.current };
    const operation: PendingOperation = { kind: "trade", assetId, side };
    pendingRef.current = token;
    setPendingCommand("trade"); setPendingOperation(operation); setLastError(null);
    try {
      const result = await api.submitTrade({ assetId, side, quantity, idempotencyKey: idempotencyKey() });
      if (mountedRef.current && token.epoch === epochRef.current) {
        if ("walletAddress" in result) setAccount(result);
        else setAccount((current) => current ? applyTradeReceipt(current, market, result) : current);
        setFeedback({
          ...operation,
          id: ++feedbackIdRef.current,
          status: "success",
          quantity: "walletAddress" in result ? quantity : result.quantity,
          usdAmount: "walletAddress" in result ? undefined : result.usdAmount,
        });
      }
    } catch (error) { fail(error, token.epoch, operation); }
    finally { if (pendingRef.current === token) { pendingRef.current = null; setPendingCommand(null); setPendingOperation(null); } }
  }, [account, api, fail, market]);
  const explicitQuantity = useCallback((assetId: string, side: "BUY" | "SELL", value: string) => {
    if (!/^[1-9]\d*$/.test(value)) { setLastError("INVALID_QUANTITY"); return Promise.resolve(); }
    return trade(assetId, side, value);
  }, [trade]);
  const dismissFeedback = useCallback(() => setFeedback(null), []);

  const actions = useMemo<GameActions>(() => ({
    login: async (address, walletName, signer) => {
      if (authTransitionRef.current) throw Object.assign(new Error("Authentication transition already pending"), { code: "AUTH_TRANSITION_PENDING" });
      const transition = Symbol("login");
      authTransitionRef.current = transition;
      const epoch = ++epochRef.current;
      pendingRef.current = { kind: "login", epoch };
      setPendingCommand("login"); setPendingOperation({ kind: "login" }); setLastError(null); setAccount(null); setAuthStatus("loading");
      const token = pendingRef.current;
      try { await api.loginWithSignature(address, walletName, signer); await loadGame(epoch); if (epoch === epochRef.current) setFeedback({ kind: "login", id: ++feedbackIdRef.current, status: "success" }); return epoch === epochRef.current; }
      catch (error) { if (epoch === epochRef.current) { fail(error, epoch, { kind: "login" }); if (!errorInfo(error).expired) setAuthStatus("locked"); } return false; }
      finally { if (authTransitionRef.current === transition) authTransitionRef.current = null; if (pendingRef.current === token) { pendingRef.current = null; setPendingCommand(null); setPendingOperation(null); } }
    },
    logout: async () => {
      if (authTransitionRef.current) throw Object.assign(new Error("Authentication transition already pending"), { code: "AUTH_TRANSITION_PENDING" });
      const transition = Symbol("logout");
      authTransitionRef.current = transition;
      const epoch = ++epochRef.current;
      pendingRef.current = { kind: "logout", epoch };
      setPendingCommand("logout"); setPendingOperation({ kind: "logout" }); setLastError(null);
      const token = pendingRef.current;
      try { await api.logout(); if (epoch === epochRef.current) { setAccount(null); setAuthStatus("locked"); setFeedback({ kind: "logout", id: ++feedbackIdRef.current, status: "success" }); } return true; }
      catch (error) { if (epoch === epochRef.current) fail(error, epoch, { kind: "logout" }); return false; }
      finally { if (authTransitionRef.current === transition) authTransitionRef.current = null; if (pendingRef.current === token) { pendingRef.current = null; setPendingCommand(null); setPendingOperation(null); } }
    },
    buy: (id) => explicitQuantity(id, "BUY", "1"), buyQty: (id, amount) => explicitQuantity(id, "BUY", amount),
    buyMax: (id) => trade(id, "BUY", "MAX"),
    sell: (id) => explicitQuantity(id, "SELL", "1"), sellQty: (id, amount) => explicitQuantity(id, "SELL", amount), sellAll: (id) => trade(id, "SELL", "MAX"),
    reset: () => command("reset", () => api.resetGame(idempotencyKey())), refreshPricesNow: () => command("refresh", api.getGame), retryMarket: loadMarket,
    dismissFeedback,
    toggleSound: () => setPreferences((p) => ({ ...p, sound: !p.sound })), toggleLocale: () => setPreferences((p) => ({ ...p, locale: p.locale === "zh" ? "en" : "zh" })),
    setCategory: (selectedCategory) => setPreferences((p) => ({ ...p, selectedCategory, selectedSubcategory: ALL_SUBCATEGORY })), setSubcategory: (selectedSubcategory) => setPreferences((p) => ({ ...p, selectedSubcategory })), setSearch: (search) => setPreferences((p) => ({ ...p, search })), setSort: (sort) => setPreferences((p) => ({ ...p, sort })),
    focusProduct: (id) => { setFocusedProductId(id); requestAnimationFrame(() => document.querySelector(`[data-product-id="${id}"]`)?.scrollIntoView?.({ block: "center" })); },
  }), [api, command, dismissFeedback, explicitQuantity, fail, loadGame, loadMarket, trade]);

  const state = useMemo(() => projectionState(preferences), [preferences]);
  useEffect(() => { const update = () => setClockNow(new Date()); update(); const id = setInterval(update, 1000); return () => clearInterval(id); }, []);
  const tradingLocked = isSettlementLocked(clockNow);
  useEffect(() => {
    if (authStatus !== "authenticated") { setLeaderboard(null); setLeaderboardError(false); setLeaderboardStatus("idle"); return; }
    let active = true;
    setLeaderboardError(false); setLeaderboardStatus("loading");
    void Promise.resolve(api.getLeaderboard()).then((value) => { if (active && value) { setLeaderboard(value); setLeaderboardStatus("loaded"); } }).catch(() => { if (active) { setLeaderboard(null); setLeaderboardError(true); setLeaderboardStatus("error"); } });
    return () => { active = false; };
  }, [api, authStatus, account?.updatedAt]);
  return <GameContext.Provider value={{ authStatus, account, market, marketStatus, marketError, clockNow, tradingLocked, leaderboard, leaderboardStatus, leaderboardError, state, actions, pendingCommand, pendingOperation, feedback, lastError, focusedProductId, flashTick: feedback?.id ?? 0, ready: authStatus !== "loading" }}>{children}</GameContext.Provider>;
}
