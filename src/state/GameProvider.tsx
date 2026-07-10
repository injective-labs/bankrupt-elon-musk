"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { GameState, SortMode } from "@/types";
import { PRICE_REFRESH_CHECK_INTERVAL_MS } from "@/data/constants";
import { productById } from "@/data/expandedAssets";
import { ALL_SUBCATEGORY, getProductCategory } from "@/data/categories";
import { t } from "@/i18n";
import {
  accrueInterest,
  checkLiquidation,
  buyProduct,
  buyMax as engineBuyMax,
  sellProduct,
  sellAllProduct,
  borrowMoney,
  repayMoney,
  settleOneDayInterest,
  randomSpend as engineRandomSpend,
  clampLeverage,
  getSpent,
  getPriceSourceSummary,
  addLog,
  makeEffects,
  type Effects,
} from "@/game/engine";
import { refreshPrices } from "@/game/pricing";
import { shouldRefreshPrices } from "@/game/marketClock";
import { createInitialState, loadState, saveState } from "./persistence";
import { useSound } from "@/sound/useSound";

export interface GameActions {
  buy: (id: string) => void;
  buyMax: (id: string) => void;
  sell: (id: string) => void;
  sellAll: (id: string) => void;
  setLeverage: (value: number) => void;
  borrow: (amount: number | null) => void;
  repay: (amount: number | null) => void;
  settleInterest: () => void;
  randomSpend: () => void;
  reset: () => void;
  clearLog: () => void;
  toggleSound: () => void;
  toggleLocale: () => void;
  setCategory: (category: string) => void;
  setSubcategory: (subcategory: string) => void;
  setSearch: (search: string) => void;
  setSort: (sort: SortMode) => void;
  focusProduct: (id: string) => void;
  refreshPricesNow: () => void;
  replaceState: (next: GameState) => void;
}

interface GameContextValue {
  state: GameState;
  actions: GameActions;
  focusedProductId: string | null;
  resetArmed: boolean;
  flashTick: number;
  ready: boolean;
}

const GameContext = createContext<GameContextValue | null>(null);

export function useGame(): GameContextValue {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error("useGame must be used within GameProvider");
  return ctx;
}

