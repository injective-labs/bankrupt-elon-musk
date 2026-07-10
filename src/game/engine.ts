import type { GameState, Product, Position, SoundKind } from "@/types";
import {
  STARTING_BALANCE,
  WARNING_LTV,
  LIQUIDATION_LTV,
  BASE_BORROW_APR,
  RISK_APR_SPREAD,
  LEVERAGE_APR_SPREAD,
  MS_PER_YEAR,
  SERVER_PLAYER_COUNT,
} from "@/data/constants";
import { productById } from "@/data/expandedAssets";
import { getInvestmentProducts, isInvestmentProduct } from "@/data/categories";
import { t } from "@/i18n";
import { formatCurrency, formatNumber } from "./format";

// Side effects produced by an action (sounds to play, money flash).
export interface Effects {
  sounds: SoundKind[];
  flash: boolean;
}
export function makeEffects(): Effects {
  return { sounds: [], flash: false };
}

// --- Price & display helpers ---

export function getProductPrice(state: GameState, product: Product): number {
  const live = state.prices?.[product.id];
  if (Number(live?.usdPrice)) {
    return Number(live.usdPrice) * (product.quoteMultiplier || 1);
  }
  return product.price || 0;
}

export function getNativePrice(state: GameState, product: Product): number {
  const live = state.prices?.[product.id];
  return Number(live?.nativePrice) || product.price || 0;
}

export function getProductCurrency(state: GameState, product: Product): string {
  return state.prices?.[product.id]?.currency || product.currency || "USD";
}

export function getProductName(product: Product, locale: GameState["locale"]): string {
  return locale === "en" ? product.nameEn || product.ticker || product.name : product.name;
}

export function getProductDescription(product: Product, locale: GameState["locale"]): string {
  return locale === "en" ? product.descriptionEn || product.description : product.description;
}

export function getUnitLabel(product: Product, locale: GameState["locale"]): string {
  return locale === "en" ? product.unitEn || "unit" : product.unit;
}

export function getAssetMark(product: Product): string {
  if (!isInvestmentProduct(product)) return product.icon;
  if (product.subCategory === "加密货币") {
    return product.ticker || product.icon;
  }
  if (product.ticker) return product.ticker.replace(/[-.].*$/, "");
  if (product.nameEn) return product.nameEn.replace(/[^A-Za-z0-9]/g, "").slice(0, 6).toUpperCase();
  return product.name.slice(0, 4);
}

export function getMarkFontSize(mark: string): number {
  const length = String(mark).length;
  if (length <= 1) return 48;
  if (length <= 3) return 36;
  if (length <= 5) return 28;
  return 22;
}

// --- Position helpers ---

export function getPositionQuantity(position: Position | number | undefined): number {
  if (!position) return 0;
  if (typeof position === "number") return position;
  return Number(position.quantity) || 0;
}

export function getPositionCost(
  state: GameState,
  position: Position | number | undefined,
  product: Product,
): number {
  if (!position) return 0;
  if (typeof position === "number") return getProductPrice(state, product) * position;
  return Number(position.costBasis) || 0;
}

// --- Account selectors ---

export function getSpent(state: GameState): number {
  return Object.entries(state.inventory).reduce((total, [id, position]) => {
    const product = productById.get(id);
    return product ? total + getPositionCost(state, position, product) : total;
  }, 0);
}

export function getBalance(state: GameState): number {
  return state.cash;
}

export function getHoldingsValue(state: GameState): number {
  return Object.entries(state.inventory).reduce((total, [id, position]) => {
    const product = productById.get(id);
    if (!product) return total;
    return total + getProductPrice(state, product) * getPositionQuantity(position);
  }, 0);
}

export function getNetWorth(state: GameState): number {
  return state.cash + getHoldingsValue(state) - state.debt;
}

export function getPnl(state: GameState): number {
  return getNetWorth(state) - STARTING_BALANCE;
}

export function getLoanCapacity(state: GameState): number {
  return getHoldingsValue(state) * WARNING_LTV - state.debt;
}

export function getLiquidationRoom(state: GameState): number {
  return getHoldingsValue(state) * LIQUIDATION_LTV - state.debt;
}

export function getLtv(state: GameState): number {
  const holdingsValue = getHoldingsValue(state);
  if (holdingsValue <= 0) return 0;
  return state.debt / holdingsValue;
}

export function getBorrowApr(state: GameState): number {
  const ltv = getLtv(state);
  const riskSpread = Math.max(0, ltv - WARNING_LTV) * RISK_APR_SPREAD;
  const leverageSpread = Math.max(0, state.leverage - 1) * LEVERAGE_APR_SPREAD;
  return BASE_BORROW_APR + riskSpread + leverageSpread;
}

