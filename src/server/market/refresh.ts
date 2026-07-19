import { Prisma, QuoteStatus } from "@prisma/client";

import { FX_SYMBOLS } from "@/data/constants";
import { prisma } from "@/server/db";

import { fetchDailyBar, type DailyBar } from "./yahoo";

const SOURCE = "Yahoo Finance";
const DEFAULT_CONCURRENCY = 8;

export interface RefreshSummary {
  attempted: number;
  active: number;
  stale: number;
  failed: number;
  marketDates: Record<string, string>;
}

export interface RefreshMarketOptions {
  now?: Date;
  concurrency?: number;
}

interface RefreshAsset {
  id: string;
  quoteSymbol: string;
  currency: string;
  quoteMultiplier: Prisma.Decimal;
}

async function mapConcurrent<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor++;
      try {
        results[index] = { status: "fulfilled", value: await mapper(values[index]) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => worker()),
  );
  return results;
}

function utcMarketDate(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function scaled(value: number | null, multiplier: Prisma.Decimal): Prisma.Decimal | null {
  return value === null ? null : new Prisma.Decimal(value).mul(multiplier);
}

async function loadFxRates(assets: RefreshAsset[], concurrency: number) {
  const currencies = [...new Set(assets.map((asset) => asset.currency).filter((value) => value !== "USD"))];
  const yahooCurrencies = [...new Set(currencies.map((value) => value === "GBp" ? "GBP" : value))];
  const entries = await mapConcurrent(yahooCurrencies, concurrency, async (currency) => {
    const symbol = FX_SYMBOLS[currency];
    if (!symbol) throw new Error(`No Yahoo FX symbol configured for ${currency}`);
    const fxBar = await fetchDailyBar(symbol);
    if (!(fxBar.close > 0)) throw new Error(`Invalid Yahoo FX rate for ${currency}`);
    return [currency, new Prisma.Decimal(fxBar.close)] as const;
  });
  const rates = new Map<string, Prisma.Decimal>([["USD", new Prisma.Decimal(1)]]);
  entries.forEach((entry) => {
    if (entry.status === "fulfilled") rates.set(...entry.value);
  });
  const gbp = rates.get("GBP");
  if (gbp?.isFinite()) rates.set("GBp", gbp.div(100));
  return rates;
}

async function persistBar(asset: RefreshAsset, bar: DailyBar, fxRate: Prisma.Decimal, fetchedAt: Date) {
  const marketDate = utcMarketDate(bar.marketDate);
  const existing = await prisma.assetQuote.findUnique({
    where: { assetId: asset.id },
    select: { marketDate: true },
  });
  if (existing && existing.marketDate > marketDate) return existing.marketDate;

  const close = scaled(bar.close, asset.quoteMultiplier) as Prisma.Decimal;
  const open = scaled(bar.open, asset.quoteMultiplier);
  const high = scaled(bar.high, asset.quoteMultiplier);
  const low = scaled(bar.low, asset.quoteMultiplier);
  const usdClose = close.mul(fxRate);
  const shared = {
    currency: asset.currency,
    fxRateToUsd: fxRate,
    source: SOURCE,
    fetchedAt,
  };

  await prisma.$transaction(async (tx) => {
    await tx.assetDailyPrice.upsert({
      where: { assetId_marketDate: { assetId: asset.id, marketDate } },
      create: { assetId: asset.id, marketDate, open, high, low, close, usdClose, ...shared },
      update: { open, high, low, close, usdClose, ...shared },
    });
    await tx.assetQuote.upsert({
      where: { assetId: asset.id },
      create: {
        assetId: asset.id,
        nativePrice: close,
        usdPrice: usdClose,
        marketDate,
        status: QuoteStatus.ACTIVE,
        ...shared,
      },
      update: {
        nativePrice: close,
        usdPrice: usdClose,
        marketDate,
        status: QuoteStatus.ACTIVE,
        ...shared,
      },
    });
  });
  return marketDate;
}

export async function refreshMarket(options: RefreshMarketOptions = {}): Promise<RefreshSummary> {
  const fetchedAt = options.now ?? new Date();
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? DEFAULT_CONCURRENCY));
  const assets = await prisma.asset.findMany({
    where: { enabled: true },
    orderBy: { displayOrder: "asc" },
    select: { id: true, quoteSymbol: true, currency: true, quoteMultiplier: true },
  });
  const fxRates = await loadFxRates(assets, concurrency);
  const marketDates: Record<string, string> = {};
  let active = 0;
  let stale = 0;
  let failed = 0;

  await mapConcurrent(assets, concurrency, async (asset) => {
    try {
      const fxRate = fxRates.get(asset.currency);
      if (!fxRate?.isFinite() || !fxRate.greaterThan(0)) {
        throw new Error(`FX rate unavailable for ${asset.currency}`);
      }
      const bar = await fetchDailyBar(asset.quoteSymbol);
      const marketDate = await persistBar(asset, bar, fxRate, fetchedAt);
      marketDates[asset.id] = dateKey(marketDate);
      active += 1;
    } catch {
      failed += 1;
      const existing = await prisma.assetQuote.findUnique({
        where: { assetId: asset.id },
        select: { marketDate: true },
      });
      if (existing) {
        stale += 1;
        marketDates[asset.id] = dateKey(existing.marketDate);
        await prisma.assetQuote.updateMany({
          where: { assetId: asset.id },
          data: { status: QuoteStatus.ERROR, fetchedAt },
        });
      }
    }
  });

  return { attempted: assets.length, active, stale, failed, marketDates };
}
