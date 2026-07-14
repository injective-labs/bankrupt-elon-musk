import type { GameState, Position, PriceQuote, SortMode } from "@/types";
import { STARTING_BALANCE, STORAGE_KEY, FALLBACK_FX } from "@/data/constants";
import { productById } from "@/data/expandedAssets";
import { isInvestmentProduct, categories, getSubcategoriesForCategory, ALL_SUBCATEGORY } from "@/data/categories";
import { clampLeverage, getSpent } from "@/game/engine";

const SORT_MODES: SortMode[] = ["price-asc", "price-desc", "owned"];

export function createInitialState(): GameState {
  return {
    inventory: {},
    cash: STARTING_BALANCE,
    debt: 0,
    accruedInterest: 0,
    lastInterestAccruedAt: Date.now(),
    liquidated: false,
    leverage: 1,
    prices: {},
    fxRates: { ...FALLBACK_FX },
    lastPriceRefresh: null,
    locale: "zh",
    log: [],
    selectedCategory: "全部",
    selectedSubcategory: ALL_SUBCATEGORY,
    search: "",
    sort: "price-asc",
    sound: true,
  };
}

function priceOf(prices: Record<string, PriceQuote>, id: string): number {
  const live = prices[id];
  const product = productById.get(id);
  if (Number(live?.usdPrice)) {
    return Number(live.usdPrice) * (product?.quoteMultiplier || 1);
  }
  return product?.price || 0;
}

export function sanitizeInventory(
  inventory: Record<string, unknown>,
  prices: Record<string, PriceQuote>,
): Record<string, Position> {
  const clean: Record<string, Position> = {};
  Object.entries(inventory).forEach(([id, quantity]) => {
    const product = productById.get(id);
    if (!product) return;
    if (!isInvestmentProduct(product)) return;
    if (typeof quantity === "object" && quantity !== null) {
      const q = quantity as { quantity?: unknown; costBasis?: unknown };
      const safeQuantity = Math.max(0, Number(q.quantity) || 0);
      const costBasis = Math.max(0, Number(q.costBasis) || priceOf(prices, id) * safeQuantity);
      if (safeQuantity > 0) clean[id] = { quantity: safeQuantity, costBasis };
      return;
    }
    const safeQuantity = Math.max(0, Math.floor(Number(quantity) || 0));
    if (safeQuantity > 0) {
      clean[id] = {
        quantity: safeQuantity,
        costBasis: priceOf(prices, id) * safeQuantity,
      };
    }
  });
  return clean;
}

export function loadState(): GameState {
  const state = createInitialState();
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    if (saved && typeof saved === "object") {
      // Match original: inventory is sanitized before live prices are applied.
      state.inventory = sanitizeInventory(saved.inventory || {}, {});
      state.cash =
        Number.isFinite(Number(saved.cash)) && saved.cash !== null
          ? Number(saved.cash)
          : STARTING_BALANCE - getSpent(state);
      state.debt = Math.max(0, Number(saved.debt) || 0);
      state.accruedInterest = Math.max(0, Number(saved.accruedInterest) || 0);
      state.lastInterestAccruedAt = Number(saved.lastInterestAccruedAt) || Date.now();
      state.liquidated = saved.liquidated === true;
      state.leverage = clampLeverage(saved.leverage || 1);
      state.prices = saved.prices && typeof saved.prices === "object" ? saved.prices : {};
      state.fxRates =
        saved.fxRates && typeof saved.fxRates === "object"
          ? { ...FALLBACK_FX, ...saved.fxRates }
          : { ...FALLBACK_FX };
      state.lastPriceRefresh = saved.lastPriceRefresh || null;
      state.locale = saved.locale === "en" ? "en" : "zh";
      state.log = Array.isArray(saved.log) ? saved.log.slice(0, 20) : [];
      state.sound = typeof saved.sound === "boolean" ? saved.sound : true;
      state.selectedCategory = categories.includes(saved.selectedCategory)
        ? saved.selectedCategory
        : "全部";
      state.selectedSubcategory = getSubcategoriesForCategory(state.selectedCategory).includes(
        saved.selectedSubcategory,
      )
        ? saved.selectedSubcategory
        : ALL_SUBCATEGORY;
      state.sort = SORT_MODES.includes(saved.sort) ? saved.sort : "price-asc";
    }
  } catch {
    state.inventory = {};
    state.log = [];
  }
  return state;
}

export function saveState(state: GameState): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        inventory: state.inventory,
        cash: state.cash,
        debt: state.debt,
        accruedInterest: state.accruedInterest,
        lastInterestAccruedAt: state.lastInterestAccruedAt,
        liquidated: state.liquidated,
        leverage: state.leverage,
        prices: state.prices,
        fxRates: state.fxRates,
        lastPriceRefresh: state.lastPriceRefresh,
        locale: state.locale,
        log: state.log,
        sound: state.sound,
        selectedCategory: state.selectedCategory,
        selectedSubcategory: state.selectedSubcategory,
        sort: state.sort,
      }),
    );
  } catch {
    // ignore storage failures (private mode, quota)
  }
}