export function clampLeverage(value: unknown): number {
  const numeric = Number(value) || 1;
  return Math.max(1, Math.min(50, Math.round(numeric)));
}

// --- Logging ---

// Monotonic timestamp source for log entries (strictly increasing even within the
// same millisecond) so the backend can insert trade history idempotently by ts.
let lastLogTs = 0;
function nextLogTs(): number {
  lastLogTs = Math.max(Date.now(), lastLogTs + 1);
  return lastLogTs;
}

export function addLog(state: GameState, title: string, detail: string): void {
  state.log.unshift({ title, detail, ts: nextLogTs() });
  state.log = state.log.slice(0, 18);
}

// --- Interest & liquidation (mutating) ---

export function accrueInterest(
  state: GameState,
  now: number = Date.now(),
  options: { log?: boolean } = {},
): number {
  const elapsed = Math.max(0, now - (state.lastInterestAccruedAt || now));
  if (state.debt <= 0 || elapsed <= 0 || state.liquidated) {
    state.lastInterestAccruedAt = now;
    return 0;
  }

  const apr = getBorrowApr(state);
  const interest = state.debt * apr * (elapsed / MS_PER_YEAR);
  if (!Number.isFinite(interest) || interest <= 0) {
    state.lastInterestAccruedAt = now;
    return 0;
  }

  state.debt += interest;
  state.accruedInterest += interest;
  state.lastInterestAccruedAt = now;
  if (options.log && interest >= 1) {
    addLog(
      state,
      t(state.locale, "interestCharged"),
      `${formatCurrency(interest, interest >= 1_000_000_000)} · APR ${(apr * 100).toFixed(2)}%`,
    );
  }
  checkLiquidation(state);
  return interest;
}

export function settleOneDayInterest(state: GameState, effects: Effects): void {
  const interest = accrueInterest(state, (state.lastInterestAccruedAt || Date.now()) + 24 * 60 * 60 * 1000, {
    log: true,
  });
  if (interest <= 0) {
    addLog(state, t(state.locale, "interestCharged"), formatCurrency(0));
  }
  effects.sounds.push("refund");
}

export function checkLiquidation(state: GameState): boolean {
  if (state.liquidated) return true;
  const ltv = getLtv(state);
  if ((getHoldingsValue(state) > 0 && ltv >= LIQUIDATION_LTV) || getNetWorth(state) <= 0) {
    liquidateAccount(state);
    return true;
  }
  return false;
}

export function liquidateAccount(state: GameState): void {
  if (state.liquidated) return;
  state.inventory = {};
  state.cash = 0;
  state.debt = 0;
  state.leverage = 1;
  state.liquidated = true;
  addLog(state, t(state.locale, "bankruptcyTitle"), t(state.locale, "bankruptcyText"));
}

// --- Trading (mutating) ---

export function buyProduct(
  state: GameState,
  productId: string,
  quantity = 1,
  effects: Effects,
  options: { silent?: boolean } = {},
): boolean {
  accrueInterest(state);
  if (state.liquidated) {
    addLog(state, t(state.locale, "bankruptcyTitle"), t(state.locale, "bankruptcyText"));
    return false;
  }
  const product = productById.get(productId);
  if (!product) return false;

  const safeQuantity = Math.max(1, Math.floor(quantity));
  const price = getProductPrice(state, product);
  const notional = price * safeQuantity;
  const margin = notional / state.leverage;
  if (margin > state.cash) {
    addLog(
      state,
      t(state.locale, "insufficientMargin"),
      `${getProductName(product, state.locale)} · ${formatCurrency(margin, margin >= 1_000_000_000)}`,
    );
    effects.sounds.push("error");
    return false;
  }

  const current = state.inventory[product.id] || { quantity: 0, costBasis: 0 };
  state.inventory[product.id] = {
    quantity: getPositionQuantity(current) + safeQuantity,
    costBasis: getPositionCost(state, current, product) + notional,
  };
  state.cash -= margin;
  state.debt += notional - margin;
  if (!options.silent) {
    addLog(
      state,
      `${t(state.locale, "buy")} ${getProductName(product, state.locale)}`,
      `${formatNumber(safeQuantity, state.locale)} ${getUnitLabel(product, state.locale)} · ${state.leverage}x · ${formatCurrency(notional, notional >= 1_000_000_000)}`,
    );
  }
  checkLiquidation(state);
  if (!state.liquidated) {
    effects.sounds.push(notional >= 1_000_000_000 ? "largeBuy" : "buy");
  }
  effects.flash = true;
  return true;
}

