import type { LeaderboardRow, LeaderboardSnapshot } from "@/types";
import { prisma } from "./db";
import { STARTING_CASH } from "./account";
import { ApiError } from "./http/errors";

const MAX_QUOTE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function maskAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export async function getLossLeaderboard(
  walletAddress: string | null,
  limit: number,
): Promise<LeaderboardSnapshot> {
  const players = await prisma.player.findMany({
    include: { positions: { include: { asset: { include: { quote: true } } } } },
  });
  const ranked = players.map((player) => {
    let netWorth = player.cash;
    for (const position of player.positions) {
      const quote = position.asset.quote;
      const quoteTooOld = quote
        ? Date.now() - quote.marketDate.getTime() > MAX_QUOTE_AGE_MS
        : false;
      if ((!quote || quoteTooOld) && !position.quantity.isZero()) {
        throw new ApiError(503, "MARKET_DATA_UNAVAILABLE", "Leaderboard market data is incomplete");
      }
      if (quote) {
        netWorth = netWorth.add(position.quantity.mul(quote.usdPrice));
      }
    }
    return { player, netWorth, pnl: netWorth.sub(STARTING_CASH) };
  });
  ranked.sort((left, right) => {
    const pnlOrder = left.pnl.comparedTo(right.pnl);
    return pnlOrder || left.player.walletAddress.localeCompare(right.player.walletAddress);
  });
  const boundedLimit = Math.max(0, Math.min(Math.trunc(limit), 100));
  const top: LeaderboardRow[] = ranked.slice(0, boundedLimit).map(({ player, netWorth, pnl }) => ({
    address: maskAddress(player.walletAddress),
    walletName: player.walletName,
    pnl: pnl.toString(),
    netWorth: netWorth.toString(),
    liquidated: false,
  }));
  const callerIndex = walletAddress
    ? ranked.findIndex(({ player }) => player.walletAddress.toLowerCase() === walletAddress.toLowerCase())
    : -1;
  return {
    top,
    total: ranked.length,
    you: callerIndex < 0
      ? null
      : { rank: callerIndex + 1, total: ranked.length, pnl: ranked[callerIndex].pnl.toString() },
  };
}
