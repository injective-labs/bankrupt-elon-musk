import { Prisma } from "@prisma/client";
import { privateKeyToAccount } from "viem/accounts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  playerFind: vi.fn(),
  assetFindMany: vi.fn(),
  positionFindMany: vi.fn(),
  planCreate: vi.fn(),
  planFind: vi.fn(),
  planUpdate: vi.fn(),
  playerUpdate: vi.fn(),
  positionUpsert: vi.fn(),
  positionUpdate: vi.fn(),
  positionDelete: vi.fn(),
  transactionCreate: vi.fn(),
}));

vi.mock("./db", () => ({
  prisma: {
    $transaction: mocks.transaction,
  },
}));

vi.mock("@/game/marketClock", () => ({ isSettlementLocked: vi.fn(() => false) }));

import {
  buildTradePlanConfirmationMessage,
  canonicalTradePlanHash,
  parseTradePlanRequest,
  prepareTradePlan,
  executeTradePlan,
  cancelTradePlan,
} from "./tradePlans";

const d = (value: string) => new Prisma.Decimal(value);
const account = privateKeyToAccount("0x0000000000000000000000000000000000000000000000000000000000000001");
const wallet = account.address;

function transactionClient() {
  return {
    player: { findUnique: mocks.playerFind, update: mocks.playerUpdate },
    asset: { findMany: mocks.assetFindMany },
    position: {
      findMany: mocks.positionFindMany,
      upsert: mocks.positionUpsert,
      update: mocks.positionUpdate,
      delete: mocks.positionDelete,
    },
    tradePlan: { create: mocks.planCreate, findUnique: mocks.planFind, update: mocks.planUpdate },
    transaction: { create: mocks.transactionCreate },
  };
}

describe("trade plan request validation", () => {
  it("accepts a two-asset 50/50 cash allocation", () => {
    expect(parseTradePlanRequest({
      legs: [
        { side: "BUY", asset: "doge", cashBps: 5000 },
        { side: "BUY", asset: "BTC", cashBps: 5000 },
      ],
    })).toEqual({
      legs: [
        { side: "BUY", asset: "doge", cashBps: 5000 },
        { side: "BUY", asset: "BTC", cashBps: 5000 },
      ],
    });
  });

  it.each([
    [{ legs: [] }, "INVALID_TRADE_PLAN"],
    [{ legs: Array.from({ length: 21 }, () => ({ side: "BUY", asset: "DOGE", quantity: "1" })) }, "TOO_MANY_LEGS"],
    [{ legs: [{ side: "BUY", asset: "DOGE", cashBps: 5001 }, { side: "BUY", asset: "BTC", cashBps: 5000 }] }, "INVALID_ALLOCATION"],
    [{ legs: [{ side: "BUY", asset: "DOGE", quantity: "1", cashBps: 1000 }] }, "UNSUPPORTED_SIZING"],
    [{ legs: [{ side: "SELL", category: "crypto", positionBps: 5000 }] }, "UNSUPPORTED_SIZING"],
    [{ legs: [{ side: "BUY", asset: "DOGE", quantity: "0" }] }, "INVALID_QUANTITY"],
    [{ legs: [{ side: "BUY", asset: "DOGE", cashAmount: "1.234567891" }] }, "VALUE_OUT_OF_RANGE"],
  ])("rejects malformed plan %#", (request, code) => {
    expect(() => parseTradePlanRequest(request)).toThrow(expect.objectContaining({ code }));
  });
});

describe("trade plan confirmation binding", () => {
  it("hashes object keys canonically and binds the exact plan", () => {
    const left = canonicalTradePlanHash({ cashBefore: "100", legs: [{ ticker: "DOGE", quantity: "10" }] });
    const right = canonicalTradePlanHash({ legs: [{ quantity: "10", ticker: "DOGE" }], cashBefore: "100" });
    expect(left).toBe(right);
    expect(left).toMatch(/^[0-9a-f]{64}$/);

    expect(buildTradePlanConfirmationMessage({
      walletAddress: "0x0000000000000000000000000000000000000001",
      planId: "00000000-0000-4000-8000-000000000001",
      previewHash: left,
      expiresAt: new Date("2026-08-14T01:02:03.000Z"),
    })).toBe([
      "Bankrupt Elon Musk — confirm simulated trade plan v1",
      "Wallet: 0x0000000000000000000000000000000000000001",
      "Plan: 00000000-0000-4000-8000-000000000001",
      `Preview SHA-256: ${left}`,
      "Expires: 2026-08-14T01:02:03.000Z",
    ].join("\n"));
  });
});

