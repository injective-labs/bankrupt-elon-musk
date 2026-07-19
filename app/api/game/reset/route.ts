import { NextResponse } from "next/server";
import { authenticateRequest } from "@/server/auth";
import { ApiError, toErrorResponse } from "@/server/http/errors";
import { resetAccount } from "@/server/reset";

export const runtime = "nodejs";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  try {
    const walletAddress = await authenticateRequest(request);
    let body: unknown;
    try { body = await request.json(); } catch { throw new ApiError(422, "INVALID_JSON", "Request body must be valid JSON"); }
    const idempotencyKey = isRecord(body) ? body.idempotencyKey : undefined;
    if (typeof idempotencyKey !== "string" || !UUID.test(idempotencyKey)) {
      throw new ApiError(422, "INVALID_RESET", "A valid idempotency key is required");
    }
    return NextResponse.json(await resetAccount(walletAddress, idempotencyKey));
  } catch (error) {
    return toErrorResponse(error);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
