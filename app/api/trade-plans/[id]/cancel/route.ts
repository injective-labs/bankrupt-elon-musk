import { NextResponse } from "next/server";

import { authenticateGameRequest } from "@/server/auth";
import { toErrorResponse } from "@/server/http/errors";
import { cancelTradePlan } from "@/server/tradePlans";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const walletAddress = await authenticateGameRequest(request, "game:trade");
    const { id } = await context.params;
    return NextResponse.json(await cancelTradePlan(walletAddress, id));
  } catch (error) {
    return toErrorResponse(error);
  }
}
