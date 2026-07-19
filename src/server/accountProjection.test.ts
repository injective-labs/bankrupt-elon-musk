import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  playerFindUnique: vi.fn(),
  assetFindMany: vi.fn(),
  transactionFindMany: vi.fn(),
}));

vi.mock("./db", () => ({
  prisma: {
    player: { findUnique: mocks.playerFindUnique },
    asset: { findMany: mocks.assetFindMany },
    transaction: { findMany: mocks.transactionFindMany },
  },
}));

import { getAccountProjection } from "./account";

const d = (value: string) => new Prisma.Decimal(value);

describe("getAccountProjection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-19T12:00:00.000Z"));
    mocks.transactionFindMany.mockResolvedValue([]);
  });

  it("computes exact account metrics from Decimal cash, positions, and authoritative quotes", async () => {
    mocks.playerFindUnique.mockResolvedValue({
      walletAddress: "0xabc",
      walletName: "alice",
      cash: d("100.10"),
      updatedAt: new Date("2026-07-19T11:00:00Z"),
      positions: [
        { assetId: "a", quantity: d("2.5"), costBasis: d("30") },
        { assetId: "b", quantity: d("3"), costBasis: d("12.25") },
      ],
    });
    mocks.assetFindMany.mockResolvedValue([
      { id: "a", ticker: "A", nameZh: "甲", nameEn: "A", assetClass: "股", subCategory: null, currency: "USD", unit: "股", enabled: true, displayOrder: 1, quote: { usdPrice: d("20.02"), marketDate: new Date("2026-07-18"), status: "ACTIVE" } },
      { id: "b", ticker: "B", nameZh: "乙", nameEn: null, assetClass: "币", subCategory: null, currency: "USD", unit: "枚", enabled: true, displayOrder: 2, quote: { usdPrice: d("5.5"), marketDate: new Date("2026-07-18"), status: "ACTIVE" } },
    ]);

    const result = await getAccountProjection("0xabc");

    expect(result.cash).toBe("100.1");
    expect(result.holdingsValue).toBe("66.55");
    expect(result.netWorth).toBe("166.65");
    expect(result.pnl).toBe("-49999999833.35");
    expect(result.positions).toEqual([
      { assetId: "a", quantity: "2.5", costBasis: "30", marketValue: "50.05", unrealizedPnl: "20.05" },
      { assetId: "b", quantity: "3", costBasis: "12.25", marketValue: "16.5", unrealizedPnl: "4.25" },
    ]);
    expect(result).not.toHaveProperty("metrics");
  });

  it("marks missing and older-than-seven-day quotes without exposing internal ids", async () => {
    mocks.playerFindUnique.mockResolvedValue({ walletAddress: "0xabc", walletName: null, cash: d("10"), updatedAt: new Date("2026-07-19"), positions: [] });
    mocks.assetFindMany.mockResolvedValue([
      { id: "missing", ticker: "M", nameZh: "缺", nameEn: null, assetClass: "股", subCategory: null, currency: "USD", unit: "股", enabled: true, displayOrder: 1, quote: null },
      { id: "old", ticker: "O", nameZh: "旧", nameEn: null, assetClass: "股", subCategory: null, currency: "USD", unit: "股", enabled: true, displayOrder: 2, quote: { usdPrice: d("1"), marketDate: new Date("2026-07-11T12:00:00Z"), status: "ACTIVE", source: "secret" } },
    ]);

    const result = await getAccountProjection("0xabc");

    expect(result.assets.map(({ id, quoteStatus, usdPrice }) => ({ id, quoteStatus, usdPrice }))).toEqual([
      { id: "missing", quoteStatus: "MISSING", usdPrice: null },
      { id: "old", quoteStatus: "STALE", usdPrice: "1" },
    ]);
    expect(result.marketAsOf).toBe("2026-07-11T12:00:00.000Z");
    expect(result.assets[1]).not.toHaveProperty("source");
  });
});