describe("prepareTradePlan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-14T01:00:00.000Z"));
    mocks.transaction.mockImplementation((callback) => callback(transactionClient()));
    mocks.playerFind.mockResolvedValue({ walletAddress: wallet, cash: d("1000") });
    mocks.positionFindMany.mockResolvedValue([]);
    mocks.assetFindMany.mockResolvedValue([
      {
        id: "dogecoin-pack", ticker: "DOGE", nameZh: "狗狗币", nameEn: "Dogecoin",
        assetClass: "加密货币", subCategory: null, enabled: true,
        quote: { status: "ACTIVE", usdPrice: d("0.07"), marketDate: new Date("2026-08-14T00:00:00.000Z") },
      },
      {
        id: "bitcoin-coin", ticker: "BTC", nameZh: "比特币", nameEn: "Bitcoin",
        assetClass: "加密货币", subCategory: null, enabled: true,
        quote: { status: "ACTIVE", usdPrice: d("100"), marketDate: new Date("2026-08-14T00:00:00.000Z") },
      },
    ]);
    mocks.planCreate.mockImplementation(({ data }) => Promise.resolve({ ...data, id: data.id }));
    mocks.transactionCreate.mockImplementation(({ data }) => Promise.resolve({
      ...data,
      id: 1n,
      createdAt: new Date("2026-08-14T01:01:00.000Z"),
    }));
  });

  it("builds an authoritative 50/50 preview from one pre-plan cash snapshot", async () => {
    const result = await prepareTradePlan(wallet, {
      legs: [
        { side: "BUY", asset: "doge", cashBps: 5000 },
        { side: "BUY", asset: "BTC", cashBps: 5000 },
      ],
    }, { randomUUID: () => "00000000-0000-4000-8000-000000000001" });

    expect(result).toMatchObject({
      planId: "00000000-0000-4000-8000-000000000001",
      status: "PENDING",
      expiresAt: "2026-08-14T01:05:00.000Z",
      preview: {
        cashBefore: "1000",
        cashAfter: "0.06",
        legs: [
          { side: "BUY", assetId: "dogecoin-pack", ticker: "DOGE", quantity: "7142", usdUnitPrice: "0.07", usdAmount: "499.94", cashBefore: "1000", cashAfter: "500.06" },
          { side: "BUY", assetId: "bitcoin-coin", ticker: "BTC", quantity: "5", usdUnitPrice: "100", usdAmount: "500", cashBefore: "500.06", cashAfter: "0.06" },
        ],
      },
    });
    expect(result.previewHash).toBe(canonicalTradePlanHash(result.preview));
    expect(result.confirmationMessage).toContain(`Plan: ${result.planId}`);
    expect(mocks.planCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      id: result.planId,
      walletAddress: wallet,
      status: "PENDING",
      previewHash: result.previewHash,
    }) });
  });

  it("expands an English category liquidation from authoritative held positions", async () => {
    mocks.positionFindMany.mockResolvedValue([
      { assetId: "dogecoin-pack", quantity: d("10"), costBasis: d("0.5") },
      { assetId: "bitcoin-coin", quantity: d("2"), costBasis: d("150") },
    ]);

    const result = await prepareTradePlan(wallet, {
      legs: [{ side: "SELL", category: "crypto", positionBps: 10000 }],
    }, { randomUUID: () => "00000000-0000-4000-8000-000000000007" });

    expect(result.preview).toMatchObject({
      cashBefore: "1000",
      cashAfter: "1200.7",
      legs: [
        { side: "SELL", ticker: "DOGE", quantity: "10", quantityAfter: "0" },
        { side: "SELL", ticker: "BTC", quantity: "2", quantityAfter: "0" },
      ],
    });
  });

  it("rejects duplicate and ambiguous asset matches before persisting a plan", async () => {
    await expect(prepareTradePlan(wallet, {
      legs: [
        { side: "BUY", asset: "DOGE", quantity: "1" },
        { side: "BUY", asset: "Dogecoin", quantity: "1" },
      ],
    })).rejects.toMatchObject({ code: "DUPLICATE_ASSET" });

    await expect(prepareTradePlan(wallet, {
      legs: [{ side: "BUY", asset: "coin", quantity: "1" }],
    })).rejects.toMatchObject({ code: "AMBIGUOUS_ASSET" });
    expect(mocks.planCreate).not.toHaveBeenCalled();
  });

  it("executes every displayed leg atomically after a plan-bound wallet signature", async () => {
    let storedPlan: Record<string, unknown> | undefined;
    mocks.planCreate.mockImplementation(({ data }) => {
      storedPlan = { ...data };
      return Promise.resolve(storedPlan);
    });
    const prepared = await prepareTradePlan(wallet, {
      legs: [
        { side: "BUY", asset: "DOGE", cashBps: 5000 },
        { side: "BUY", asset: "BTC", cashBps: 5000 },
      ],
    }, { randomUUID: () => "00000000-0000-4000-8000-000000000002" });
    mocks.planFind.mockResolvedValue(storedPlan);
    const signature = await account.signMessage({ message: prepared.confirmationMessage });

    const receipt = await executeTradePlan(wallet, prepared.planId, signature);

    expect(receipt).toMatchObject({
      planId: prepared.planId,
      cashBefore: "1000",
      cashAfter: "0.06",
      legs: [
        { side: "BUY", ticker: "DOGE", quantity: "7142", usdAmount: "499.94" },
        { side: "BUY", ticker: "BTC", quantity: "5", usdAmount: "500" },
      ],
    });
    expect(mocks.transactionCreate).toHaveBeenCalledTimes(2);
    expect(mocks.playerUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { cash: d("0.06") } }));
    expect(mocks.planUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "EXECUTED", receipt: expect.any(Object) }),
    }));
  });

  it("rejects a signature from a different wallet without mutating the portfolio", async () => {
    let storedPlan: Record<string, unknown> | undefined;
    mocks.planCreate.mockImplementation(({ data }) => {
      storedPlan = { ...data };
      return Promise.resolve(storedPlan);
    });
    const prepared = await prepareTradePlan(wallet, {
      legs: [{ side: "BUY", asset: "DOGE", quantity: "10" }],
    }, { randomUUID: () => "00000000-0000-4000-8000-000000000003" });
    mocks.planFind.mockResolvedValue(storedPlan);
    const other = privateKeyToAccount("0x0000000000000000000000000000000000000000000000000000000000000002");
    const signature = await other.signMessage({ message: prepared.confirmationMessage });

    await expect(executeTradePlan(wallet, prepared.planId, signature))
      .rejects.toMatchObject({ code: "INVALID_SIGNATURE" });
    expect(mocks.transactionCreate).not.toHaveBeenCalled();
    expect(mocks.playerUpdate).not.toHaveBeenCalled();
  });

  it("rejects a stale plan when cash changed after the displayed preview", async () => {
    let storedPlan: Record<string, unknown> | undefined;
    mocks.planCreate.mockImplementation(({ data }) => {
      storedPlan = { ...data };
      return Promise.resolve(storedPlan);
    });
    const prepared = await prepareTradePlan(wallet, {
      legs: [{ side: "BUY", asset: "DOGE", quantity: "10" }],
    }, { randomUUID: () => "00000000-0000-4000-8000-000000000004" });
    mocks.planFind.mockResolvedValue(storedPlan);
    mocks.playerFind.mockResolvedValue({ walletAddress: wallet, cash: d("999") });
    const signature = await account.signMessage({ message: prepared.confirmationMessage });

    await expect(executeTradePlan(wallet, prepared.planId, signature))
      .rejects.toMatchObject({ code: "PLAN_STALE" });
    expect(mocks.transactionCreate).not.toHaveBeenCalled();
    expect(mocks.playerUpdate).not.toHaveBeenCalled();
  });

  it("expires a pending plan and hides plans owned by another wallet", async () => {
    const planId = "00000000-0000-4000-8000-000000000008";
    const confirmationMessage = "expired plan confirmation";
    const expiredPlan = {
      id: planId,
      walletAddress: wallet,
      status: "PENDING",
      confirmationMessage,
      expiresAt: new Date("2026-08-14T00:59:59.000Z"),
    };
    mocks.planFind.mockResolvedValue(expiredPlan);
    const signature = await account.signMessage({ message: confirmationMessage });

    await expect(executeTradePlan(wallet, planId, signature))
      .rejects.toMatchObject({ code: "PLAN_EXPIRED" });
    expect(mocks.planUpdate).toHaveBeenCalledWith({
      where: { id: planId },
      data: { status: "EXPIRED" },
    });
    expect(mocks.transactionCreate).not.toHaveBeenCalled();

    mocks.planFind.mockResolvedValue({ ...expiredPlan, walletAddress: "0x0000000000000000000000000000000000000009" });
    await expect(executeTradePlan(wallet, planId, signature))
      .rejects.toMatchObject({ status: 404, code: "PLAN_NOT_FOUND" });
  });

  it("returns the stored receipt when an executed plan is replayed", async () => {
    const executedAt = "2026-08-14T01:01:00.000Z";
    const preview = {
      cashBefore: "1000",
      cashAfter: "999.3",
      settlementLocked: false,
      legs: [{
        side: "BUY", assetId: "dogecoin-pack", ticker: "DOGE", name: "狗狗币",
        quantity: "10", usdUnitPrice: "0.07", usdAmount: "0.7",
        cashBefore: "1000", cashAfter: "999.3", quantityBefore: "0", quantityAfter: "10",
        costBasisBefore: "0", costBasisAfter: "0.7", marketDate: "2026-08-14T00:00:00.000Z",
        requested: { quantity: "10" },
      }],
    };
    const planId = "00000000-0000-4000-8000-000000000005";
    const expiresAt = new Date("2026-08-14T01:05:00.000Z");
    const previewHash = canonicalTradePlanHash(preview);
    const confirmationMessage = buildTradePlanConfirmationMessage({ walletAddress: wallet, planId, previewHash, expiresAt });
    const receipt = {
      planId, cashBefore: "1000", cashAfter: "999.3", executedAt,
      legs: [{ ...preview.legs[0], transactionId: "41" }],
    };
    mocks.planFind.mockResolvedValue({
      id: planId, walletAddress: wallet, confirmationMessage, status: "EXECUTED",
      expiresAt, preview, previewHash, receipt,
    });
    const signature = await account.signMessage({ message: confirmationMessage });

    await expect(executeTradePlan(wallet, planId, signature)).resolves.toEqual(receipt);
    expect(mocks.transactionCreate).not.toHaveBeenCalled();
    expect(mocks.playerUpdate).not.toHaveBeenCalled();
  });

  it("cancels a pending plan and prevents later execution", async () => {
    const planId = "00000000-0000-4000-8000-000000000006";
    const storedPlan = {
      id: planId,
      walletAddress: wallet,
      status: "PENDING",
      confirmationMessage: "confirm",
      expiresAt: new Date("2026-08-14T01:05:00.000Z"),
    };
    mocks.planFind.mockResolvedValue(storedPlan);
    mocks.planUpdate.mockImplementation(({ data }) => {
      Object.assign(storedPlan, data);
      return Promise.resolve(storedPlan);
    });

    await expect(cancelTradePlan(wallet, planId)).resolves.toEqual({ planId, status: "CANCELLED" });
    const signature = await account.signMessage({ message: storedPlan.confirmationMessage });
    await expect(executeTradePlan(wallet, planId, signature))
      .rejects.toMatchObject({ code: "PLAN_CANCELLED" });
    expect(mocks.planUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "CANCELLED" }) }));
  });
});
