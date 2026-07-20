import { NextResponse } from "next/server";
import { getMarketProjection } from "@/server/market/projection";
import { toErrorResponse } from "@/server/http/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getMarketProjection());
  } catch (error) {
    return toErrorResponse(error);
  }
}
