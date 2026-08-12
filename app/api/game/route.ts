import { NextResponse } from "next/server";
import { authenticateGameRequest } from "@/server/auth";
import { getAccountProjection } from "@/server/account";
import { toErrorResponse } from "@/server/http/errors";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const walletAddress = await authenticateGameRequest(request, "game:read");
    return NextResponse.json(await getAccountProjection(walletAddress));
  } catch (error) {
    return toErrorResponse(error);
  }
}
