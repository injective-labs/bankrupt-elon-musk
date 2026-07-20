import type { AccountProjection, ApiErrorBody, LeaderboardSnapshot, MarketProjection, TradeReceipt, TransactionView } from "@/types";

export interface SessionView { walletAddress: string; walletName: string | null }
export interface TradeInput { assetId: string; side: "BUY" | "SELL"; quantity: string; idempotencyKey: string }
export interface TransactionPage { rows: TransactionView[]; nextCursor: string | null }
export type MessageSigner = (message: string) => Promise<Uint8Array>;

export class GameApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = "GameApiError";
  }
}

function toHexSignature(signature: Uint8Array): `0x${string}` {
  return `0x${Array.from(signature, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function response<T>(request: Promise<Response>): Promise<T> {
  const res = await request;
  const body = await res.json().catch(() => null) as ApiErrorBody | T | null;
  if (!res.ok) {
    const error = body && typeof body === "object" && "error" in body ? body.error : null;
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : res.status === 401 ? "UNAUTHORIZED" : `HTTP_${res.status}`;
    const message = typeof error === "string" ? error : error && typeof error === "object" && "message" in error ? String(error.message) : code;
    throw new GameApiError(res.status, code, message);
  }
  return body as T;
}

function invalidResponse(message: string): never {
  throw new GameApiError(502, "INVALID_RESPONSE", message);
}

function session(value: unknown): SessionView {
  if (!value || typeof value !== "object") return invalidResponse("Session response is missing");
  const record = value as Record<string, unknown>;
  if (typeof record.walletAddress !== "string" || !(record.walletName === null || typeof record.walletName === "string")) return invalidResponse("Session response is malformed");
  return { walletAddress: record.walletAddress, walletName: record.walletName };
}

function challenge(value: unknown): { nonce: string; message: string } {
  if (!value || typeof value !== "object") return invalidResponse("Nonce response is missing");
  const record = value as Record<string, unknown>;
  if (typeof record.nonce !== "string" || typeof record.message !== "string") return invalidResponse("Nonce response is malformed");
  return { nonce: record.nonce, message: record.message };
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const stringOrNull = (value: unknown): boolean => typeof value === "string" || value === null;
const decimal = (value: unknown): value is string => typeof value === "string" && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value);

function validPosition(value: unknown): boolean {
  return record(value) && typeof value.assetId === "string" && decimal(value.quantity) && decimal(value.costBasis) && (value.marketValue === null || decimal(value.marketValue)) && (value.unrealizedPnl === null || decimal(value.unrealizedPnl));
}

function validAsset(value: unknown): boolean {
  return record(value) && typeof value.id === "string" && typeof value.name === "string" && typeof value.category === "string" && typeof value.ticker === "string" && typeof value.currency === "string" && typeof value.unit === "string" && typeof value.enabled === "boolean" && typeof value.displayOrder === "number" && (value.usdPrice === null || decimal(value.usdPrice)) && stringOrNull(value.marketDate) && ["ACTIVE", "STALE", "ERROR", "MISSING"].includes(String(value.quoteStatus));
}

function validTransaction(value: unknown): boolean {
  return record(value) && typeof value.id === "string" && ["BUY", "SELL", "RESET"].includes(String(value.type)) && stringOrNull(value.assetId) && (value.quantity === null || decimal(value.quantity)) && (value.usdUnitPrice === null || decimal(value.usdUnitPrice)) && decimal(value.usdAmount) && typeof value.createdAt === "string";
}

function account(value: unknown): AccountProjection {
  if (!value || typeof value !== "object") return invalidResponse("Account response is missing");
  const record = value as Record<string, unknown>;
  const decimals = ["cash", "holdingsValue", "netWorth", "pnl"];
  if (typeof record.walletAddress !== "string" || !(record.walletName === undefined || stringOrNull(record.walletName)) || decimals.some((key) => !decimal(record[key])) || !Array.isArray(record.positions) || !record.positions.every(validPosition) || !Array.isArray(record.assets) || !record.assets.every(validAsset) || !Array.isArray(record.recentTransactions) || !record.recentTransactions.every(validTransaction) || !stringOrNull(record.marketAsOf) || typeof record.updatedAt !== "string" || typeof record.settlementLocked !== "boolean" || typeof record.resetEnabled !== "boolean") {
    return invalidResponse("Account response is malformed");
  }
  return value as AccountProjection;
}

function market(value: unknown): MarketProjection {
  if (!record(value) || !Array.isArray(value.assets) || !value.assets.every(validAsset) || !stringOrNull(value.marketAsOf)) {
    return invalidResponse("Market response is malformed");
  }
  return value as unknown as MarketProjection;
}

function tradeReceipt(value: unknown): TradeReceipt {
  if (!record(value)) return invalidResponse("Trade receipt is missing");
  const decimals = ["quantity", "usdUnitPrice", "usdAmount", "cashBefore", "cashAfter", "quantityBefore", "quantityAfter", "costBasisBefore", "costBasisAfter"];
  if (typeof value.id !== "string" || typeof value.idempotencyKey !== "string" || (value.side !== "BUY" && value.side !== "SELL")
    || typeof value.assetId !== "string" || typeof value.requestedQuantity !== "string"
    || decimals.some((key) => !decimal(value[key])) || typeof value.marketDate !== "string" || typeof value.createdAt !== "string") {
    return invalidResponse("Trade receipt is malformed");
  }
  return value as unknown as TradeReceipt;
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  credentials: "same-origin",
  headers: body === undefined ? undefined : { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

export async function getSession(): Promise<SessionView | null> {
  try { return session(await response<unknown>(fetch("/api/auth/session", json("GET")))); }
  catch (error) { if (error instanceof GameApiError && error.status === 401) return null; throw error; }
}

export async function loginWithSignature(address: string, walletName: string | null, signMessage: MessageSigner): Promise<SessionView> {
  const nonce = challenge(await response<unknown>(fetch("/api/auth/nonce", json("POST", { address }))));
  const signature = toHexSignature(await signMessage(nonce.message));
  return session(await response<unknown>(fetch("/api/auth/verify", json("POST", { address, walletName, signature }))));
}

export async function logout(): Promise<void> {
  const res = await fetch("/api/auth/logout", json("POST"));
  if (res.status === 204) return;
  const body = await response<unknown>(Promise.resolve(res));
  if (!record(body) || body.ok !== true) invalidResponse("Logout response is malformed");
}

export const getGame = async (): Promise<AccountProjection> => account(await response<unknown>(fetch("/api/game", json("GET"))));
export const getMarket = async (): Promise<MarketProjection> => market(await response<unknown>(fetch("/api/market", json("GET"))));
export const submitTrade = async (command: TradeInput): Promise<TradeReceipt> => tradeReceipt(await response<unknown>(fetch("/api/trades", json("POST", command))));
export const resetGame = async (idempotencyKey: string): Promise<AccountProjection> => account(await response<unknown>(fetch("/api/game/reset", json("POST", { idempotencyKey }))));
export const getTransactions = async (cursor?: string, limit = 50): Promise<TransactionPage> => {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  const value = await response<unknown>(fetch(`/api/trades?${params}`, json("GET")));
  if (!record(value) || !Array.isArray(value.rows) || !value.rows.every(validTransaction) || !(value.nextCursor === null || typeof value.nextCursor === "string")) invalidResponse("Transaction response is malformed");
  return value as unknown as TransactionPage;
};
export const getLeaderboard = async (): Promise<LeaderboardSnapshot> => {
  const value = await response<unknown>(fetch("/api/leaderboard", json("GET")));
  const validRow = (row: unknown) => record(row) && typeof row.address === "string" && (row.walletName === undefined || stringOrNull(row.walletName)) && decimal(row.pnl) && decimal(row.netWorth);
  const validYou = (you: unknown) => you === undefined || you === null || record(you) && typeof you.rank === "number" && typeof you.total === "number" && decimal(you.pnl);
  if (!record(value) || !Array.isArray(value.top) || !value.top.every(validRow) || typeof value.total !== "number" || !validYou(value.you)) invalidResponse("Leaderboard response is malformed");
  return value as unknown as LeaderboardSnapshot;
};

export { toHexSignature };
