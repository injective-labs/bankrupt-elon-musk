import { NextResponse } from "next/server";

export const runtime = "nodejs";

function retiredResponse() {
  return NextResponse.json(
    { error: { code: "GAME_STATE_API_RETIRED", message: "Legacy game state API is retired" } },
    { status: 503 },
  );
}

export async function GET(_request: Request) {
  return retiredResponse();
}

export async function PUT(_request: Request) {
  return retiredResponse();
}
