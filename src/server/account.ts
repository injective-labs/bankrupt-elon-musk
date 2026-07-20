import { Prisma, type Player } from "@prisma/client";
import { getAddress } from "viem";
import type { AccountProjection, AssetView, PositionView, TransactionView } from "@/types";
import { isSettlementLocked } from "@/game/marketClock";
import { prisma } from "./db";
import { ApiError } from "./http/errors";
import { isQuoteFresh } from "./quoteFreshness";
import { decimalToString } from "./decimal";

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

export async function getAccountProjectionInTransaction(
  tx: Prisma.TransactionClient,
  walletAddress: string,
): Promise<AccountProjection> {
    const [snapshotPlayer, snapshotAssets, snapshotTransactions] = await Promise.all([
      tx.player.findUnique({ where: { walletAddress }, include: { positions: true } }),
      tx.asset.findMany({
        where: { OR: [{ enabled: true }, { positions: { some: { walletAddress } } }] },
        include: { quote: true },
        orderBy: { displayOrder: "asc" },
      }),
      tx.transaction.findMany({
        where: { walletAddress },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
    ]);
  const { player, assets, transactions } = { player: snapshotPlayer, assets: snapshotAssets, transactions: snapshotTransactions };
  if (!player) throw new ApiError(404, "PLAYER_NOT_FOUND", "Player not found");

  const now = new Date();
  const assetViews: AssetView[] = assets.map((asset) => {
    const quote = asset.quote;
    const tooOld = quote ? !isQuoteFresh(quote.marketDate, now) : false;
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
      usdPrice: quote ? decimalToString(quote.usdPrice) : null,
      marketDate: quote ? quote.marketDate.toISOString() : null,
      quoteStatus: !quote ? "MISSING" : tooOld ? "STALE" : quote.status,
    };
  });
  const assetById = new Map(assetViews.map((asset) => [asset.id, asset]));
  const invalidHeldAsset = player.positions.find((position) => {
    if (position.quantity.isZero()) return false;
    const asset = assetById.get(position.assetId);
    return !asset || asset.quoteStatus !== "ACTIVE" || asset.usdPrice == null;
  });
  if (invalidHeldAsset) {
    throw new ApiError(503, "MARKET_DATA_UNAVAILABLE", "Account market data is incomplete");
  }
  let holdingsValue = new Prisma.Decimal(0);
  const positions: PositionView[] = player.positions
    .map((position) => {
      const asset = assetById.get(position.assetId);
      const price = asset?.usdPrice == null ? null : new Prisma.Decimal(asset.usdPrice);
      const marketValue = price?.mul(position.quantity) ?? null;
      if (marketValue) holdingsValue = holdingsValue.add(marketValue);
      return {
        assetId: position.assetId,
        quantity: decimalToString(position.quantity),
        costBasis: decimalToString(position.costBasis),
        marketValue: marketValue ? decimalToString(marketValue) : null,
        unrealizedPnl: marketValue ? decimalToString(marketValue.sub(position.costBasis)) : null,
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
    quantity: transaction.quantity ? decimalToString(transaction.quantity) : null,
    usdUnitPrice: transaction.usdUnitPrice ? decimalToString(transaction.usdUnitPrice) : null,
    usdAmount: decimalToString(transaction.usdAmount),
    createdAt: transaction.createdAt.toISOString(),
  }));
  const quoteDates = assets.flatMap((asset) => (asset.quote ? [asset.quote.marketDate] : []));
  const marketAsOf = quoteDates.length
    ? new Date(Math.max(...quoteDates.map((date) => date.getTime()))).toISOString()
    : null;

  return {
    walletAddress: player.walletAddress,
    walletName: player.walletName,
    cash: decimalToString(player.cash),
    holdingsValue: decimalToString(holdingsValue),
    netWorth: decimalToString(netWorth),
    pnl: decimalToString(netWorth.sub(STARTING_CASH)),
    positions,
    assets: assetViews,
    recentTransactions,
    marketAsOf,
    settlementLocked: isSettlementLocked(now),
    resetEnabled: process.env.ENABLE_GAME_RESET === "true",
    updatedAt: player.updatedAt.toISOString(),
  };
}

export async function getAccountProjection(walletAddress: string): Promise<AccountProjection> {
  return prisma.$transaction(
    (tx) => getAccountProjectionInTransaction(tx, walletAddress),
    { isolationLevel: "RepeatableRead" },
  );
}