export function buyMax(state: GameState, productId: string, effects: Effects): void {
  accrueInterest(state);
  if (state.liquidated) {
    addLog(state, t(state.locale, "bankruptcyTitle"), t(state.locale, "bankruptcyText"));
    return;
  }
  const product = productById.get(productId);
  if (!product) return;
  const price = getProductPrice(state, product);
  const maxQuantity = Math.floor((Math.max(0, state.cash) * state.leverage) / price);
  if (maxQuantity <= 0) {
    addLog(
      state,
      t(state.locale, "insufficientMargin"),
      `${getProductName(product, state.locale)} · ${state.leverage}x`,
    );
    effects.sounds.push("error");
    return;
  }
  buyProduct(state, productId, maxQuantity, effects);
}

export function sellProduct(
  state: GameState,
  productId: string,
  quantityToSell = 1,
  effects: Effects,
  options: { silent?: boolean } = {},
): boolean {
  accrueInterest(state);
  if (state.liquidated) {
    addLog(state, t(state.locale, "bankruptcyTitle"), t(state.locale, "bankruptcyText"));
    return false;
  }
  const product = productById.get(productId);
  if (!product || !state.inventory[productId]) {
    addLog(state, t(state.locale, "noPosition"), product ? getProductName(product, state.locale) : productId);
    effects.sounds.push("error");
    return false;
  }

  const position = state.inventory[productId];
  const quantity = getPositionQuantity(position);
  const cost = getPositionCost(state, position, product);
  const sellQuantity = Math.min(Math.max(1, Math.floor(quantityToSell)), quantity);
  const avgCost = quantity ? cost / quantity : 0;
  const proceeds = getProductPrice(state, product) * sellQuantity;
  const realizedPnl = proceeds - avgCost * sellQuantity;
  const remainingQuantity = quantity - sellQuantity;
  if (remainingQuantity <= 0) {
    delete state.inventory[productId];
  } else {
    state.inventory[productId] = {
      quantity: remainingQuantity,
      costBasis: Math.max(0, cost - avgCost * sellQuantity),
    };
  }

  const autoRepay = Math.min(proceeds, state.debt);
  const cashReceived = proceeds - autoRepay;
  state.debt -= autoRepay;
  state.cash += cashReceived;
  if (!options.silent) {
    const details = [
      `${formatNumber(sellQuantity, state.locale)} ${getUnitLabel(product, state.locale)}`,
      `${t(state.locale, "saleCash")} ${formatCurrency(cashReceived, cashReceived >= 1_000_000_000)}`,
      `${t(state.locale, "autoRepay")} ${formatCurrency(autoRepay, autoRepay >= 1_000_000_000)}`,
      `${t(state.locale, "pnl")} ${formatCurrency(realizedPnl, Math.abs(realizedPnl) >= 1_000_000_000)}`,
    ];
    addLog(state, `${t(state.locale, "sell")} ${getProductName(product, state.locale)}`, details.join(" · "));
  }
  checkLiquidation(state);
  effects.sounds.push("refund");
  effects.flash = true;
  return true;
}

export function sellAllProduct(state: GameState, productId: string, effects: Effects): void {
  const quantity = getPositionQuantity(state.inventory[productId]);
  if (quantity <= 0) {
    sellProduct(state, productId, 1, effects);
    return;
  }
  sellProduct(state, productId, quantity, effects);
}

export function randomSpend(state: GameState, effects: Effects): void {
  const investable = getInvestmentProducts().filter((product) => getProductPrice(state, product) > 0);
  let transactions = 0;
  let total = 0;

  for (let i = 0; i < 10; i += 1) {
    const affordable = investable.filter(
      (product) => getProductPrice(state, product) / state.leverage <= state.cash,
    );
    if (!affordable.length) break;
    const product = affordable[Math.floor(Math.random() * affordable.length)];
    const price = getProductPrice(state, product);
    const targetMargin = state.cash * (0.035 + Math.random() * 0.08);
    const quantity = Math.max(1, Math.floor((targetMargin * state.leverage) / price));
    if (buyProduct(state, product.id, quantity, effects, { silent: true })) {
      total += price * quantity;
      transactions += 1;
    }
  }

  if (!transactions) {
    effects.sounds.push("error");
    return;
  }
  addLog(
    state,
    t(state.locale, "randomInvest"),
    `${transactions} ${state.locale === "en" ? "trades" : "笔交易"} · ${formatCurrency(total, total >= 1_000_000_000)}`,
  );
  effects.sounds.push("chaos");
  effects.flash = true;
}

