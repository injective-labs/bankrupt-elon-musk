import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { persistDailyBarIfCurrent } from "@/server/market/refresh";

const describeDatabase = process.env.RUN_DATABASE_TESTS === "1" ? describe : describe.skip;
const assetId = "task-11-refresh-asset";
const rolloutDate = new Date("2026-07-20T00:00:00Z");

describeDatabase("post-launch market refresh persistence (PostgreSQL)", () => {
  beforeAll(async () => {
    await prisma.asset.deleteMany({ where: { id: assetId } });
    await prisma.asset.create({
      data: {
        id: assetId,
        ticker: "T11",
        quoteSymbol: "T11-USD",
        nameZh: "Task 11 refresh",
        assetClass: "test",
        currency: "USD",
        unit: "share",
        displayOrder: 999_999,
      },
    });
  });

  afterAll(async () => {
    await prisma.asset.deleteMany({ where: { id: assetId } });
    await prisma.$disconnect();
  });

  it("starts with no backfilled daily history and writes only the current rollout row", async () => {
    expect(await prisma.assetDailyPrice.count({ where: { assetId } })).toBe(0);
    const asset = { id: assetId, quoteSymbol: "T11-USD", currency: "USD", quoteMultiplier: new Prisma.Decimal(1) };
    await persistDailyBarIfCurrent(asset, {
      symbol: asset.quoteSymbol,
      marketDate: rolloutDate,
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      currency: "USD",
    }, new Prisma.Decimal(1), new Date("2026-07-20T14:00:00Z"));

    const rows = await prisma.assetDailyPrice.findMany({ where: { assetId }, orderBy: { marketDate: "asc" } });
    expect(rows.map((row) => row.marketDate)).toEqual([rolloutDate]);
  });

  it("does not create an older daily row after a post-launch quote exists", async () => {
    const asset = { id: assetId, quoteSymbol: "T11-USD", currency: "USD", quoteMultiplier: new Prisma.Decimal(1) };
    await persistDailyBarIfCurrent(asset, {
      symbol: asset.quoteSymbol,
      marketDate: new Date("2026-07-19T00:00:00Z"),
      open: 90,
      high: 91,
      low: 89,
      close: 90,
      currency: "USD",
    }, new Prisma.Decimal(1), new Date("2026-07-20T15:00:00Z"));

    expect(await prisma.assetDailyPrice.findMany({ where: { assetId }, select: { marketDate: true } }))
      .toEqual([{ marketDate: rolloutDate }]);
  });
});
