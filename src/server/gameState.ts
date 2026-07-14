import type { GameState, Position, LogEntry, SortMode } from "@/types";
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

const SORT_MODES: SortMode[] = ["price-asc", "price-desc", "owned"];

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
    inventory[p.productId] = { quantity: p.quantity, costBasis: p.costBasis };
  }
  const log: LogEntry[] = trades.map((t) => ({ title: t.title, detail: t.detail, ts: t.ts }));

  return {
    inventory,
    cash: player.cash,
    debt: player.debt,
    accruedInterest: player.accruedInterest,
    lastInterestAccruedAt: player.lastInterestAccruedAt,
    liquidated: player.liquidated,
    leverage: player.leverage,
    prices: {}, // market data is global; client refetches from Yahoo
    fxRates: { ...FALLBACK_FX },
    lastPriceRefresh: null,
    locale: player.locale === "en" ? "en" : "zh",
    log,
    selectedCategory: "全部",
    selectedSubcategory: "全部",
    search: "",
    sort: (SORT_MODES.includes(player.sort as SortMode) ? player.sort : "price-asc") as SortMode,
    sound: player.sound,
  };
}

/** Decompose the client GameState into the normalized tables (atomic). */
export async function saveState(wallet: string, payload: SavePayload): Promise<void> {
  const { state, metrics, walletName } = payload;

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

  const positions = Object.entries(state.inventory || {}).map(([productId, pos]) => ({
    walletAddress: wallet,
    productId,
    quantity: Number(pos.quantity) || 0,
    costBasis: Number(pos.costBasis) || 0,
  }));

  const scalars = {
    cash: Number(state.cash) || 0,
    debt: Number(state.debt) || 0,
    accruedInterest: Number(state.accruedInterest) || 0,
    lastInterestAccruedAt: Number(state.lastInterestAccruedAt) || 0,
    liquidated: Boolean(state.liquidated),
    leverage: Number(state.leverage) || 1,
    netWorth: Number(metrics.netWorth) || 0,
    pnl: Number(metrics.pnl) || 0,
    holdingsValue: Number(metrics.holdingsValue) || 0,
    locale: state.locale === "en" ? "en" : "zh",
    sound: Boolean(state.sound),
    sort: SORT_MODES.includes(state.sort) ? state.sort : "price-asc",
  };

  await prisma.$transaction([
    prisma.player.upsert({
      where: { walletAddress: wallet },
      create: { walletAddress: wallet, walletName: walletName ?? null, ...scalars },
      update: { ...(walletName !== undefined ? { walletName } : {}), ...scalars },
    }),
    prisma.position.deleteMany({ where: { walletAddress: wallet } }),
    ...(positions.length ? [prisma.position.createMany({ data: positions })] : []),
    ...(newTrades.length ? [prisma.tradeLog.createMany({ data: newTrades })] : []),
  ]);
}
