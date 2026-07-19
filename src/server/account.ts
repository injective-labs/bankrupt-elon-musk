import { Prisma, type Player } from "@prisma/client";
import { getAddress } from "viem";
import type { AccountProjection, AssetView, PositionView, TransactionView } from "@/types";
import { isSettlementLocked } from "@/game/marketClock";
import { prisma } from "./db";
import { ApiError } from "./http/errors";

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

const MAX_QUOTE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function decimal(value: Prisma.Decimal): string {
  return value.toString();
}

export async function getAccountProjection(walletAddress: string): Promise<AccountProjection> {
  const [player, assets, transactions] = await Promise.all([
    prisma.player.findUnique({ where: { walletAddress }, include: { positions: true } }),
    prisma.asset.findMany({
      where: { enabled: true },
      include: { quote: true },
      orderBy: { displayOrder: "asc" },
    }),
    prisma.transaction.findMany({
      where: { walletAddress },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);
  if (!player) throw new ApiError(404, "PLAYER_NOT_FOUND", "Player not found");

  const now = new Date();
  const assetViews: AssetView[] = assets.map((asset) => {
    const quote = asset.quote;
    const tooOld = quote ? now.getTime() - quote.marketDate.getTime() > MAX_QUOTE_AGE_MS : false;
    return {
      id: asset.id,
      name: asset.nameZh,
      nameEn: asset.nameEn,
      category: asset.assetClass,
      subCategory: asset.subCategory,
      ticker: asset.ticker,
      currency: asset.currency,
      unit: asset.unit,
      enabled: asset.enabled,
      displayOrder: asset.displayOrder,
      usdPrice: quote ? decimal(quote.usdPrice) : null,
      marketDate: quote ? quote.marketDate.toISOString() : null,
      quoteStatus: !quote ? "MISSING" : tooOld ? "STALE" : quote.status,
    };
  });
  const assetById = new Map(assetViews.map((asset) => [asset.id, asset]));
  let holdingsValue = new Prisma.Decimal(0);
  const positions: PositionView[] = player.positions
    .map((position) => {
      const asset = assetById.get(position.assetId);
      const price = asset?.usdPrice == null ? null : new Prisma.Decimal(asset.usdPrice);
      const marketValue = price?.mul(position.quantity) ?? null;
      if (marketValue) holdingsValue = holdingsValue.add(marketValue);
      return {
        assetId: position.assetId,
        quantity: decimal(position.quantity),
        costBasis: decimal(position.costBasis),
        marketValue: marketValue ? decimal(marketValue) : null,
        unrealizedPnl: marketValue ? decimal(marketValue.sub(position.costBasis)) : null,
      };
    })
    .sort((left, right) =>
      (assetById.get(left.assetId)?.displayOrder ?? Number.MAX_SAFE_INTEGER) -
      (assetById.get(right.assetId)?.displayOrder ?? Number.MAX_SAFE_INTEGER),
    );
  const netWorth = player.cash.add(holdingsValue);
  const recentTransactions: TransactionView[] = transactions.map((transaction) => ({
    id: transaction.id.toString(),
    type: transaction.type,
    assetId: transaction.assetId,
    quantity: transaction.quantity ? decimal(transaction.quantity) : null,
    usdUnitPrice: transaction.usdUnitPrice ? decimal(transaction.usdUnitPrice) : null,
    usdAmount: decimal(transaction.usdAmount),
    createdAt: transaction.createdAt.toISOString(),
  }));
  const quoteDates = assets.flatMap((asset) => (asset.quote ? [asset.quote.marketDate] : []));
  const marketAsOf = quoteDates.length
    ? new Date(Math.max(...quoteDates.map((date) => date.getTime()))).toISOString()
    : null;

  return {
    walletAddress: player.walletAddress,
    walletName: player.walletName,
    cash: decimal(player.cash),
    holdingsValue: decimal(holdingsValue),
    netWorth: decimal(netWorth),
    pnl: decimal(netWorth.sub(STARTING_CASH)),
    positions,
    assets: assetViews,
    recentTransactions,
    marketAsOf,
    settlementLocked: isSettlementLocked(now),
    updatedAt: player.updatedAt.toISOString(),
  };
}
