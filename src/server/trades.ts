import { Prisma, type Transaction } from "@prisma/client";
import type { AccountProjection, TransactionView } from "@/types";
import { isSettlementLocked } from "@/game/marketClock";
import { getAccountProjection } from "./account";
import { prisma } from "./db";
import { ApiError } from "./http/errors";
import { isQuoteFresh } from "./quoteFreshness";

export interface TradeCommand {
  assetId: string;
  side: "BUY" | "SELL";
  quantity: string | "MAX";
  idempotencyKey: string;
}

const MAX_ATTEMPTS = 3;
const positionKey = (walletAddress: string, assetId: string) => ({ walletAddress_assetId: { walletAddress, assetId } });

function quantityFrom(value: string): Prisma.Decimal {
  if (!/^\d+$/.test(value)) throw new ApiError(422, "INVALID_QUANTITY", "Quantity must be a positive integer");
  const quantity = new Prisma.Decimal(value);
  if (!quantity.gt(0) || !quantity.isInteger()) throw new ApiError(422, "INVALID_QUANTITY", "Quantity must be a positive integer");
  return quantity;
}

function conflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError
    ? error.code === "P2034"
    : typeof error === "object" && error !== null && "code" in error && error.code === "P2034";
}

export async function executeTrade(walletAddress: string, command: TradeCommand): Promise<AccountProjection> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      await prisma.$transaction(async (tx) => {
        const duplicate = await tx.transaction.findUnique({
          where: { walletAddress_idempotencyKey: { walletAddress, idempotencyKey: command.idempotencyKey } },
        });
        if (duplicate) return;
        const now = new Date();
        if (isSettlementLocked(now)) throw new ApiError(422, "SETTLEMENT_LOCKED", "Trading is locked during settlement");
        const [player, asset, position] = await Promise.all([
          tx.player.findUnique({ where: { walletAddress } }),
          tx.asset.findUnique({ where: { id: command.assetId }, include: { quote: true } }),
          tx.position.findUnique({ where: positionKey(walletAddress, command.assetId) }),
        ]);
        if (!player) throw new ApiError(404, "PLAYER_NOT_FOUND", "Player not found");
        if (!asset || !asset.enabled) throw new ApiError(422, "ASSET_DISABLED", "Asset is unavailable for trading");
        const quote = asset.quote;
        if (!quote) throw new ApiError(422, "QUOTE_MISSING", "No authoritative quote is available");
        if (quote.status !== "ACTIVE" || !isQuoteFresh(quote.marketDate, now)) throw new ApiError(422, "QUOTE_STALE", "The authoritative quote is stale");
        const price = quote.usdPrice;
        if (!price.gt(0)) throw new ApiError(422, "QUOTE_INVALID", "The authoritative quote is invalid");

        let quantity: Prisma.Decimal;
        if (command.quantity === "MAX") {
          quantity = command.side === "BUY" ? player.cash.div(price).floor() : (position?.quantity ?? new Prisma.Decimal(0));
          if (!quantity.gt(0)) throw new ApiError(422, command.side === "BUY" ? "INSUFFICIENT_CASH" : "INSUFFICIENT_HOLDINGS", "Nothing is available to trade");
        } else quantity = quantityFrom(command.quantity);

        const amount = price.mul(quantity);
        const quantityBefore = position?.quantity ?? new Prisma.Decimal(0);
        const costBefore = position?.costBasis ?? new Prisma.Decimal(0);
        let cashAfter: Prisma.Decimal;
        let quantityAfter: Prisma.Decimal;
        let costAfter: Prisma.Decimal;
        if (command.side === "BUY") {
          if (amount.gt(player.cash)) throw new ApiError(422, "INSUFFICIENT_CASH", "Insufficient cash");
          cashAfter = player.cash.sub(amount); quantityAfter = quantityBefore.add(quantity); costAfter = costBefore.add(amount);
          await tx.position.upsert({ where: positionKey(walletAddress, command.assetId), create: { walletAddress, assetId: command.assetId, quantity: quantityAfter, costBasis: costAfter }, update: { quantity: quantityAfter, costBasis: costAfter } });
        } else {
          if (!position || quantity.gt(quantityBefore)) throw new ApiError(422, "INSUFFICIENT_HOLDINGS", "Insufficient holdings");
          cashAfter = player.cash.add(amount); quantityAfter = quantityBefore.sub(quantity);
          costAfter = quantityAfter.isZero() ? new Prisma.Decimal(0) : costBefore.mul(quantityAfter).div(quantityBefore);
          if (quantityAfter.isZero()) await tx.position.delete({ where: positionKey(walletAddress, command.assetId) });
          else await tx.position.update({ where: positionKey(walletAddress, command.assetId), data: { quantity: quantityAfter, costBasis: costAfter } });
        }
        await tx.player.update({ where: { walletAddress }, data: { cash: cashAfter } });
        await tx.transaction.create({ data: {
          walletAddress, idempotencyKey: command.idempotencyKey, type: command.side, assetId: command.assetId,
          quantity, nativePrice: quote.nativePrice, currency: quote.currency, fxRateToUsd: quote.fxRateToUsd,
          usdUnitPrice: price, usdAmount: amount, cashBefore: player.cash, cashAfter,
          quantityBefore, quantityAfter, costBasisBefore: costBefore, costBasisAfter: costAfter, marketDate: quote.marketDate,
        } });
      }, { isolationLevel: "Serializable" });
      return getAccountProjection(walletAddress);
    } catch (error) {
      if (!conflict(error)) throw error;
      if (attempt === MAX_ATTEMPTS) throw new ApiError(409, "TRADE_CONFLICT", "Trade conflicted with another request; retry with the same idempotency key");
    }
  }
  throw new ApiError(409, "TRADE_CONFLICT", "Trade conflict");
}

function view(row: Transaction): TransactionView {
  return { id: row.id.toString(), type: row.type, assetId: row.assetId, quantity: row.quantity?.toString() ?? null, usdUnitPrice: row.usdUnitPrice?.toString() ?? null, usdAmount: row.usdAmount.toString(), createdAt: row.createdAt.toISOString() };
}

export async function getTradeHistory(walletAddress: string, options: { cursor?: string; limit?: number } = {}) {
  const rawLimit = Number.isFinite(options.limit) ? Math.trunc(options.limit!) : 50;
  const limit = Math.max(1, Math.min(rawLimit, 100));
  let cursor: bigint | undefined;
  if (options.cursor !== undefined) {
    try { cursor = BigInt(options.cursor); } catch { throw new ApiError(422, "INVALID_CURSOR", "Invalid history cursor"); }
    if (cursor < 1n) throw new ApiError(422, "INVALID_CURSOR", "Invalid history cursor");
  }
  const rows = await prisma.transaction.findMany({ where: { walletAddress, ...(cursor ? { id: { lt: cursor } } : {}) }, orderBy: { id: "desc" }, take: limit + 1 });
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  return { rows: page.map(view), nextCursor: hasMore ? page.at(-1)!.id.toString() : null };
}
