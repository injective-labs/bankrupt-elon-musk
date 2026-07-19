// Shared domain types for the Bankrupt Elon Musk game.

export type Locale = "zh" | "en";

export type SortMode = "price-asc" | "price-desc" | "owned";

export type SoundKind = "buy" | "largeBuy" | "refund" | "error" | "chaos" | "reset";

/** Exact base-10 value serialized at an API boundary. */
export type DecimalString = string;

export type QuoteStatus = "ACTIVE" | "STALE" | "ERROR" | "MISSING";

export interface AssetView {
  id: string;
  name: string;
  nameEn?: string | null;
  category: string;
  subCategory?: string | null;
  ticker: string;
  currency: string;
  unit: string;
  unitEn?: string | null;
  enabled: boolean;
  displayOrder: number;
  usdPrice: DecimalString | null;
  marketDate: string | null;
  quoteStatus: QuoteStatus;
}

export interface PositionView {
  assetId: string;
  quantity: DecimalString;
  costBasis: DecimalString;
  marketValue: DecimalString | null;
  unrealizedPnl: DecimalString | null;
}

export interface TransactionView {
  id: string;
  type: "BUY" | "SELL" | "RESET";
  assetId: string | null;
  quantity: DecimalString | null;
  usdUnitPrice: DecimalString | null;
  usdAmount: DecimalString;
  createdAt: string;
}

export interface AccountProjection {
  walletAddress: string;
  walletName?: string | null;
  cash: DecimalString;
  holdingsValue: DecimalString;
  netWorth: DecimalString;
  pnl: DecimalString;
  positions: PositionView[];
  assets: AssetView[];
  recentTransactions: TransactionView[];
  marketAsOf: string | null;
  settlementLocked: boolean;
  updatedAt: string;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface Product {
  id: string;
  name: string;
  nameEn?: string;
  category: string;
  subCategory?: string;
  assetClass?: string;
  ticker?: string;
  /** Explicit Yahoo symbol; `null` means "no live quote". */
  quoteSymbol?: string | null;
  /** Multiplier applied to live USD price (e.g. convertible bonds). */
  quoteMultiplier?: number;
  mark?: string;
  currency?: string;
  price: number;
  unit: string;
  unitEn?: string;
  icon: string;
  accent: string;
  description: string;
  descriptionEn?: string;
  /** Forces a non-金融 product to be treated as investable. */
  investment?: boolean;
}

/** A held position: quantity plus the total cost basis paid. */
export interface Position {
  quantity: number;
  costBasis: number;
}

/** Legacy saved positions could be a bare number. */
export type StoredPosition = Position | number;

export interface PriceQuote {
  nativePrice: number;
  usdPrice: number;
  currency: string;
  closeDate: string;
  source: string;
  updatedAt: string;
}

export type FxRates = Record<string, number>;

export interface LogEntry {
  title: string;
  detail: string;
  /** Client monotonic timestamp; used by the backend for idempotent trade history. */
  ts: number;
}

export interface LeaderboardRow {
  address: string;
  walletName?: string | null;
  pnl: DecimalString;
  netWorth: DecimalString;
  liquidated: boolean;
}

export interface LeaderboardSnapshot {
  top: LeaderboardRow[];
  total: number;
  you?: { rank: number; total: number; pnl: DecimalString } | null;
}

export interface GameState {
  inventory: Record<string, Position>;
  cash: number;
  debt: number;
  accruedInterest: number;
  lastInterestAccruedAt: number;
  liquidated: boolean;
  leverage: number;
  prices: Record<string, PriceQuote>;
  fxRates: FxRates;
  lastPriceRefresh: string | null;
  locale: Locale;
  log: LogEntry[];
  selectedCategory: string;
  selectedSubcategory: string;
  search: string;
  sort: SortMode;
  sound: boolean;
}

export interface BilingualLabel {
  zh: string;
  en: string;
}
