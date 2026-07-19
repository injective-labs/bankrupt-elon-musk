import { NextResponse } from "next/server";
import { authenticateRequest } from "@/server/auth";
import { findPlayer } from "@/server/account";
import { ApiError, toErrorResponse } from "@/server/http/errors";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const walletAddress = await authenticateRequest(request);
    const player = await findPlayer(walletAddress);
    if (!player) throw new ApiError(401, "UNAUTHORIZED", "Player session no longer exists");
    return NextResponse.json({
      walletAddress: player.walletAddress,
      walletName: player.walletName,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
