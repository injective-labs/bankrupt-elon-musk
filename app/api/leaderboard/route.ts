import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Task 5 will replace this explicit unavailable response with authoritative,
// quote-based loss rankings. Do not synthesize financial results in the interim.
export async function GET() {
  return NextResponse.json(
    {
      error: {
        code: "LEADERBOARD_UNAVAILABLE",
        message: "Leaderboard is unavailable while authoritative ranking is being upgraded.",
      },
    },
    { status: 503 },
  );
}
