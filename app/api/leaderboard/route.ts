import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { walletFromQuery } from "@/server/wallet";
import type { LeaderboardRow } from "@/types";

export const runtime = "nodejs";

const TOP_N = 20;

function maskAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

// Temporary compatibility response. A later task replaces this route with the
// server-computed loss leaderboard based on authoritative positions and quotes.
export async function GET(request: Request) {
  const [rows, total] = await Promise.all([
    prisma.player.findMany({
      orderBy: { createdAt: "asc" },
      take: TOP_N,
      select: { walletAddress: true, walletName: true, cash: true },
    }),
    prisma.player.count(),
  ]);

  const top: LeaderboardRow[] = rows.map((r) => ({
    address: maskAddress(r.walletAddress),
    walletName: r.walletName,
    pnl: 0,
    netWorth: r.cash.toNumber(),
    liquidated: false,
  }));

  let you: { rank: number; total: number; pnl: number } | null = null;
  const wallet = walletFromQuery(request);
  if (wallet) {
    const me = await prisma.player.findUnique({
      where: { walletAddress: wallet },
      select: { walletAddress: true },
    });
    if (me) {
      you = { rank: 1, total, pnl: 0 };
    }
  }

  return NextResponse.json({ top, total, you });
}
