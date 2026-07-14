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
export const SETTLEMENT_WINDOW_MS = 30 * 60 * 1000;
export const TRADE_FRACTIONS = [1 / 4, 1 / 8, 1 / 16, 1 / 32];
export const HONG_KONG_TZ = "Asia/Hong_Kong";
// The game uses a fictional daily close at HKT 17:30 (17:00-18:00 is the
// clearing/settlement window), matching the prototype.
export const MARKET_CLOSE_HOUR_HKT = 17;
export const MARKET_CLOSE_MINUTE_HKT = 30;
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

// Mock wallet addresses + tickers that feed the "全服动态 / Server Moves" ticker.
export const MOCK_PLAYER_ADDRESSES = [
  "0xA91f4d7b88c3e5b6251aa0f417822af00b7d91f2",
  "0xB28c6e23f0da54e948aa21f69f4c55a6d8e0c114",
  "0xC72b9d4f08aa6a6b5e1218bb9aafe4474fbc83d8",
  "0xD03f5c9a41b7d605f17a6717e18b3d0ef31aa972",
  "0xE64a7bde7051fa2840fb06bc78314dd6928ad66c",
  "0xF19d20ca6bb6a12907da23c92324cd1b776a8e90",
  "0x8D7b2a881d74c31f079fd53f6d1845673dd2090a",
  "0x6B2a6d5a9cde84b8c62f91374a1e2d82777ac351",
  "0x5E3f9b1e4df4bb7aa83a2b4e94d8dd9f51a30c09",
  "0x3C9af002de7785fd0e19cd7f42d7c4079a57e4b5",
  "0x2A6cded813a9c405a4f812057e5df83fbfe04931",
  "0x1F8e7756fc4d9e6804098a06fe3d5a2f6d58f0bd",
];

export const MOCK_ACTIVITY_TICKERS = [
  "NVDA",
  "BTC",
  "INJ",
  "ETH",
  "AVGO",
  "TSM",
  "SMCI",
  "VRT",
  "CRWV",
  "DOGE",
  "LINK",
  "GC=F",
  "CL=F",
  "000660.KS",
  "2330.TW",
  "0700.HK",
];
