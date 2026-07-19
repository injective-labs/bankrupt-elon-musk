import { Prisma, type Player } from "@prisma/client";
import { getAddress } from "viem";
import { prisma } from "./db";

export const STARTING_CASH = new Prisma.Decimal("50000000000");

export async function loginPlayer(
  walletAddress: string,
  walletName?: string | null,
): Promise<Player> {
  const wallet = getAddress(walletAddress);
  const now = new Date();
  return prisma.player.upsert({
    where: { walletAddress: wallet },
    create: {
      walletAddress: wallet,
      walletName: walletName ?? null,
      cash: STARTING_CASH,
      lastLoginAt: now,
    },
    update: {
      ...(walletName !== undefined ? { walletName } : {}),
      lastLoginAt: now,
    },
  });
}

export async function findPlayer(walletAddress: string): Promise<Player | null> {
  return prisma.player.findUnique({ where: { walletAddress } });
}
