import { Prisma, QuoteStatus } from "@prisma/client";

import { FX_SYMBOLS } from "@/data/constants";
import { prisma } from "@/server/db";

import { fetchDailyBar, type DailyBar } from "./yahoo";

const SOURCE = "Yahoo Finance";
const DEFAULT_CONCURRENCY = 8;
const MAX_CONCURRENCY = 32;

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

export async function persistDailyBarIfCurrent(
  asset: RefreshAsset,
  bar: DailyBar,
  fxRate: Prisma.Decimal,
  fetchedAt: Date,
) {
  const marketDate = utcMarketDate(bar.marketDate);
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

  const persisted = await prisma.$transaction(async (tx) => {
    const accepted = await tx.$queryRaw<Array<{ marketDate: Date }>>(Prisma.sql`
      INSERT INTO "AssetQuote" (
        "assetId", "nativePrice", "currency", "fxRateToUsd", "usdPrice",
        "marketDate", "source", "status", "fetchedAt", "updatedAt"
      ) VALUES (
        ${asset.id}, ${close}, ${asset.currency}, ${fxRate}, ${usdClose},
        ${marketDate}, ${SOURCE}, 'ACTIVE'::"QuoteStatus", ${fetchedAt}, ${fetchedAt}
      )
      ON CONFLICT ("assetId") DO UPDATE SET
        "nativePrice" = EXCLUDED."nativePrice",
        "currency" = EXCLUDED."currency",
        "fxRateToUsd" = EXCLUDED."fxRateToUsd",
        "usdPrice" = EXCLUDED."usdPrice",
        "marketDate" = EXCLUDED."marketDate",
        "source" = EXCLUDED."source",
        "status" = EXCLUDED."status",
        "fetchedAt" = EXCLUDED."fetchedAt",
        "updatedAt" = EXCLUDED."updatedAt"
      WHERE "AssetQuote"."marketDate" <= EXCLUDED."marketDate"
      RETURNING "marketDate"
    `);
    if (accepted.length === 0) return null;

    await tx.assetDailyPrice.upsert({
      where: { assetId_marketDate: { assetId: asset.id, marketDate } },
      create: { assetId: asset.id, marketDate, open, high, low, close, usdClose, ...shared },
      update: { open, high, low, close, usdClose, ...shared },
    });
    return accepted[0].marketDate;
  });
  if (persisted) return persisted;

  const current = await prisma.assetQuote.findUnique({
    where: { assetId: asset.id },
    select: { marketDate: true },
  });
  if (!current) throw new Error(`Atomic quote update returned no row for ${asset.id}`);
  return current.marketDate;
}

export async function refreshMarket(options: RefreshMarketOptions = {}): Promise<RefreshSummary> {
  const fetchedAt = options.now ?? new Date();
  const requestedConcurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  if (!Number.isFinite(requestedConcurrency)
    || !Number.isInteger(requestedConcurrency)
    || requestedConcurrency <= 0) {
    throw new RangeError("concurrency must be a finite positive integer");
  }
  const concurrency = Math.min(requestedConcurrency, MAX_CONCURRENCY);
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
      const marketDate = await persistDailyBarIfCurrent(asset, bar, fxRate, fetchedAt);
      marketDates[asset.id] = dateKey(marketDate);
      active += 1;
    } catch {
      failed += 1;
      const marked = await prisma.assetQuote.updateMany({
        where: {
          assetId: asset.id,
          fetchedAt: { lt: fetchedAt },
          updatedAt: { lt: fetchedAt },
        },
        data: { status: QuoteStatus.ERROR, fetchedAt },
      });
      const existing = await prisma.assetQuote.findUnique({
        where: { assetId: asset.id },
        select: { marketDate: true },
      });
      if (marked.count > 0) {
        stale += 1;
      }
      if (existing) marketDates[asset.id] = dateKey(existing.marketDate);
    }
  });

  return { attempted: assets.length, active, stale, failed, marketDates };
}
