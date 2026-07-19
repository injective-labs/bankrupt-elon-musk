import { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  playerFindUnique: vi.fn(),
  assetFindMany: vi.fn(),
  transactionFindMany: vi.fn(),
}));

vi.mock("./db", () => ({
  prisma: {
    $transaction: mocks.transaction,
    player: { findUnique: mocks.playerFindUnique },
    asset: { findMany: mocks.assetFindMany },
    transaction: { findMany: mocks.transactionFindMany },
  },
}));

import { getAccountProjection } from "./account";

const d = (value: string) => new Prisma.Decimal(value);

describe("getAccountProjection", () => {
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-19T12:00:00.000Z"));
    mocks.transactionFindMany.mockResolvedValue([]);
    mocks.transaction.mockImplementation((operation) => operation({
      player: { findUnique: mocks.playerFindUnique },
      asset: { findMany: mocks.assetFindMany },
      transaction: { findMany: mocks.transactionFindMany },
    }));
  });

  it("reads the complete projection in one repeatable-read snapshot", async () => {
    mocks.playerFindUnique.mockResolvedValue({ walletAddress: "0xabc", walletName: null, cash: d("10"), updatedAt: new Date("2026-07-19"), positions: [] });
    mocks.assetFindMany.mockResolvedValue([]);

    await getAccountProjection("0xabc");

    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.transaction.mock.calls[0][1]).toEqual({ isolationLevel: "RepeatableRead" });
  });

  it("exposes reset capability from the private server configuration", async () => {
    vi.stubEnv("ENABLE_GAME_RESET", "true");
    mocks.playerFindUnique.mockResolvedValue({ walletAddress: "0xabc", walletName: null, cash: d("10"), updatedAt: new Date("2026-07-19"), positions: [] });
    mocks.assetFindMany.mockResolvedValue([]);
    await expect(getAccountProjection("0xabc")).resolves.toMatchObject({ resetEnabled: true });
  });

  it("values disabled assets that are still held", async () => {
    mocks.playerFindUnique.mockResolvedValue({ walletAddress: "0xabc", walletName: null, cash: d("10"), updatedAt: new Date("2026-07-19"), positions: [{ assetId: "disabled", quantity: d("2"), costBasis: d("4") }] });
    mocks.assetFindMany.mockResolvedValue([
      { id: "disabled", ticker: "D", nameZh: "停", nameEn: null, assetClass: "股", subCategory: null, currency: "USD", unit: "股", enabled: false, displayOrder: 3, quote: { usdPrice: d("7"), marketDate: new Date("2026-07-18"), status: "ACTIVE" } },
    ]);

    const result = await getAccountProjection("0xabc");

    expect(result.holdingsValue).toBe("14");
    expect(mocks.assetFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { OR: [{ enabled: true }, { positions: { some: { walletAddress: "0xabc" } } }] },
    }));
  });

  it.each([
    ["missing", null],
    ["error", { usdPrice: d("7"), marketDate: new Date("2026-07-18"), status: "ERROR" }],
    ["stale", { usdPrice: d("7"), marketDate: new Date("2026-07-11"), status: "ACTIVE" }],
  ])("rejects account metrics for a held asset with a %s quote", async (_label, quote) => {
    mocks.playerFindUnique.mockResolvedValue({ walletAddress: "0xabc", walletName: null, cash: d("10"), updatedAt: new Date("2026-07-19"), positions: [{ assetId: "held", quantity: d("2"), costBasis: d("4") }] });
    mocks.assetFindMany.mockResolvedValue([
      { id: "held", ticker: "H", nameZh: "持", nameEn: null, assetClass: "股", subCategory: null, currency: "USD", unit: "股", enabled: false, displayOrder: 3, quote },
    ]);

    await expect(getAccountProjection("0xabc")).rejects.toMatchObject({ status: 503, code: "MARKET_DATA_UNAVAILABLE" });
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
