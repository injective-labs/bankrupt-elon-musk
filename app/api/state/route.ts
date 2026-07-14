import { NextResponse } from "next/server";
import { isValidWallet, walletFromQuery } from "@/server/wallet";
import { loadState, saveState, type SaveMetrics } from "@/server/gameState";
import type { GameState } from "@/types";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const wallet = walletFromQuery(request);
  if (!wallet) return NextResponse.json({ error: "Missing or invalid wallet" }, { status: 400 });
  const state = await loadState(wallet);
  return NextResponse.json({ state });
}

export async function PUT(request: Request) {
  let body: {
    walletAddress?: string;
    state?: GameState;
    metrics?: SaveMetrics;
    walletName?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!isValidWallet(body.walletAddress)) {
    return NextResponse.json({ error: "Missing or invalid wallet" }, { status: 400 });
  }
  if (!body.state || !body.metrics) {
    return NextResponse.json({ error: "Missing state or metrics" }, { status: 400 });
  }
  await saveState(body.walletAddress, {
    state: body.state,
    metrics: body.metrics,
    walletName: body.walletName,
  });
  return NextResponse.json({ ok: true });
}
