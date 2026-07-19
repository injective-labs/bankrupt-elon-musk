import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "./db";
import { executeTrade } from "./trades";

const describeDatabase = process.env.RUN_DATABASE_TESTS === "1" ? describe : describe.skip;
const wallet = "task-6-concurrency-wallet";
const assetId = "task-6-concurrency-asset";

describeDatabase("atomic trades (PostgreSQL)", () => {
  beforeAll(async () => {
    await prisma.player.deleteMany({ where: { walletAddress: wallet } });
    await prisma.asset.deleteMany({ where: { id: assetId } });
    await prisma.asset.create({ data: { id: assetId, ticker: "T6", quoteSymbol: "T6-USD", nameZh: "Task 6", assetClass: "test", currency: "USD", unit: "share", displayOrder: 999998,
      quote: { create: { nativePrice: new Prisma.Decimal(60), currency: "USD", fxRateToUsd: new Prisma.Decimal(1), usdPrice: new Prisma.Decimal(60), marketDate: new Date(), source: "test", status: "ACTIVE", fetchedAt: new Date() } } } });
  });
  beforeEach(async () => {
    await prisma.player.deleteMany({ where: { walletAddress: wallet } });
    await prisma.player.create({ data: { walletAddress: wallet, cash: new Prisma.Decimal(100), lastLoginAt: new Date() } });
    await prisma.assetQuote.update({ where: { assetId }, data: { nativePrice: new Prisma.Decimal(60), usdPrice: new Prisma.Decimal(60), marketDate: new Date(), fetchedAt: new Date(), status: "ACTIVE" } });
  });
  afterAll(async () => {
    await prisma.player.deleteMany({ where: { walletAddress: wallet } });
    await prisma.asset.deleteMany({ where: { id: assetId } });
    await prisma.$disconnect();
  });
  it("allows at most one simultaneous buy and never makes cash negative", async () => {
    const results = await Promise.allSettled([
      executeTrade(wallet, { assetId, side: "BUY", quantity: "1", idempotencyKey: "00000000-0000-4000-8000-000000000061" }),
      executeTrade(wallet, { assetId, side: "BUY", quantity: "1", idempotencyKey: "00000000-0000-4000-8000-000000000062" }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const player = await prisma.player.findUniqueOrThrow({ where: { walletAddress: wallet } });
    expect(player.cash.toString()).toBe("40");
  });
  it("replays two truly concurrent requests with the same key exactly once", async () => {
    const command = { assetId, side: "BUY" as const, quantity: "1", idempotencyKey: "00000000-0000-4000-8000-000000000063" };
    const results = await Promise.all([executeTrade(wallet, command), executeTrade(wallet, command)]);
    expect(results[0]).toEqual(results[1]);
    expect(await prisma.transaction.count({ where: { walletAddress: wallet } })).toBe(1);
    expect((await prisma.player.findUniqueOrThrow({ where: { walletAddress: wallet } })).cash.toString()).toBe("40");
  });
  it("replays the original snapshot after a later trade and rejects command mismatch", async () => {
    const first = { assetId, side: "BUY" as const, quantity: "1", idempotencyKey: "00000000-0000-4000-8000-000000000064" };
    const original = await executeTrade(wallet, first);
    await prisma.assetQuote.update({ where: { assetId }, data: { nativePrice: new Prisma.Decimal(10), usdPrice: new Prisma.Decimal(10) } });
    await executeTrade(wallet, { assetId, side: "SELL", quantity: "1", idempotencyKey: "00000000-0000-4000-8000-000000000065" });
    await expect(executeTrade(wallet, first)).resolves.toEqual(original);
    await expect(executeTrade(wallet, { ...first, quantity: "MAX" })).rejects.toMatchObject({ status: 422, code: "IDEMPOTENCY_KEY_REUSED" });
  });
});
