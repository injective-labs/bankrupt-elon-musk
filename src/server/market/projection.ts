import type { MarketProjection } from "@/types";
import { prisma } from "@/server/db";
import { isQuoteFresh } from "@/server/quoteFreshness";
import { decimalToString } from "@/server/decimal";

export async function getMarketProjection(now = new Date()): Promise<MarketProjection> {
  const assets = await prisma.asset.findMany({
    where: { enabled: true },
    include: { quote: true },
    orderBy: { displayOrder: "asc" },
  });
  const quoteDates = assets.flatMap((asset) => asset.quote ? [asset.quote.marketDate] : []);

  return {
    assets: assets.map((asset) => ({
      id: asset.id,
      name: asset.nameZh,
      nameEn: asset.nameEn,
      category: asset.assetClass,
      subCategory: asset.subCategory,
      ticker: asset.ticker,
      currency: asset.currency,
      unit: asset.unit,
      enabled: asset.enabled,
      displayOrder: asset.displayOrder,
      usdPrice: asset.quote ? decimalToString(asset.quote.usdPrice) : null,
      marketDate: asset.quote?.marketDate.toISOString() ?? null,
      quoteStatus: !asset.quote
        ? "MISSING"
        : !isQuoteFresh(asset.quote.marketDate, now)
          ? "STALE"
          : asset.quote.status,
    })),
    marketAsOf: quoteDates.length
      ? new Date(Math.max(...quoteDates.map((date) => date.getTime()))).toISOString()
      : null,
  };
}
