import { NextResponse } from "next/server";

import { loginPlayer } from "@/server/account";
import {
  AGENT_TTL_SECONDS,
  isValidAddress,
  verifyAndIssueAgentToken,
} from "@/server/auth";
import { ApiError, toErrorResponse } from "@/server/http/errors";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: { address?: string; signature?: string; walletName?: string | null };
  try {
    body = await request.json();
  } catch {
    return toErrorResponse(new ApiError(400, "INVALID_JSON", "Invalid JSON"));
  }
  if (!isValidAddress(body.address) || typeof body.signature !== "string") {
    return toErrorResponse(new ApiError(400, "INVALID_REQUEST", "Invalid address or signature"));
  }

  try {
    const accessToken = await verifyAndIssueAgentToken(body.address, body.signature);
    if (!accessToken) {
      throw new ApiError(401, "INVALID_SIGNATURE", "Signature verification failed");
    }
    const player = await loginPlayer(body.address, body.walletName);
    return NextResponse.json({
      walletAddress: player.walletAddress,
      walletName: player.walletName,
      accessToken,
      expiresIn: AGENT_TTL_SECONDS,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
