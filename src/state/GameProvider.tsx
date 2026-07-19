"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import * as defaultApi from "@/client/gameApi";
import type { MessageSigner, SessionView, TradeInput, TransactionPage } from "@/client/gameApi";
import { ALL_SUBCATEGORY } from "@/data/categories";
import type { AccountProjection, GameState, LeaderboardSnapshot, Locale, SortMode } from "@/types";

export interface GameApi {
  getSession(): Promise<SessionView | null>;
  loginWithSignature(address: string, walletName: string | null, signer: MessageSigner): Promise<SessionView>;
  logout(): Promise<void>;
  getGame(): Promise<AccountProjection>;
  submitTrade(command: TradeInput): Promise<AccountProjection>;
  resetGame(idempotencyKey: string): Promise<AccountProjection>;
  getTransactions(cursor?: string, limit?: number): Promise<TransactionPage>;
  getLeaderboard(): Promise<LeaderboardSnapshot>;
}

export type AuthStatus = "loading" | "locked" | "authenticated" | "expired";
type PendingCommand = "login" | "logout" | "trade" | "reset" | "refresh";

interface Preferences { locale: Locale; sound: boolean; selectedCategory: string; selectedSubcategory: string; search: string; sort: SortMode; leverage: number }
const initialPreferences: Preferences = { locale: "zh", sound: true, selectedCategory: "全部", selectedSubcategory: ALL_SUBCATEGORY, search: "", sort: "price-asc", leverage: 1 };

