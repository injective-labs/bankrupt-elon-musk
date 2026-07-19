import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";

import { persistDailyBarIfCurrent } from "./refresh";

const describeDatabase = process.env.RUN_DATABASE_TESTS === "1" ? describe : describe.skip;
const assetId = "task-4-atomic-integration";

describeDatabase("atomic market persistence (PostgreSQL)", () => {
  beforeAll(async () => {
    await prisma.asset.deleteMany({ where: { id: assetId } });
    await prisma.asset.create({
      data: {
        id: assetId,
        ticker: "T4TEST",
        quoteSymbol: "T4TEST-USD",
        nameZh: "Task 4 SQL test",
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

  it("keeps the newer quote and creates no older daily row", async () => {
    const asset = {
      id: assetId,
      quoteSymbol: "T4TEST-USD",
      currency: "USD",
      quoteMultiplier: new Prisma.Decimal(1),
    };
    const makeBar = (date: string, close: number) => ({
      symbol: asset.quoteSymbol,
      marketDate: new Date(`${date}T00:00:00Z`),
      open: close,
      high: close,
      low: close,
      close,
      currency: "USD",
    });

    await persistDailyBarIfCurrent(
      asset,
      makeBar("2026-07-18", 210),
      new Prisma.Decimal(1),
      new Date("2026-07-19T11:00:00Z"),
    );
    await persistDailyBarIfCurrent(
      asset,
      makeBar("2026-07-17", 190),
      new Prisma.Decimal(1),
      new Date("2026-07-19T10:00:00Z"),
    );

    const quote = await prisma.assetQuote.findUniqueOrThrow({ where: { assetId } });
    const daily = await prisma.assetDailyPrice.findMany({ where: { assetId } });
    expect(quote.marketDate).toEqual(new Date("2026-07-18"));
    expect(quote.nativePrice.toString()).toBe("210");
    expect(daily.map((row) => row.marketDate)).toEqual([new Date("2026-07-18")]);
  });

  it("keeps the newer run's values when both runs return the same market date", async () => {
    const asset = {
      id: assetId,
      quoteSymbol: "T4TEST-USD",
      currency: "USD",
      quoteMultiplier: new Prisma.Decimal(1),
    };
    const makeBar = (close: number) => ({
      symbol: asset.quoteSymbol,
      marketDate: new Date("2026-07-18T00:00:00Z"),
      open: close,
      high: close,
      low: close,
      close,
      currency: "USD",
    });

    await persistDailyBarIfCurrent(
      asset,
      makeBar(220),
      new Prisma.Decimal("1.01"),
      new Date("2026-07-19T13:00:00Z"),
    );
    await persistDailyBarIfCurrent(
      asset,
      makeBar(180),
      new Prisma.Decimal("0.99"),
      new Date("2026-07-19T12:00:00Z"),
    );

    const quote = await prisma.assetQuote.findUniqueOrThrow({ where: { assetId } });
    const daily = await prisma.assetDailyPrice.findUniqueOrThrow({
      where: { assetId_marketDate: { assetId, marketDate: new Date("2026-07-18") } },
    });
    expect(quote.nativePrice.toString()).toBe("220");
    expect(quote.fxRateToUsd.toString()).toBe("1.01");
    expect(quote.usdPrice.toString()).toBe("222.2");
    expect(quote.fetchedAt).toEqual(new Date("2026-07-19T13:00:00Z"));
    expect(daily.close.toString()).toBe("220");
    expect(daily.fxRateToUsd.toString()).toBe("1.01");
    expect(daily.usdClose.toString()).toBe("222.2");
  });
});
