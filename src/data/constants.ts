// Ported verbatim from the original script.js (game constants + FX tables).
import type { FxRates } from "@/types";

export const STARTING_BALANCE = 50_000_000_000;
export const STORAGE_KEY = "spend-musk-money-state-v2";
export const WARNING_LTV = 0.5;
export const LIQUIDATION_LTV = 0.99;
export const BASE_BORROW_APR = 0.065;
export const RISK_APR_SPREAD = 0.24;
export const LEVERAGE_APR_SPREAD = 0.0012;
export const MS_PER_YEAR = 365 * 24 * 60 * 60 * 1000;
export const PRICE_REFRESH_CHECK_INTERVAL_MS = 60 * 1000;
export const NEW_YORK_TZ = "America/New_York";
export const HONG_KONG_TZ = "Asia/Hong_Kong";
export const MARKET_CLOSE_HOUR_NY = 16;
export const MARKET_CLOSE_MINUTE_NY = 0;
export const SERVER_PLAYER_COUNT = 10_000_000;
export const FALLBACK_FX: FxRates = {
  USD: 1,
  HKD: 0.128,
  CNY: 0.138,
  KRW: 0.00072,
  TWD: 0.031,
  JPY: 0.0064,
  EUR: 1.08,
  DKK: 0.145,
  CHF: 1.1,
  GBP: 1.27,
  GBp: 0.0127,
};

export const FX_SYMBOLS: Record<string, string> = {
  HKD: "HKDUSD=X",
  CNY: "CNYUSD=X",
  KRW: "KRWUSD=X",
  TWD: "TWDUSD=X",
  JPY: "JPYUSD=X",
  EUR: "EURUSD=X",
  DKK: "DKKUSD=X",
  CHF: "CHFUSD=X",
  GBP: "GBPUSD=X",
};

export const FX_DISPLAY_ORDER: [string, { zh: string; en: string }][] = [
  ["CNY", { zh: "人民币", en: "Chinese yuan" }],
  ["HKD", { zh: "港币", en: "Hong Kong dollar" }],
  ["TWD", { zh: "新台币", en: "Taiwan dollar" }],
  ["JPY", { zh: "日元", en: "Japanese yen" }],
  ["KRW", { zh: "韩元", en: "Korean won" }],
  ["EUR", { zh: "欧元", en: "Euro" }],
  ["GBP", { zh: "英镑", en: "British pound" }],
  ["GBp", { zh: "英股便士", en: "UK pence quote" }],
  ["CHF", { zh: "瑞郎", en: "Swiss franc" }],
  ["DKK", { zh: "丹麦克朗", en: "Danish krone" }],
];
