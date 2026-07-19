import { NextResponse } from "next/server";
import { authenticateRequest } from "@/server/auth";
import { getAccountProjection } from "@/server/account";
import { toErrorResponse } from "@/server/http/errors";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const walletAddress = await authenticateRequest(request);
    return NextResponse.json(await getAccountProjection(walletAddress));
  } catch (error) {
    return toErrorResponse(error);
  }
}
