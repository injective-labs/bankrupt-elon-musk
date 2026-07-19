import { NextResponse } from "next/server";
import { authenticateRequest } from "@/server/auth";
import { ApiError, toErrorResponse } from "@/server/http/errors";
import { executeTrade, getTradeHistory, type TradeCommand } from "@/server/trades";

export const runtime = "nodejs";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function command(value: unknown): TradeCommand {
  if (!value || typeof value !== "object") throw new ApiError(422, "INVALID_TRADE", "Trade command is required");
  const input = value as Record<string, unknown>;
  if (typeof input.assetId !== "string" || !input.assetId || (input.side !== "BUY" && input.side !== "SELL") || typeof input.quantity !== "string" || typeof input.idempotencyKey !== "string" || !UUID.test(input.idempotencyKey)) {
    throw new ApiError(422, "INVALID_TRADE", "Invalid asset, side, quantity, or idempotency key");
  }
  return { assetId: input.assetId, side: input.side, quantity: input.quantity, idempotencyKey: input.idempotencyKey };
}

export async function POST(request: Request) {
  try {
    const wallet = await authenticateRequest(request);
    let body: unknown;
    try { body = await request.json(); } catch { throw new ApiError(422, "INVALID_JSON", "Request body must be valid JSON"); }
    return NextResponse.json(await executeTrade(wallet, command(body)));
  } catch (error) { return toErrorResponse(error); }
}

export async function GET(request: Request) {
  try {
    const wallet = await authenticateRequest(request);
    const params = new URL(request.url).searchParams;
    const raw = params.get("limit");
    const parsed = raw === null ? 50 : Number(raw);
    const limit = Number.isFinite(parsed) ? Math.max(1, Math.min(Math.trunc(parsed), 100)) : 50;
    return NextResponse.json(await getTradeHistory(wallet, { cursor: params.get("cursor") ?? undefined, limit }));
  } catch (error) { return toErrorResponse(error); }
}
