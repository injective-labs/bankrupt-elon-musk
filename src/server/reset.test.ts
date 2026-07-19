import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(), transactionFind: vi.fn(), replayFind: vi.fn(),
  player: vi.fn(), playerUpdate: vi.fn(), positions: vi.fn(), positionDeleteMany: vi.fn(),
  transactionCreate: vi.fn(), transactionUpdate: vi.fn(), projection: vi.fn(),
}));

vi.mock("./db", () => ({
  prisma: {
    $transaction: mocks.transaction,
    transaction: { findUnique: mocks.replayFind },
  },
}));
vi.mock("./account", () => ({
  STARTING_CASH: new Prisma.Decimal("50000000000"),
  getAccountProjectionInTransaction: mocks.projection,
}));

import { resetAccount } from "./reset";

const d = (value: string) => new Prisma.Decimal(value);
const wallet = "0x0000000000000000000000000000000000000001";
const key = "00000000-0000-4000-8000-000000000071";
const projection = {
  walletAddress: wallet, walletName: null, cash: "50000000000", holdingsValue: "0",
  netWorth: "50000000000", pnl: "0", positions: [], assets: [], recentTransactions: [],
  marketAsOf: null, settlementLocked: false, updatedAt: "2026-07-19T12:00:00.000Z",
};

function tx() {
  return {
    player: { findUnique: mocks.player, update: mocks.playerUpdate },
    position: { findMany: mocks.positions, deleteMany: mocks.positionDeleteMany },
    transaction: { findUnique: mocks.transactionFind, create: mocks.transactionCreate, update: mocks.transactionUpdate },
  };
}

describe("resetAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ENABLE_GAME_RESET", "true");
    mocks.transaction.mockImplementation((fn) => fn(tx()));
    mocks.transactionFind.mockResolvedValue(null); mocks.replayFind.mockResolvedValue(null);
    mocks.player.mockResolvedValue({ cash: d("123"), updatedAt: new Date() });
    mocks.positions.mockResolvedValue([
      { quantity: d("2"), costBasis: d("40") },
      { quantity: d("3"), costBasis: d("60") },
    ]);
    mocks.transactionCreate.mockResolvedValue({ id: 9n });
    mocks.projection.mockResolvedValue(projection);
  });

  it("rejects with 403 before opening a transaction when reset is disabled", async () => {
    vi.stubEnv("ENABLE_GAME_RESET", "false");
    await expect(resetAccount(wallet, key)).rejects.toMatchObject({ status: 403, code: "RESET_DISABLED" });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.playerUpdate).not.toHaveBeenCalled();
    expect(mocks.positionDeleteMany).not.toHaveBeenCalled();
  });

  it("atomically deletes positions, restores USD 50B, and appends a RESET ledger snapshot", async () => {
    const result = await resetAccount(wallet, key);
    expect(mocks.positionDeleteMany).toHaveBeenCalledWith({ where: { walletAddress: wallet } });
    expect(mocks.playerUpdate).toHaveBeenCalledWith({ where: { walletAddress: wallet }, data: { cash: d("50000000000") } });
    expect(mocks.transactionCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      walletAddress: wallet, idempotencyKey: key, type: "RESET", assetId: null,
      commandSnapshot: { type: "RESET", idempotencyKey: key }, resultSnapshot: {},
      usdAmount: d("0"), cashBefore: d("123"), cashAfter: d("50000000000"),
      quantityBefore: d("5"), quantityAfter: d("0"), costBasisBefore: d("100"), costBasisAfter: d("0"),
    }), select: { id: true } });
    expect(mocks.transactionUpdate).toHaveBeenCalledWith({ where: { id: 9n }, data: { resultSnapshot: projection } });
    expect(result).toEqual(projection);
    expect(mocks.transaction.mock.calls[0][1]).toEqual({ isolationLevel: "Serializable" });
  });

  it("replays the stable stored projection without mutating again", async () => {
    mocks.transactionFind.mockResolvedValue({ commandSnapshot: { type: "RESET", idempotencyKey: key }, resultSnapshot: projection });
    await expect(resetAccount(wallet, key)).resolves.toEqual(projection);
    expect(mocks.playerUpdate).not.toHaveBeenCalled();
    expect(mocks.positionDeleteMany).not.toHaveBeenCalled();
    expect(mocks.transactionCreate).not.toHaveBeenCalled();
  });

  it("rejects malformed persisted reset command and result snapshots", async () => {
    mocks.transactionFind.mockResolvedValue({ commandSnapshot: { type: "BUY", idempotencyKey: key }, resultSnapshot: projection });
    await expect(resetAccount(wallet, key)).rejects.toMatchObject({ status: 500, code: "INVALID_RESET_SNAPSHOT" });
    mocks.transactionFind.mockResolvedValue({ commandSnapshot: { type: "RESET", idempotencyKey: key }, resultSnapshot: { ...projection, cash: "NaN" } });
    await expect(resetAccount(wallet, key)).rejects.toMatchObject({ status: 500, code: "INVALID_RESET_SNAPSHOT" });
  });

  it("preserves existing ledger history", async () => {
    await resetAccount(wallet, key);
    expect(tx().transaction).not.toHaveProperty("deleteMany");
  });

  it("replays only the transaction idempotency P2002 and retries P2034 three times", async () => {
    mocks.transaction.mockRejectedValueOnce(Object.assign(new Error("unique"), { code: "P2002", meta: { target: ["walletAddress", "idempotencyKey"] } }));
    mocks.replayFind.mockResolvedValue({ commandSnapshot: { type: "RESET", idempotencyKey: key }, resultSnapshot: projection });
    await expect(resetAccount(wallet, key)).resolves.toEqual(projection);

    mocks.transaction.mockRejectedValue(Object.assign(new Error("conflict"), { code: "P2034" }));
    await expect(resetAccount(wallet, "00000000-0000-4000-8000-000000000072")).rejects.toMatchObject({ status: 409, code: "RESET_CONFLICT" });
    expect(mocks.transaction).toHaveBeenCalledTimes(4);
  });
});