export function GameProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GameState>(() => createInitialState());
  const stateRef = useRef<GameState>(state);
  const [ready, setReady] = useState(false);
  const [focusedProductId, setFocusedProductId] = useState<string | null>(null);
  const [resetArmed, setResetArmed] = useState(false);
  const [flashTick, setFlashTick] = useState(0);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playSound = useSound();

  // Runs a mutation on a cloned state, mirroring the original renderAll():
  // accrue interest + check liquidation, then persist + fire effects.
  const commit = useCallback(
    (mutator: (state: GameState, effects: Effects) => void) => {
      const next = structuredClone(stateRef.current);
      const effects = makeEffects();
      accrueInterest(next);
      checkLiquidation(next);
      mutator(next, effects);
      stateRef.current = next;
      setState(next);
      saveState(next);
      if (next.sound) {
        effects.sounds.forEach((sound) => playSound(sound));
      }
      if (effects.flash) {
        setFlashTick((tick) => tick + 1);
      }
    },
    [playSound],
  );

  const refreshPricesNow = useCallback(async () => {
    try {
      const result = await refreshPrices(stateRef.current.fxRates);
      commit((s) => {
        s.prices = { ...s.prices, ...result.prices };
        s.fxRates = result.fxRates;
        s.lastPriceRefresh = result.lastPriceRefresh;
        addLog(s, t(s.locale, "syncPrices"), getPriceSourceSummary(s));
        checkLiquidation(s);
      });
    } catch {
      commit((s) => {
        addLog(s, t(s.locale, "syncPrices"), t(s.locale, "stalePrice"));
      });
    }
  }, [commit]);

  // Initial load from localStorage (client only), then refresh prices if stale.
  useEffect(() => {
    const loaded = loadState();
    stateRef.current = loaded;
    setState(loaded);
    setReady(true);
    if (shouldRefreshPrices(loaded.lastPriceRefresh)) {
      void refreshPricesNow();
    }
    const interval = setInterval(() => {
      if (shouldRefreshPrices(stateRef.current.lastPriceRefresh)) {
        void refreshPricesNow();
      }
    }, PRICE_REFRESH_CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reset = useCallback(() => {
    const current = stateRef.current;
    if ((getSpent(current) > 0 || current.log.length) && !resetArmed) {
      setResetArmed(true);
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setResetArmed(false), 2400);
      if (current.sound) playSound("refund");
      return;
    }
    if (resetTimer.current) clearTimeout(resetTimer.current);
    setResetArmed(false);
    const next = createInitialState();
    next.locale = current.locale;
    next.sound = current.sound;
    next.prices = current.prices;
    next.fxRates = current.fxRates;
    next.lastPriceRefresh = current.lastPriceRefresh;
    stateRef.current = next;
    setState(next);
    saveState(next);
    setFocusedProductId(null);
    if (next.sound) playSound("reset");
  }, [resetArmed, playSound]);

  // Adopt an externally-sourced state (e.g. cloud save). Merged over defaults so a
  // partial/older payload can't crash the UI.
  const replaceState = useCallback((next: GameState) => {
    const merged: GameState = { ...createInitialState(), ...next };
    merged.leverage = clampLeverage(merged.leverage);
    stateRef.current = merged;
    setState(merged);
    saveState(merged);
  }, []);

  const focusProduct = useCallback(
    (id: string) => {
      const product = productById.get(id);
      if (!product) return;
      setFocusedProductId(id);
      commit((s) => {
        s.selectedCategory = getProductCategory(product);
        s.selectedSubcategory = product.subCategory || ALL_SUBCATEGORY;
        s.search = "";
      });
      requestAnimationFrame(() => {
        const card = document.querySelector(`[data-product-id="${id}"]`);
        if (card && typeof card.scrollIntoView === "function") {
          card.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
        }
      });
    },
    [commit],
  );

  const actions: GameActions = useMemo(() => ({
    buy: (id) => commit((s, e) => buyProduct(s, id, 1, e)),
    buyMax: (id) => commit((s, e) => engineBuyMax(s, id, e)),
    sell: (id) => commit((s, e) => sellProduct(s, id, 1, e)),
    sellAll: (id) => commit((s, e) => sellAllProduct(s, id, e)),
    setLeverage: (value) => commit((s) => {
      s.leverage = clampLeverage(value);
    }),
    borrow: (amount) => commit((s, e) => borrowMoney(s, amount, e)),
    repay: (amount) => commit((s, e) => repayMoney(s, amount, e)),
    settleInterest: () => commit((s, e) => settleOneDayInterest(s, e)),
    randomSpend: () => commit((s, e) => engineRandomSpend(s, e)),
    reset,
    clearLog: () => commit((s, e) => {
      s.log = [];
      e.sounds.push("refund");
    }),
    toggleSound: () => commit((s, e) => {
      s.sound = !s.sound;
      if (s.sound) e.sounds.push("buy");
    }),
    toggleLocale: () => commit((s) => {
      s.locale = s.locale === "zh" ? "en" : "zh";
    }),
    setCategory: (category) => commit((s, e) => {
      s.selectedCategory = category;
      s.selectedSubcategory = ALL_SUBCATEGORY;
      e.sounds.push("refund");
    }),
    setSubcategory: (subcategory) => commit((s, e) => {
      s.selectedSubcategory = subcategory;
      e.sounds.push("refund");
    }),
    setSearch: (search) => commit((s) => {
      s.search = search;
    }),
    setSort: (sort) => commit((s) => {
      s.sort = sort;
    }),
    focusProduct,
    refreshPricesNow: () => void refreshPricesNow(),
    replaceState,
  }), [commit, reset, focusProduct, refreshPricesNow, replaceState]);

  return (
    <GameContext.Provider
      value={{ state, actions, focusedProductId, resetArmed, flashTick, ready }}
    >
      {children}
    </GameContext.Provider>
  );
}
