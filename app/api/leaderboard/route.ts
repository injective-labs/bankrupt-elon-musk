import { NextResponse } from "next/server";
import { authenticateGameRequest, verifyToken } from "@/server/auth";
import { getLossLeaderboard } from "@/server/leaderboard";
import { readSessionCookie } from "@/server/http/sessionCookie";
import { toErrorResponse } from "@/server/http/errors";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const authorization = request.headers.get("authorization");
    const token = readSessionCookie(request);
    const walletAddress = authorization !== null
      ? await authenticateGameRequest(request, "game:read")
      : token ? await verifyToken(token) : null;
    return NextResponse.json(await getLossLeaderboard(walletAddress, 10));
  } catch (error) {
    return toErrorResponse(error);
  }
}
