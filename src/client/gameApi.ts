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

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  credentials: "same-origin",
  headers: body === undefined ? undefined : { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

export async function getSession(): Promise<SessionView | null> {
  try { return await response<SessionView>(fetch("/api/auth/session", json("GET"))); }
  catch (error) { if (error instanceof GameApiError && error.status === 401) return null; throw error; }
}

export async function loginWithSignature(address: string, walletName: string | null, signMessage: MessageSigner): Promise<SessionView> {
  const challenge = await response<{ nonce: string; message: string }>(fetch("/api/auth/nonce", json("POST", { address })));
  const signature = toHexSignature(await signMessage(challenge.message));
  return response<SessionView>(fetch("/api/auth/verify", json("POST", { address, walletName, signature })));
}

export async function logout(): Promise<void> {
  await response<{ ok: true }>(fetch("/api/auth/logout", json("POST")));
}

export const getGame = (): Promise<AccountProjection> => response(fetch("/api/game", json("GET")));
export const submitTrade = (command: TradeInput): Promise<AccountProjection> => response(fetch("/api/trades", json("POST", command)));
export const resetGame = (idempotencyKey: string): Promise<AccountProjection> => response(fetch("/api/game/reset", json("POST", { idempotencyKey })));
export const getTransactions = (cursor?: string, limit = 50): Promise<TransactionPage> => {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  return response(fetch(`/api/trades?${params}`, json("GET")));
};
export const getLeaderboard = (): Promise<LeaderboardSnapshot> => response(fetch("/api/leaderboard", json("GET")));

export { toHexSignature };
