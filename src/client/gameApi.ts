import type { AccountProjection, ApiErrorBody, LeaderboardSnapshot, TransactionView } from "@/types";

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

function validPosition(value: unknown): boolean {
  return record(value) && typeof value.assetId === "string" && typeof value.quantity === "string" && typeof value.costBasis === "string" && stringOrNull(value.marketValue) && stringOrNull(value.unrealizedPnl);
}

function validAsset(value: unknown): boolean {
  return record(value) && typeof value.id === "string" && typeof value.name === "string" && typeof value.category === "string" && typeof value.ticker === "string" && typeof value.currency === "string" && typeof value.unit === "string" && typeof value.enabled === "boolean" && typeof value.displayOrder === "number" && stringOrNull(value.usdPrice) && stringOrNull(value.marketDate) && ["ACTIVE", "STALE", "ERROR", "MISSING"].includes(String(value.quoteStatus));
}

function validTransaction(value: unknown): boolean {
  return record(value) && typeof value.id === "string" && ["BUY", "SELL", "RESET"].includes(String(value.type)) && stringOrNull(value.assetId) && stringOrNull(value.quantity) && stringOrNull(value.usdUnitPrice) && typeof value.usdAmount === "string" && typeof value.createdAt === "string";
}

function account(value: unknown): AccountProjection {
  if (!value || typeof value !== "object") return invalidResponse("Account response is missing");
  const record = value as Record<string, unknown>;
  const decimals = ["cash", "holdingsValue", "netWorth", "pnl"];
  if (typeof record.walletAddress !== "string" || decimals.some((key) => typeof record[key] !== "string") || !Array.isArray(record.positions) || !record.positions.every(validPosition) || !Array.isArray(record.assets) || !record.assets.every(validAsset) || !Array.isArray(record.recentTransactions) || !record.recentTransactions.every(validTransaction) || !stringOrNull(record.marketAsOf) || typeof record.updatedAt !== "string" || typeof record.settlementLocked !== "boolean") {
    return invalidResponse("Account response is malformed");
  }
  return value as AccountProjection;
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
  await response<{ ok: true }>(fetch("/api/auth/logout", json("POST")));
}

export const getGame = async (): Promise<AccountProjection> => account(await response<unknown>(fetch("/api/game", json("GET"))));
export const submitTrade = async (command: TradeInput): Promise<AccountProjection> => account(await response<unknown>(fetch("/api/trades", json("POST", command))));
export const resetGame = async (idempotencyKey: string): Promise<AccountProjection> => account(await response<unknown>(fetch("/api/game/reset", json("POST", { idempotencyKey }))));
export const getTransactions = (cursor?: string, limit = 50): Promise<TransactionPage> => {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  return response(fetch(`/api/trades?${params}`, json("GET")));
};
export const getLeaderboard = (): Promise<LeaderboardSnapshot> => response(fetch("/api/leaderboard", json("GET")));

export { toHexSignature };