export function borrowMoney(state: GameState, requestedAmount: number | null, effects: Effects): void {
  accrueInterest(state);
  if (state.liquidated) {
    addLog(state, t(state.locale, "bankruptcyTitle"), t(state.locale, "bankruptcyText"));
    return;
  }
  const holdingsValue = getHoldingsValue(state);
  if (holdingsValue <= 0) {
    addLog(state, t(state.locale, "noCollateral"), t(state.locale, "noCollateral"));
    effects.sounds.push("error");
    return;
  }
  const defaultBorrow = Math.max(1_000_000, holdingsValue * 0.05);
  const requested = requestedAmount || defaultBorrow;
  const amount = Math.max(0, requested);
  if (amount <= 0) {
    effects.sounds.push("error");
    return;
  }
  state.cash += amount;
  state.debt += amount;
  addLog(
    state,
    t(state.locale, "borrow"),
    `${formatCurrency(amount, amount >= 1_000_000_000)} · LTV ${(getLtv(state) * 100).toFixed(1)}%`,
  );
  checkLiquidation(state);
  if (!state.liquidated) {
    effects.sounds.push("largeBuy");
  }
}

export function repayMoney(state: GameState, requestedAmount: number | null, effects: Effects): void {
  accrueInterest(state);
  const requested = requestedAmount || Math.min(state.cash, state.debt);
  const amount = Math.max(0, Math.min(requested, state.cash, state.debt));
  if (amount <= 0) {
    addLog(state, t(state.locale, "insufficientRepay"), formatCurrency(state.debt, state.debt >= 1_000_000_000));
    effects.sounds.push("error");
    return;
  }
  state.cash -= amount;
  state.debt -= amount;
  addLog(
    state,
    t(state.locale, "repay"),
    `${formatCurrency(amount, amount >= 1_000_000_000)} · LTV ${(getLtv(state) * 100).toFixed(1)}%`,
  );
  effects.sounds.push("refund");
}

// --- Loss leaderboard ---

export interface LossRanking {
  title: string;
  text: string;
  color: string;
}

export function getLossRanking(state: GameState): LossRanking {
  const netWorth = getNetWorth(state);
  const pnl = getPnl(state);
  const title = t(state.locale, "lossRankTitle");
  if (state.liquidated || netWorth <= 0) {
    return {
      title,
      text:
        state.locale === "en"
          ? `#1 / ${formatNumber(SERVER_PLAYER_COUNT, state.locale)}. Liquidated. Musk's account has reached peak loss mode.`
          : `#1 / ${formatNumber(SERVER_PLAYER_COUNT, state.locale)}。已爆仓清零，马斯克亏钱榜直接冲顶。`,
      color: "#c94d3f",
    };
  }

  if (pnl < 0) {
    const lossRatio = Math.min(1, Math.abs(pnl) / STARTING_BALANCE);
    const rank = Math.max(2, Math.round(1_000_000 - lossRatio * 999_998));
    return {
      title,
      text:
        state.locale === "en"
          ? `#${formatNumber(rank, state.locale)} / ${formatNumber(SERVER_PLAYER_COUNT, state.locale)}. Current loss ${formatCurrency(Math.abs(pnl), true)}. You are moving up the loss board.`
          : `#${formatNumber(rank, state.locale)} / ${formatNumber(SERVER_PLAYER_COUNT, state.locale)}。当前亏损 ${formatCurrency(Math.abs(pnl), true)}，亏钱榜名次正在往前冲。`,
      color: "#c94d3f",
    };
  }

  if (pnl > 0) {
    const gainRatio = Math.min(1, pnl / STARTING_BALANCE);
    const rank = Math.min(SERVER_PLAYER_COUNT, Math.round(5_000_000 + gainRatio * 4_950_000));
    return {
      title,
      text:
        state.locale === "en"
          ? `#${formatNumber(rank, state.locale)} / ${formatNumber(SERVER_PLAYER_COUNT, state.locale)}. Current profit ${formatCurrency(pnl, true)}. Too good for the loss leaderboard.`
          : `#${formatNumber(rank, state.locale)} / ${formatNumber(SERVER_PLAYER_COUNT, state.locale)}。当前盈利 ${formatCurrency(pnl, true)}，离亏钱榜前排越来越远。`,
      color: "#2d7b46",
    };
  }

  return {
    title,
    text:
      state.locale === "en"
        ? `#5,000,000 / ${formatNumber(SERVER_PLAYER_COUNT, state.locale)}. Flat book. The server is waiting for damage.`
        : `#5,000,000 / ${formatNumber(SERVER_PLAYER_COUNT, state.locale)}。账户暂时打平，全服还在等你制造亏损。`,
    color: "#b88921",
  };
}

export function getPriceSourceSummary(state: GameState): string {
  const liveCount = getInvestmentProducts().filter((product) => state.prices?.[product.id]).length;
  const total = getInvestmentProducts().length;
  if (!liveCount) return t(state.locale, "stalePrice");
  return `${t(state.locale, "livePrice")} ${liveCount}/${total}`;
}
