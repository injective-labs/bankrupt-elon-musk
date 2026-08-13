import { NextResponse } from "next/server";

import { authenticateGameRequest } from "@/server/auth";
import { ApiError, toErrorResponse } from "@/server/http/errors";
import { executeTradePlan } from "@/server/tradePlans";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const walletAddress = await authenticateGameRequest(request, "game:trade");
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError(422, "INVALID_JSON", "Request body must be valid JSON");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)
      || Object.keys(body).length !== 1 || !("signature" in body)
      || typeof body.signature !== "string") {
      throw new ApiError(422, "INVALID_REQUEST", "Only a confirmation signature is accepted");
    }
    const { id } = await context.params;
    return NextResponse.json(await executeTradePlan(walletAddress, id, body.signature));
  } catch (error) {
    return toErrorResponse(error);
  }
}
