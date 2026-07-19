import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { playerFindMany } = vi.hoisted(() => ({ playerFindMany: vi.fn() }));
vi.mock("./db", () => ({ prisma: { player: { findMany: playerFindMany } } }));

import { getLossLeaderboard } from "./leaderboard";

const d = (value: string) => new Prisma.Decimal(value);

describe("getLossLeaderboard", () => {
  beforeEach(() => {
    playerFindMany.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-19T12:00:00Z"));
  });

  it("orders losses by current cash and authoritative AssetQuote values, not legacy snapshots", async () => {
    playerFindMany.mockResolvedValue([
      { walletAddress: "0x1111111111111111111111111111111111111111", walletName: "one", cash: d("100"), pnl: d("-999999"), positions: [{ quantity: d("10"), asset: { quote: { usdPrice: d("20"), marketDate: new Date("2026-07-18") } } }] },
      { walletAddress: "0x2222222222222222222222222222222222222222", walletName: "two", cash: d("50"), pnl: d("999999"), positions: [{ quantity: d("1"), asset: { quote: { usdPrice: d("5"), marketDate: new Date("2026-07-18") } } }] },
    ]);

    const result = await getLossLeaderboard("0x1111111111111111111111111111111111111111", 10);

    expect(result.top.map((row) => row.address)).toEqual(["0x2222…2222", "0x1111…1111"]);
    expect(result.top.map((row) => row.pnl)).toEqual(["-49999999945", "-49999999700"]);
    expect(result.you).toEqual({ rank: 2, total: 2, pnl: "-49999999700" });
  });

  it("returns the caller's exact rank even outside the limited masked public list", async () => {
    playerFindMany.mockResolvedValue([
      { walletAddress: "0x1111111111111111111111111111111111111111", walletName: null, cash: d("1"), positions: [] },
      { walletAddress: "0x2222222222222222222222222222222222222222", walletName: null, cash: d("2"), positions: [] },
      { walletAddress: "0x3333333333333333333333333333333333333333", walletName: null, cash: d("3"), positions: [] },
    ]);

    const result = await getLossLeaderboard("0x3333333333333333333333333333333333333333", 1);

    expect(result.top).toHaveLength(1);
    expect(result.top[0].address).toBe("0x1111…1111");
    expect(result.you?.rank).toBe(3);
    expect(result.total).toBe(3);
  });

  it("refuses to publish ranks when a held position has an older-than-seven-day quote", async () => {
    playerFindMany.mockResolvedValue([
      { walletAddress: "0x1111111111111111111111111111111111111111", walletName: null, cash: d("1"), positions: [{ quantity: d("1"), asset: { quote: { usdPrice: d("10"), marketDate: new Date("2026-07-11T11:59:59Z") } } }] },
    ]);

    await expect(getLossLeaderboard(null, 10)).rejects.toMatchObject({
      status: 503,
      code: "MARKET_DATA_UNAVAILABLE",
    });
  });
});
