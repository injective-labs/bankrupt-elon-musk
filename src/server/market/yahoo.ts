export interface DailyBar {
  symbol: string;
  marketDate: Date;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  currency: string;
}

interface YahooResult {
  meta?: { currency?: unknown };
  timestamp?: unknown[];
  indicators?: {
    quote?: Array<{
      open?: unknown[];
      high?: unknown[];
      low?: unknown[];
      close?: unknown[];
    }>;
  };
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function parseYahooDailyBar(symbol: string, payload: unknown): DailyBar {
  const result = (payload as { chart?: { result?: YahooResult[] } })?.chart?.result?.[0];
  const currency = result?.meta?.currency;
  if (typeof currency !== "string" || !currency.trim()) {
    throw new Error(`Yahoo response is missing currency: ${symbol}`);
  }

  const quote = result?.indicators?.quote?.[0];
  const closes = quote?.close ?? [];
  const timestamps = result?.timestamp ?? [];
  for (let index = Math.min(closes.length, timestamps.length) - 1; index >= 0; index -= 1) {
    const close = optionalNumber(closes[index]);
    const timestamp = optionalNumber(timestamps[index]);
    if (close !== null && close > 0 && timestamp !== null && timestamp > 0) {
      return {
        symbol,
        marketDate: new Date(timestamp * 1_000),
        open: optionalNumber(quote?.open?.[index]),
        high: optionalNumber(quote?.high?.[index]),
        low: optionalNumber(quote?.low?.[index]),
        close,
        currency: currency.trim(),
      };
    }
  }
  throw new Error(`Yahoo returned no valid daily bar: ${symbol}`);
}

export interface FetchDailyBarOptions {
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

const YAHOO_USER_AGENT = "INJ-Pass-Market-Refresh/1.0";

export async function fetchDailyBar(
  symbol: string,
  options: FetchDailyBarOptions = {},
): Promise<DailyBar> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
  const url = new URL(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`,
  );
  url.searchParams.set("range", "10d");
  url.searchParams.set("interval", "1d");
  url.searchParams.set("events", "history");

  try {
    const response = await fetchImpl(url.toString(), {
      headers: { "User-Agent": YAHOO_USER_AGENT, Accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`Yahoo request failed for ${symbol}: HTTP ${response.status}`);
    }
    return parseYahooDailyBar(symbol, await response.json());
  } finally {
    clearTimeout(timeout);
  }
}
