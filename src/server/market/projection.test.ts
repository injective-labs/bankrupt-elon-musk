import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock("@/server/db", () => ({
  prisma: { asset: { findMany: mocks.findMany } },
}));

import { getMarketProjection } from "./projection";

const asset = (overrides: Record<string, unknown> = {}) => ({
  id: "fresh",
  nameZh: "新鲜",
  nameEn: "Fresh",
  assetClass: "美股",
  subCategory: null,
  ticker: "F",
  currency: "USD",
  unit: "股",
  unitEn: "share",
  enabled: true,
  displayOrder: 1,
  quote: {
    usdPrice: { toString: () => "12.25" },
    marketDate: new Date("2026-07-20T00:00:00.000Z"),
    status: "ACTIVE",
  },
  ...overrides,
});

describe("getMarketProjection", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns ordered public real quotes without account data", async () => {
    mocks.findMany.mockResolvedValue([
      asset(),
      asset({ id: "missing", nameZh: "缺失", ticker: "M", displayOrder: 2, quote: null }),
    ]);

    const result = await getMarketProjection(new Date("2026-07-20T12:00:00.000Z"));

    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { enabled: true },
      include: { quote: true },
      orderBy: { displayOrder: "asc" },
    });
    expect(result.assets.map(({ id, usdPrice, quoteStatus }) => ({ id, usdPrice, quoteStatus }))).toEqual([
      { id: "fresh", usdPrice: "12.25", quoteStatus: "ACTIVE" },
      { id: "missing", usdPrice: null, quoteStatus: "MISSING" },
    ]);
    expect(result.marketAsOf).toBe("2026-07-20T00:00:00.000Z");
    expect(result).not.toHaveProperty("walletAddress");
    expect(result).not.toHaveProperty("positions");
  });

  it("keeps the last real price but marks an old quote stale", async () => {
    mocks.findMany.mockResolvedValue([
      asset({
        quote: {
          usdPrice: { toString: () => "9.75" },
          marketDate: new Date("2026-07-01T00:00:00.000Z"),
          status: "ACTIVE",
        },
      }),
    ]);

    const result = await getMarketProjection(new Date("2026-07-20T12:00:00.000Z"));

    expect(result.assets[0]).toMatchObject({ usdPrice: "9.75", quoteStatus: "STALE" });
  });
});
