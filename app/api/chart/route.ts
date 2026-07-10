import { NextResponse } from "next/server";

// Port of server.py's /api/chart proxy: forwards to Yahoo Finance server-side
// so the browser avoids CORS and we can cache briefly.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = (searchParams.get("symbol") || "").trim();
  if (!symbol) {
    return NextResponse.json({ error: "Missing symbol" }, { status: 400 });
  }
  const range = searchParams.get("range") || "10d";
  const interval = searchParams.get("interval") || "1d";

  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}`;

  try {
    const upstream = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      // Let the route's own caching govern; don't use Next's fetch cache here.
      cache: "no-store",
    });
    if (!upstream.ok) {
      return NextResponse.json(
        { error: `Quote proxy failed: ${upstream.status}` },
        { status: 502 },
      );
    }
    const payload = await upstream.text();
    return new NextResponse(payload, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=30",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `Quote proxy failed: ${message}` }, { status: 502 });
  }
}
