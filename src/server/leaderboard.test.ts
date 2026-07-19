import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), queryRaw: vi.fn() }));
vi.mock("./db", () => ({ prisma: { $transaction: mocks.transaction } }));

import { getLossLeaderboard } from "./leaderboard";

const d = (value: string) => new Prisma.Decimal(value);

describe("getLossLeaderboard", () => {
  it.each([Number.NaN, Number.POSITIVE_INFINITY, 0, -4, 0.7])("normalizes an invalid exported limit %s to at least one", async (limit) => {
    mocks.queryRaw.mockResolvedValueOnce([{ hasInvalidQuotes: false }]).mockResolvedValueOnce([]);
    await getLossLeaderboard(null, limit);
    const sql = mocks.queryRaw.mock.calls[1][0];
    expect(sql.values).toContain(1);
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation((operation) => operation({ $queryRaw: mocks.queryRaw }));
    mocks.queryRaw
      .mockResolvedValueOnce([{ hasInvalidQuotes: false }])
      .mockResolvedValueOnce([]);
  });

  it("uses fixed parameterized Decimal-safe SQL and returns only top rows plus caller", async () => {
    mocks.queryRaw
      .mockReset()
      .mockResolvedValueOnce([{ hasInvalidQuotes: false }])
      .mockResolvedValueOnce([
        { walletAddress: "0x2222222222222222222222222222222222222222", walletName: "two", netWorth: d("55"), pnl: d("-49999999945"), rank: 1n, total: 20n, topOrder: 1n },
        { walletAddress: "0x1111111111111111111111111111111111111111", walletName: "one", netWorth: d("300"), pnl: d("-49999999700"), rank: 12n, total: 20n, topOrder: 12n },
      ]);

    const result = await getLossLeaderboard("0x1111111111111111111111111111111111111111", 1);

    expect(result.top).toEqual([{ address: "0x2222…2222", walletName: "two", pnl: "-49999999945", netWorth: "55" }]);
    expect(result.you).toEqual({ rank: 12, total: 20, pnl: "-49999999700" });
    expect(mocks.transaction.mock.calls[0][1]).toEqual({ isolationLevel: "RepeatableRead" });

    const rankingSql = mocks.queryRaw.mock.calls[1][0];
    const sqlText = rankingSql.strings.join("?");
    expect(sqlText).toContain("RANK() OVER");
    expect(sqlText).toContain("ROW_NUMBER() OVER");
    expect(sqlText).toContain("SUM(pos.\"quantity\" * quote.\"usdPrice\")");
    expect(sqlText).not.toContain("0x1111111111111111111111111111111111111111");
    expect(rankingSql.values).toContain("0x1111111111111111111111111111111111111111");
    expect(rankingSql.values).toContain(1);

    const freshnessSql = mocks.queryRaw.mock.calls[0][0].strings.join("?");
    expect(freshnessSql).toContain("CURRENT_TIMESTAMP AT TIME ZONE 'UTC'");
  });

  it("uses conventional competition ranking for tied PnL", async () => {
    mocks.queryRaw
      .mockReset()
      .mockResolvedValueOnce([{ hasInvalidQuotes: false }])
      .mockResolvedValueOnce([
        { walletAddress: "0x1111111111111111111111111111111111111111", walletName: null, netWorth: d("1"), pnl: d("-49999999999"), rank: 1n, total: 3n, topOrder: 1n },
        { walletAddress: "0x2222222222222222222222222222222222222222", walletName: null, netWorth: d("1"), pnl: d("-49999999999"), rank: 1n, total: 3n, topOrder: 2n },
        { walletAddress: "0x3333333333333333333333333333333333333333", walletName: null, netWorth: d("2"), pnl: d("-49999999998"), rank: 3n, total: 3n, topOrder: 3n },
      ]);

    const result = await getLossLeaderboard("0x2222222222222222222222222222222222222222", 3);

    expect(result.you?.rank).toBe(1);
    expect(result.top).toHaveLength(3);
  });

  it.each(["MISSING", "ERROR", "STALE"])("rejects rankings when a held position quote is %s", async () => {
    mocks.queryRaw.mockReset().mockResolvedValueOnce([{ hasInvalidQuotes: true }]);
    await expect(getLossLeaderboard(null, 10)).rejects.toMatchObject({ status: 503, code: "MARKET_DATA_UNAVAILABLE" });
    expect(mocks.queryRaw).toHaveBeenCalledOnce();
  });
});
