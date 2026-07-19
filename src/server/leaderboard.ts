import { Prisma } from "@prisma/client";
import type { LeaderboardRow, LeaderboardSnapshot } from "@/types";
import { prisma } from "./db";
import { STARTING_CASH } from "./account";
import { ApiError } from "./http/errors";

interface RankingRow {
  walletAddress: string;
  walletName: string | null;
  netWorth: Prisma.Decimal;
  pnl: Prisma.Decimal;
  rank: bigint;
  total: bigint;
  topOrder: bigint;
}

function maskAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export async function getLossLeaderboard(
  walletAddress: string | null,
  limit: number,
): Promise<LeaderboardSnapshot> {
  const boundedLimit = Number.isFinite(limit)
    ? Math.max(1, Math.min(Math.trunc(limit), 100))
    : 1;
  return prisma.$transaction(async (tx) => {
    const invalid = await tx.$queryRaw<Array<{ hasInvalidQuotes: boolean }>>(Prisma.sql`
      SELECT EXISTS (
        SELECT 1
        FROM "Position" pos
        LEFT JOIN "AssetQuote" quote ON quote."assetId" = pos."assetId"
        WHERE pos."quantity" <> 0
          AND (
            quote."assetId" IS NULL
            OR quote."status" <> 'ACTIVE'::"QuoteStatus"
            OR quote."marketDate" < (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date - INTERVAL '7 days'
          )
      ) AS "hasInvalidQuotes"
    `);
    if (invalid[0]?.hasInvalidQuotes) {
      throw new ApiError(503, "MARKET_DATA_UNAVAILABLE", "Leaderboard market data is incomplete");
    }

    const rows = await tx.$queryRaw<RankingRow[]>(Prisma.sql`
      WITH valuations AS (
        SELECT
          player."walletAddress",
          player."walletName",
          player."cash" + COALESCE(SUM(pos."quantity" * quote."usdPrice"), 0::numeric) AS "netWorth"
        FROM "Player" player
        LEFT JOIN "Position" pos ON pos."walletAddress" = player."walletAddress"
        LEFT JOIN "AssetQuote" quote ON quote."assetId" = pos."assetId"
        GROUP BY player."walletAddress", player."walletName", player."cash"
      ), scored AS (
        SELECT
          valuations.*,
          valuations."netWorth" - ${STARTING_CASH}::numeric AS pnl
        FROM valuations
      ), ranked AS (
        SELECT
          scored.*,
          RANK() OVER (ORDER BY pnl ASC) AS rank,
          ROW_NUMBER() OVER (ORDER BY pnl ASC, "walletAddress" ASC) AS "topOrder",
          COUNT(*) OVER () AS total
        FROM scored
      )
      SELECT "walletAddress", "walletName", "netWorth", pnl, rank, total, "topOrder"
      FROM ranked
      WHERE "topOrder" <= ${boundedLimit}
         OR "walletAddress" = ${walletAddress}
      ORDER BY "topOrder" ASC
    `);

    const total = rows.length ? Number(rows[0].total) : 0;
    const top: LeaderboardRow[] = rows
      .filter((row) => Number(row.topOrder) <= boundedLimit)
      .map((row) => ({
        address: maskAddress(row.walletAddress),
        walletName: row.walletName,
        pnl: row.pnl.toString(),
        netWorth: row.netWorth.toString(),
        liquidated: false,
      }));
    const caller = walletAddress
      ? rows.find((row) => row.walletAddress.toLowerCase() === walletAddress.toLowerCase())
      : undefined;
    return {
      top,
      total,
      you: caller
        ? { rank: Number(caller.rank), total: Number(caller.total), pnl: caller.pnl.toString() }
        : null,
    };
  }, { isolationLevel: "RepeatableRead" });
}
