import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { requireWallet } from "@/server/session";
import type { LeaderboardRow } from "@/types";

export const runtime = "nodejs";

const TOP_N = 20;

function maskAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

// Public loss leaderboard: biggest loss (lowest pnl) first. Optional Bearer adds
// the caller's own real rank.
export async function GET(request: Request) {
  const [rows, total] = await Promise.all([
    prisma.player.findMany({
      orderBy: { pnl: "asc" },
      take: TOP_N,
      select: { walletAddress: true, walletName: true, pnl: true, netWorth: true, liquidated: true },
    }),
    prisma.player.count(),
  ]);

  const top: LeaderboardRow[] = rows.map((r) => ({
    address: maskAddress(r.walletAddress),
    walletName: r.walletName,
    pnl: r.pnl,
    netWorth: r.netWorth,
    liquidated: r.liquidated,
  }));

  let you: { rank: number; total: number; pnl: number } | null = null;
  const wallet = await requireWallet(request);
  if (wallet) {
    const me = await prisma.player.findUnique({
      where: { walletAddress: wallet },
      select: { pnl: true },
    });
    if (me) {
      const ahead = await prisma.player.count({ where: { pnl: { lt: me.pnl } } });
      you = { rank: ahead + 1, total, pnl: me.pnl };
    }
  }

  return NextResponse.json({ top, total, you });
}
