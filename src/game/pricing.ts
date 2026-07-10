import type { Product, FxRates, PriceQuote } from "@/types";
import { FX_SYMBOLS, FALLBACK_FX } from "@/data/constants";
import { getInvestmentProducts } from "@/data/categories";

export function getQuoteSymbol(product: Product): string | null {
  if (Object.prototype.hasOwnProperty.call(product, "quoteSymbol") && product.quoteSymbol === null) {
    return null;
  }
  if (product.quoteSymbol) return product.quoteSymbol;
  const ticker = product.ticker;
  if (!ticker || ticker === "SPACE") return null;
  if (product.subCategory === "加密货币" || product.assetClass === "加密货币") return `${ticker}-USD`;
  return ticker;
}

interface YahooChartPayload {
  chart?: {
    result?: Array<{
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
      timestamp?: number[];
      meta?: { currency?: string };
    }>;
  };
}

async function fetchYahooChartPayload(symbol: string): Promise<YahooChartPayload> {
  // In the Next app we always proxy through our own route handler (same origin,
  // no CORS), which forwards to Yahoo Finance server-side.
  const response = await fetch(
    `/api/chart?symbol=${encodeURIComponent(symbol)}&range=10d&interval=1d`,
  );
  if (!response.ok) throw new Error(`Price request failed: ${symbol}`);
  return response.json();
}

export async function fetchYahooDailyClose(
  symbol: string,
): Promise<{ price: number; date: string; currency: string }> {
  const payload = await fetchYahooChartPayload(symbol);
  const result = payload?.chart?.result?.[0];
  const closes = result?.indicators?.quote?.[0]?.close || [];
  const timestamps = result?.timestamp || [];
  for (let index = closes.length - 1; index >= 0; index -= 1) {
    const close = Number(closes[index]);
    if (Number.isFinite(close) && close > 0) {
      return {
        price: close,
        date: timestamps[index] ? new Date(timestamps[index] * 1000).toISOString().slice(0, 10) : "",
        currency: result?.meta?.currency || "USD",
      };
    }
  }
  throw new Error(`No close price: ${symbol}`);
}

export async function refreshFxRates(currentFx: FxRates): Promise<FxRates> {
  const fxRates: FxRates = { ...currentFx };
  const entries = await Promise.allSettled(
    Object.entries(FX_SYMBOLS).map(async ([currency, symbol]) => {
      const quote = await fetchYahooDailyClose(symbol);
      return [currency, quote.price] as [string, number];
    }),
  );
  entries.forEach((entry) => {
    if (entry.status === "fulfilled") {
      const [currency, rate] = entry.value;
      if (Number.isFinite(rate) && rate > 0) fxRates[currency] = rate;
    }
  });
  if (Number.isFinite(fxRates.GBP) && fxRates.GBP > 0) {
    fxRates.GBp = fxRates.GBP / 100;
  }
  return fxRates;
}

async function settleInBatches<T, R>(
  items: T[],
  batchSize: number,
  mapper: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const settled: PromiseSettledResult<R>[] = [];
  for (let index = 0; index < items.length; index += batchSize) {
    const batch = items.slice(index, index + batchSize);
    const results = await Promise.allSettled(batch.map(mapper));
    settled.push(...results);
  }
  return settled;
}

export interface PriceRefreshResult {
  prices: Record<string, PriceQuote>;
  fxRates: FxRates;
  lastPriceRefresh: string;
}

export async function refreshPrices(currentFx: FxRates): Promise<PriceRefreshResult> {
  const fxRates = await refreshFxRates(currentFx);
  const assets = getInvestmentProducts().filter((product) => getQuoteSymbol(product));
  const results = await settleInBatches(assets, 24, async (product) => {
    const quote = await fetchYahooDailyClose(getQuoteSymbol(product) as string);
    const currency = product.currency || quote.currency || "USD";
    const fx = currency === "USD" ? 1 : fxRates[currency] || FALLBACK_FX[currency] || 1;
    return [
      product.id,
      {
        nativePrice: quote.price,
        usdPrice: quote.price * fx,
        currency,
        closeDate: quote.date,
        source: "Yahoo Finance",
        updatedAt: new Date().toISOString(),
      } as PriceQuote,
    ] as [string, PriceQuote];
  });

  const prices: Record<string, PriceQuote> = {};
  results.forEach((entry) => {
    if (entry.status === "fulfilled") {
      const [id, quote] = entry.value;
      prices[id] = quote;
    }
  });

  return { prices, fxRates, lastPriceRefresh: new Date().toISOString() };
}