function projectionState(account: AccountProjection | null, preferences: Preferences): GameState {
  const positions = account?.positions ?? [];
  const assets = account?.assets ?? [];
  return {
    inventory: Object.fromEntries(positions.map((position) => [position.assetId, { quantity: Number(position.quantity), costBasis: Number(position.costBasis) }])),
    cash: account ? Number(account.cash) : 0,
    debt: 0,
    accruedInterest: 0,
    lastInterestAccruedAt: 0,
    liquidated: false,
    leverage: preferences.leverage,
    prices: Object.fromEntries(assets.filter((asset) => asset.usdPrice !== null).map((asset) => [asset.id, { nativePrice: Number(asset.usdPrice), usdPrice: Number(asset.usdPrice), currency: asset.currency, closeDate: asset.marketDate ?? "", source: "server", updatedAt: account?.updatedAt ?? "" }])),
    fxRates: { USD: 1 },
    lastPriceRefresh: account?.marketAsOf ?? null,
    locale: preferences.locale,
    log: [],
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
  login(address: string, walletName: string | null, signer: MessageSigner): Promise<void>;
  logout(): Promise<void>;
  buy(id: string): Promise<void>; buyQty(id: string, quantity: number): Promise<void>; buyMax(id: string): Promise<void>;
  sell(id: string): Promise<void>; sellQty(id: string, quantity: number): Promise<void>; sellAll(id: string): Promise<void>;
  reset(): Promise<void>; refreshPricesNow(): Promise<void>;
  setLeverage(value: number): void; borrow(amount: number | null): void; repay(amount: number | null): void; settleInterest(): void; clearLog(): void;
  toggleSound(): void; toggleLocale(): void; setCategory(category: string): void; setSubcategory(subcategory: string): void; setSearch(search: string): void; setSort(sort: SortMode): void; focusProduct(id: string): void;
}

interface GameContextValue { authStatus: AuthStatus; account: AccountProjection | null; state: GameState; actions: GameActions; pendingCommand: PendingCommand | null; lastError: string | null; focusedProductId: string | null; flashTick: number; ready: boolean }
const GameContext = createContext<GameContextValue | null>(null);
export function useGame() { const value = useContext(GameContext); if (!value) throw new Error("useGame must be used within GameProvider"); return value; }

export function GameProvider({ children, api = defaultApi }: { children: ReactNode; api?: GameApi }) {
  const [authStatus, setAuthStatus] = useState<AuthStatus>("loading");
  const [account, setAccount] = useState<AccountProjection | null>(null);
  const [preferences, setPreferences] = useState(initialPreferences);
  const [pendingCommand, setPendingCommand] = useState<PendingCommand | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [focusedProductId, setFocusedProductId] = useState<string | null>(null);

  const fail = useCallback((error: unknown) => {
    const info = errorInfo(error);
    setLastError(info.code);
    if (info.expired) { setAccount(null); setAuthStatus("expired"); }
  }, []);

  const loadGame = useCallback(async () => {
    const next = await api.getGame();
    setAccount(next);
    setAuthStatus("authenticated");
  }, [api]);

  useEffect(() => {
    let active = true;
    void api.getSession().then(async (session) => {
      if (!active) return;
      if (!session) { setAuthStatus("locked"); return; }
      try { const next = await api.getGame(); if (active) { setAccount(next); setAuthStatus("authenticated"); } }
      catch (error) { if (active) { fail(error); if (!errorInfo(error).expired) setAuthStatus("locked"); } }
    }).catch((error) => { if (active) { fail(error); setAuthStatus("locked"); } });
    return () => { active = false; };
  }, [api, fail]);

  const command = useCallback(async (kind: PendingCommand, run: () => Promise<AccountProjection>) => {
    if (!account || pendingCommand) return;
    setPendingCommand(kind); setLastError(null);
    try { setAccount(await run()); } catch (error) { fail(error); } finally { setPendingCommand(null); }
  }, [account, pendingCommand, fail]);
  const trade = useCallback((assetId: string, side: "BUY" | "SELL", quantity: number) => command("trade", () => api.submitTrade({ assetId, side, quantity: String(quantity), idempotencyKey: idempotencyKey() })), [api, command]);
  const quantity = useCallback((id: string) => Number(account?.positions.find((item) => item.assetId === id)?.quantity ?? 0), [account]);
  const price = useCallback((id: string) => Number(account?.assets.find((item) => item.id === id)?.usdPrice ?? 0), [account]);

  const actions = useMemo<GameActions>(() => ({
    login: async (address, walletName, signer) => { setPendingCommand("login"); setLastError(null); try { await api.loginWithSignature(address, walletName, signer); await loadGame(); } catch (error) { fail(error); setAccount(null); setAuthStatus("locked"); } finally { setPendingCommand(null); } },
    logout: async () => { setPendingCommand("logout"); try { await api.logout(); } catch (error) { fail(error); } finally { setAccount(null); setAuthStatus("locked"); setPendingCommand(null); } },
    buy: (id) => trade(id, "BUY", 1), buyQty: (id, amount) => trade(id, "BUY", amount),
    buyMax: (id) => trade(id, "BUY", Math.max(0, Math.floor(Number(account?.cash ?? 0) / Math.max(price(id), 1)))),
    sell: (id) => trade(id, "SELL", 1), sellQty: (id, amount) => trade(id, "SELL", amount), sellAll: (id) => trade(id, "SELL", quantity(id)),
    reset: () => command("reset", () => api.resetGame(idempotencyKey())), refreshPricesNow: () => command("refresh", api.getGame),
    setLeverage: (leverage) => setPreferences((p) => ({ ...p, leverage })), borrow: () => undefined, repay: () => undefined, settleInterest: () => undefined, clearLog: () => undefined,
    toggleSound: () => setPreferences((p) => ({ ...p, sound: !p.sound })), toggleLocale: () => setPreferences((p) => ({ ...p, locale: p.locale === "zh" ? "en" : "zh" })),
    setCategory: (selectedCategory) => setPreferences((p) => ({ ...p, selectedCategory, selectedSubcategory: ALL_SUBCATEGORY })), setSubcategory: (selectedSubcategory) => setPreferences((p) => ({ ...p, selectedSubcategory })), setSearch: (search) => setPreferences((p) => ({ ...p, search })), setSort: (sort) => setPreferences((p) => ({ ...p, sort })),
    focusProduct: (id) => { setFocusedProductId(id); requestAnimationFrame(() => document.querySelector(`[data-product-id="${id}"]`)?.scrollIntoView?.({ block: "center" })); },
  }), [account, api, command, fail, loadGame, price, quantity, trade]);

  const state = useMemo(() => projectionState(account, preferences), [account, preferences]);
  return <GameContext.Provider value={{ authStatus, account, state, actions, pendingCommand, lastError, focusedProductId, flashTick: 0, ready: authStatus !== "loading" }}>{children}</GameContext.Provider>;
}
