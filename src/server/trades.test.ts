import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(), player: vi.fn(), asset: vi.fn(), position: vi.fn(),
  transactionFind: vi.fn(), playerUpdate: vi.fn(), positionUpsert: vi.fn(),
  positionUpdate: vi.fn(), positionDelete: vi.fn(), transactionCreate: vi.fn(),
  transactionUpdate: vi.fn(), projection: vi.fn(), history: vi.fn(), replayFind: vi.fn(),
}));
vi.mock("./db", () => ({ prisma: { $transaction: mocks.transaction, transaction: { findMany: mocks.history, findUnique: mocks.replayFind } } }));
vi.mock("./account", () => ({ getAccountProjectionInTransaction: mocks.projection }));
vi.mock("@/game/marketClock", () => ({ isSettlementLocked: vi.fn(() => false) }));

import { executeTrade, getTradeHistory } from "./trades";
import { isSettlementLocked } from "@/game/marketClock";

const d = (value: string) => new Prisma.Decimal(value);
const wallet = "0x0000000000000000000000000000000000000001";
const command = { assetId: "stock", side: "BUY" as const, quantity: "2", idempotencyKey: "00000000-0000-4000-8000-000000000001" };

function tx() {
  return {
    player: { findUnique: mocks.player, update: mocks.playerUpdate },
    asset: { findUnique: mocks.asset }, position: { findUnique: mocks.position, upsert: mocks.positionUpsert, update: mocks.positionUpdate, delete: mocks.positionDelete },
    transaction: { findUnique: mocks.transactionFind, create: mocks.transactionCreate, update: mocks.transactionUpdate },
  };
}

