// Same-origin client for the built-in game backend (app/api/*).
import type { GameState, LeaderboardSnapshot } from "@/types";

export interface SaveMetrics {
  netWorth: number;
  pnl: number;
  holdingsValue: number;
}

function toHexSignature(sig: Uint8Array): `0x${string}` {
  return ("0x" +
    Array.from(sig)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")) as `0x${string}`;
}

export { toHexSignature };

export async function requestNonce(address: string): Promise<{ nonce: string; message: string }> {
  const res = await fetch("/api/auth/nonce", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address }),
  });
  if (!res.ok) throw new Error(`nonce failed: ${res.status}`);
  return res.json();
}

export async function verifySignature(
  address: string,
  signature: string,
): Promise<string | null> {
  const res = await fetch("/api/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address, signature }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { token?: string };
  return data.token ?? null;
}

// Persistence is keyed purely by wallet address (anonymous device address, or the
// INJ Pass address once linked) — no signature/token step required.
export async function getCloudState(wallet: string): Promise<GameState | null> {
  const res = await fetch(`/api/state?wallet=${encodeURIComponent(wallet)}`);
  if (!res.ok) return null;
  const data = (await res.json()) as { state?: GameState | null };
  return data.state ?? null;
}

export async function putCloudState(
  wallet: string,
  state: GameState,
  metrics: SaveMetrics,
  walletName?: string | null,
): Promise<boolean> {
  const res = await fetch("/api/state", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletAddress: wallet, state, metrics, walletName }),
  });
  return res.ok;
}

export async function getLeaderboard(wallet?: string | null): Promise<LeaderboardSnapshot | null> {
  const qs = wallet ? `?wallet=${encodeURIComponent(wallet)}` : "";
  const res = await fetch(`/api/leaderboard${qs}`);
  if (!res.ok) return null;
  return res.json();
}
