import type { GameState, Position, LogEntry } from "@/types";
import { FALLBACK_FX } from "@/data/constants";
import { prisma } from "./db";

export interface SaveMetrics {
  netWorth: number;
  pnl: number;
  holdingsValue: number;
}

export interface SavePayload {
  state: GameState;
  metrics: SaveMetrics;
  walletName?: string | null;
}

/** Recompose the client GameState from the normalized tables. */
export async function loadState(wallet: string): Promise<GameState | null> {
  const player = await prisma.player.findUnique({
    where: { walletAddress: wallet },
    include: { positions: true },
  });
  if (!player) return null;

  const trades = await prisma.tradeLog.findMany({
    where: { walletAddress: wallet },
    orderBy: { ts: "desc" },
    take: 18,
  });

  const inventory: Record<string, Position> = {};
  for (const p of player.positions) {
    inventory[p.assetId] = { quantity: p.quantity.toNumber(), costBasis: p.costBasis.toNumber() };
  }
  const log: LogEntry[] = trades.map((t) => ({ title: t.title, detail: t.detail, ts: t.ts }));

  return {
    inventory,
    cash: player.cash.toNumber(),
    debt: 0,
    accruedInterest: 0,
    lastInterestAccruedAt: Date.now(),
    liquidated: false,
    leverage: 1,
    prices: {}, // market data is global; client refetches from Yahoo
    fxRates: { ...FALLBACK_FX },
    lastPriceRefresh: null,
    locale: "zh",
    log,
    selectedCategory: "全部",
    selectedSubcategory: "全部",
    search: "",
    sort: "price-asc",
    sound: true,
  };
}

/** Decompose the client GameState into the normalized tables (atomic). */
export async function saveState(wallet: string, payload: SavePayload): Promise<void> {
  const { state, walletName } = payload;

  const last = await prisma.tradeLog.findFirst({
    where: { walletAddress: wallet },
    orderBy: { ts: "desc" },
    select: { ts: true },
  });
  const maxTs = last?.ts ?? -1;

  const newTrades = (state.log || [])
    .filter((e) => Number(e.ts) > maxTs)
    .map((e) => ({
      walletAddress: wallet,
      ts: Number(e.ts) || 0,
      title: String(e.title ?? ""),
      detail: String(e.detail ?? ""),
    }));

  const positions = Object.entries(state.inventory || {}).map(([assetId, pos]) => ({
    walletAddress: wallet,
    assetId,
    quantity: Number(pos.quantity) || 0,
    costBasis: Number(pos.costBasis) || 0,
  }));

  const cash = Number(state.cash) || 0;

  await prisma.$transaction([
    prisma.player.upsert({
      where: { walletAddress: wallet },
      create: { walletAddress: wallet, walletName: walletName ?? null, cash, lastLoginAt: new Date() },
      update: { ...(walletName !== undefined ? { walletName } : {}), cash },
    }),
    prisma.position.deleteMany({ where: { walletAddress: wallet } }),
    ...(positions.length ? [prisma.position.createMany({ data: positions })] : []),
    ...(newTrades.length ? [prisma.tradeLog.createMany({ data: newTrades })] : []),
  ]);
}