describe("executeTrade", () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-07-19T12:00:00Z"));
    mocks.transaction.mockImplementation((fn) => fn(tx()));
    mocks.transactionFind.mockResolvedValue(null); mocks.position.mockResolvedValue(null); mocks.replayFind.mockResolvedValue(null);
    mocks.transactionCreate.mockResolvedValue({ id: 1n });
    mocks.player.mockResolvedValue({ cash: d("100"), updatedAt: new Date() });
    mocks.asset.mockResolvedValue({ id: "stock", enabled: true, quoteMultiplier: d("1"), quote: { nativePrice: d("5"), currency: "USD", fxRateToUsd: d("1"), usdPrice: d("5"), marketDate: new Date("2026-07-18"), status: "ACTIVE" } });
    mocks.projection.mockResolvedValue({ walletAddress: wallet, cash: "90", holdingsValue: "10", netWorth: "100", pnl: "-1", positions: [], assets: [], recentTransactions: [], marketAsOf: null, settlementLocked: false, updatedAt: "2026-07-19T12:00:00.000Z" });
  });

  it("buys using exact Decimal accounting and accumulates weighted total cost basis", async () => {
    mocks.position.mockResolvedValue({ quantity: d("3"), costBasis: d("12") });
    await executeTrade(wallet, command);
    expect(mocks.playerUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { cash: d("90") } }));
    expect(mocks.positionUpsert).toHaveBeenCalledWith(expect.objectContaining({ update: { quantity: d("5"), costBasis: d("22") } }));
  });

  it("reduces partial sells at average cost and deletes a fully sold position", async () => {
    mocks.position.mockResolvedValue({ quantity: d("4"), costBasis: d("10") });
    await executeTrade(wallet, { ...command, side: "SELL", quantity: "2" });
    expect(mocks.positionUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { quantity: d("2"), costBasis: d("5") } }));
    await executeTrade(wallet, { ...command, side: "SELL", quantity: "MAX", idempotencyKey: "00000000-0000-4000-8000-000000000002" });
    expect(mocks.positionDelete).toHaveBeenCalled();
  });

  it("implements BUY MAX as floor(cash / unit price)", async () => {
    await executeTrade(wallet, { ...command, quantity: "MAX" });
    expect(mocks.transactionCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ quantity: d("20"), usdAmount: d("100") }) }));
  });

  it.each([
    ["cash", { cash: d("1") }, null, { ...command }, "INSUFFICIENT_CASH"],
    ["holdings", { cash: d("100") }, { quantity: d("1"), costBasis: d("1") }, { ...command, side: "SELL", quantity: "2" }, "INSUFFICIENT_HOLDINGS"],
    ["fraction", { cash: d("100") }, null, { ...command, quantity: "1.5" }, "INVALID_QUANTITY"],
  ])("rejects invalid %s without writes", async (_name, player, position, input, code) => {
    mocks.player.mockResolvedValue(player); mocks.position.mockResolvedValue(position);
    await expect(executeTrade(wallet, input as never)).rejects.toMatchObject({ status: 422, code });
    expect(mocks.transactionCreate).not.toHaveBeenCalled();
  });

  it.each([
    ["disabled", { enabled: false }, "ASSET_DISABLED"],
    ["missing", { quote: null }, "QUOTE_MISSING"],
    ["stale", { quote: { status: "ACTIVE", marketDate: new Date("2026-07-11"), usdPrice: d("5") } }, "QUOTE_STALE"],
  ])("rejects a %s asset/quote", async (_name, override, code) => {
    mocks.asset.mockResolvedValue({ id: "stock", enabled: true, quote: { status: "ACTIVE", marketDate: new Date("2026-07-18"), usdPrice: d("5") }, ...override });
    await expect(executeTrade(wallet, command)).rejects.toMatchObject({ status: 422, code });
  });

  it("rejects during settlement", async () => {
    vi.mocked(isSettlementLocked).mockReturnValueOnce(true);
    await expect(executeTrade(wallet, command)).rejects.toMatchObject({ status: 422, code: "SETTLEMENT_LOCKED" });
  });

  it("returns idempotently without a second mutation", async () => {
    const stable = { walletAddress: wallet, cash: "77", holdingsValue: "23", netWorth: "100", pnl: "-1", positions: [], assets: [], recentTransactions: [], marketAsOf: null, settlementLocked: false, updatedAt: "2026-07-19T10:00:00.000Z" };
    mocks.transactionFind.mockResolvedValue({ id: 1n, commandSnapshot: command, resultSnapshot: stable });
    await expect(executeTrade(wallet, command)).resolves.toEqual(stable);
    expect(mocks.playerUpdate).not.toHaveBeenCalled(); expect(mocks.projection).not.toHaveBeenCalled();
  });

  it("rejects an idempotency key reused with a different command", async () => {
    mocks.transactionFind.mockResolvedValue({ id: 1n, commandSnapshot: { ...command, quantity: "3" }, resultSnapshot: { cash: "1" } });
    await expect(executeTrade(wallet, command)).rejects.toMatchObject({ status: 422, code: "IDEMPOTENCY_KEY_REUSED" });
  });

  it.each([
    [{ assetId: 1 }, { cash: "1" }],
    [command, { cash: 1 }],
  ])("rejects malformed persisted JSON snapshots", async (commandSnapshot, resultSnapshot) => {
    mocks.transactionFind.mockResolvedValue({ id: 1n, commandSnapshot, resultSnapshot });
    await expect(executeTrade(wallet, command)).rejects.toMatchObject({ status: 500, code: "INVALID_TRADE_SNAPSHOT" });
  });

  it("persists the command and stable projection in the ledger", async () => {
    const result = await executeTrade(wallet, command);
    expect(mocks.transactionCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ commandSnapshot: command }) }));
    expect(mocks.transactionUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { resultSnapshot: result } }));
  });

  it("replays only a P2002 on the trade idempotency unique key", async () => {
    const stable = { walletAddress: wallet, cash: "90", holdingsValue: "10", netWorth: "100", pnl: "-1", positions: [], assets: [], recentTransactions: [], marketAsOf: null, settlementLocked: false, updatedAt: "2026-07-19T12:00:00.000Z" };
    mocks.transaction.mockRejectedValueOnce(Object.assign(new Error("unique"), { code: "P2002", meta: { target: ["walletAddress", "idempotencyKey"] } }));
    mocks.replayFind.mockResolvedValue({ commandSnapshot: command, resultSnapshot: stable });
    await expect(executeTrade(wallet, command)).resolves.toEqual(stable);
    mocks.transaction.mockRejectedValueOnce(Object.assign(new Error("other unique"), { code: "P2002", meta: { target: ["assetId"] } }));
    await expect(executeTrade(wallet, { ...command, idempotencyKey: "00000000-0000-4000-8000-000000000009" })).rejects.toThrow("other unique");
  });

  it.each([
    ["explicit quantity overflow", { ...command, quantity: "1000000000000000000" }],
    ["BUY MAX quantity overflow", { ...command, quantity: "MAX" }],
  ])("rejects %s before any write", async (name, input) => {
    if (name.includes("MAX")) { mocks.player.mockResolvedValue({ cash: d("50000000000") }); mocks.asset.mockResolvedValue({ id: "stock", enabled: true, quote: { nativePrice: d("0.000000000001"), currency: "USD", fxRateToUsd: d("1"), usdPrice: d("0.000000000001"), marketDate: new Date("2026-07-18"), status: "ACTIVE" } }); }
    await expect(executeTrade(wallet, input as never)).rejects.toMatchObject({ status: 422, code: "VALUE_OUT_OF_RANGE" });
    expect(mocks.transactionCreate).not.toHaveBeenCalled();
  });

  it("rejects a monetary result with more than eight decimal places", async () => {
    mocks.asset.mockResolvedValue({ id: "stock", enabled: true, quote: { nativePrice: d("0.123456789"), currency: "USD", fxRateToUsd: d("1"), usdPrice: d("0.123456789"), marketDate: new Date("2026-07-18"), status: "ACTIVE" } });
    await expect(executeTrade(wallet, command)).rejects.toMatchObject({ status: 422, code: "VALUE_OUT_OF_RANGE" });
    expect(mocks.transactionCreate).not.toHaveBeenCalled();
  });

  it("uses Serializable isolation and retries P2034 conflicts only a bounded number", async () => {
    mocks.transaction.mockRejectedValue(Object.assign(new Error("conflict"), { code: "P2034" }));
    await expect(executeTrade(wallet, command)).rejects.toMatchObject({ status: 409, code: "TRADE_CONFLICT" });
    expect(mocks.transaction).toHaveBeenCalledTimes(3);
    expect(mocks.transaction.mock.calls[0][1]).toEqual({ isolationLevel: "Serializable" });
  });
});

describe("getTradeHistory", () => {
  it("caps page size and returns an opaque next cursor", async () => {
    mocks.history.mockResolvedValue(Array.from({ length: 101 }, (_, i) => ({ id: BigInt(101 - i), type: "BUY", assetId: "a", quantity: d("1"), usdUnitPrice: d("2"), usdAmount: d("2"), createdAt: new Date() })));
    const page = await getTradeHistory(wallet, { limit: 999 });
    expect(mocks.history).toHaveBeenCalledWith(expect.objectContaining({ take: 101 }));
    expect(page.rows).toHaveLength(100); expect(page.nextCursor).toBe("2");
  });
  it.each(["0", "-1", "+1", "1.5", "9223372036854775808"])("rejects invalid signed-int64 cursor %s", async (cursor) => {
    await expect(getTradeHistory(wallet, { cursor })).rejects.toMatchObject({ status: 422, code: "INVALID_CURSOR" });
  });
});
