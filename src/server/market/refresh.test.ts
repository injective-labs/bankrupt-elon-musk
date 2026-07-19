import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchDailyBar: vi.fn(),
  assetFindMany: vi.fn(),
  quoteFindUnique: vi.fn(),
  quoteUpsert: vi.fn(),
  quoteUpdateMany: vi.fn(),
  dailyUpsert: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("./yahoo", () => ({ fetchDailyBar: mocks.fetchDailyBar }));
vi.mock("@/server/db", () => ({
  prisma: {
    asset: { findMany: mocks.assetFindMany },
    assetQuote: {
      findUnique: mocks.quoteFindUnique,
      upsert: mocks.quoteUpsert,
      updateMany: mocks.quoteUpdateMany,
    },
    assetDailyPrice: { upsert: mocks.dailyUpsert },
    $transaction: mocks.transaction,
  },
}));

import { refreshMarket } from "./refresh";

const usdAsset = {
  id: "apple",
  quoteSymbol: "AAPL",
  currency: "USD",
  quoteMultiplier: new Prisma.Decimal(1),
};
const hkdAsset = {
  id: "tencent",
  quoteSymbol: "0700.HK",
  currency: "HKD",
  quoteMultiplier: new Prisma.Decimal(2),
};

function bar(symbol: string, close: number, currency = "USD", date = "2026-07-17") {
  return {
    symbol,
    marketDate: new Date(`${date}T00:00:00.000Z`),
    open: close - 1,
    high: close + 1,
    low: close - 2,
    close,
    currency,
  };
}

describe("refreshMarket", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (callback) => callback({
      assetQuote: { upsert: mocks.quoteUpsert },
      assetDailyPrice: { upsert: mocks.dailyUpsert },
    }));
    mocks.quoteFindUnique.mockResolvedValue(null);
    mocks.quoteUpsert.mockResolvedValue({});
    mocks.dailyUpsert.mockResolvedValue({});
    mocks.quoteUpdateMany.mockResolvedValue({ count: 0 });
  });

  it("persists only the latest daily row and the matching quote with one FX snapshot", async () => {
    mocks.assetFindMany.mockResolvedValue([usdAsset, hkdAsset]);
    mocks.fetchDailyBar.mockImplementation(async (symbol: string) => {
      if (symbol === "HKDUSD=X") return bar(symbol, 0.128, "USD");
      if (symbol === "AAPL") return bar(symbol, 200);
      if (symbol === "0700.HK") return bar(symbol, 300, "HKD");
      throw new Error(`unexpected ${symbol}`);
    });

    const summary = await refreshMarket({ now: new Date("2026-07-19T10:00:00Z"), concurrency: 2 });

    expect(summary).toEqual({
      attempted: 2,
      active: 2,
      stale: 0,
      failed: 0,
      marketDates: { apple: "2026-07-17", tencent: "2026-07-17" },
    });
    expect(mocks.fetchDailyBar.mock.calls.filter(([symbol]) => symbol === "HKDUSD=X")).toHaveLength(1);
    expect(mocks.dailyUpsert).toHaveBeenCalledTimes(2);
    expect(mocks.dailyUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { assetId_marketDate: { assetId: "tencent", marketDate: new Date("2026-07-17") } },
      create: expect.objectContaining({
        close: new Prisma.Decimal(600),
        fxRateToUsd: new Prisma.Decimal("0.128"),
        usdClose: new Prisma.Decimal("76.8"),
      }),
    }));
    expect(mocks.quoteUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { assetId: "tencent" },
      create: expect.objectContaining({
        nativePrice: new Prisma.Decimal(600),
        fxRateToUsd: new Prisma.Decimal("0.128"),
        usdPrice: new Prisma.Decimal("76.8"),
        status: "ACTIVE",
      }),
    }));
  });

  it("keeps a failed asset's last price, marks it error, and commits other assets", async () => {
    mocks.assetFindMany.mockResolvedValue([usdAsset, hkdAsset]);
    mocks.quoteFindUnique.mockImplementation(async ({ where: { assetId } }) =>
      assetId === "tencent" ? { marketDate: new Date("2026-07-16") } : null,
    );
    mocks.fetchDailyBar.mockImplementation(async (symbol: string) => {
      if (symbol === "HKDUSD=X") return bar(symbol, 0.128);
      if (symbol === "AAPL") return bar(symbol, 200);
      throw new Error("upstream unavailable");
    });

    const summary = await refreshMarket({ now: new Date("2026-07-19T10:00:00Z") });

    expect(summary).toMatchObject({ attempted: 2, active: 1, stale: 1, failed: 1 });
    expect(mocks.dailyUpsert).toHaveBeenCalledTimes(1);
    expect(mocks.quoteUpsert).toHaveBeenCalledTimes(1);
    expect(mocks.quoteUpdateMany).toHaveBeenCalledWith({
      where: { assetId: "tencent" },
      data: { status: "ERROR", fetchedAt: new Date("2026-07-19T10:00:00Z") },
    });
  });

  it("never overwrites either table with an older upstream market date", async () => {
    mocks.assetFindMany.mockResolvedValue([usdAsset]);
    mocks.quoteFindUnique.mockResolvedValue({ marketDate: new Date("2026-07-18") });
    mocks.fetchDailyBar.mockResolvedValue(bar("AAPL", 190, "USD", "2026-07-17"));

    const summary = await refreshMarket({ now: new Date("2026-07-19T10:00:00Z") });

    expect(summary).toEqual({
      attempted: 1,
      active: 1,
      stale: 0,
      failed: 0,
      marketDates: { apple: "2026-07-18" },
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.dailyUpsert).not.toHaveBeenCalled();
    expect(mocks.quoteUpsert).not.toHaveBeenCalled();
  });

  it("bounds concurrent asset requests", async () => {
    mocks.assetFindMany.mockResolvedValue([
      usdAsset,
      { ...usdAsset, id: "microsoft", quoteSymbol: "MSFT" },
      { ...usdAsset, id: "nvidia", quoteSymbol: "NVDA" },
    ]);
    let inFlight = 0;
    let maximum = 0;
    mocks.fetchDailyBar.mockImplementation(async (symbol: string) => {
      inFlight += 1;
      maximum = Math.max(maximum, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return bar(symbol, 100);
    });

    await refreshMarket({ concurrency: 2 });

    expect(maximum).toBe(2);
  });
});
