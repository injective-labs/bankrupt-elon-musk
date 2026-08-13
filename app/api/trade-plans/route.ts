import { NextResponse } from "next/server";

import { authenticateGameRequest } from "@/server/auth";
import { ApiError, toErrorResponse } from "@/server/http/errors";
import { prepareTradePlan } from "@/server/tradePlans";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const walletAddress = await authenticateGameRequest(request, "game:trade");
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError(422, "INVALID_JSON", "Request body must be valid JSON");
    }
    return NextResponse.json(await prepareTradePlan(walletAddress, body));
  } catch (error) {
    return toErrorResponse(error);
  }
}
