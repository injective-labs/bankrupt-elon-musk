import { Prisma, type Transaction } from "@prisma/client";
import type { AccountProjection, TransactionView } from "@/types";
import { isSettlementLocked } from "@/game/marketClock";
import { getAccountProjectionInTransaction } from "./account";
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
const MAX_QUANTITY = new Prisma.Decimal("999999999999999999.999999999999");
const MAX_MONEY = new Prisma.Decimal("9999999999999999999999.99999999");
const MAX_CURSOR = 9223372036854775807n;
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

function idempotencyConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "P2002") return false;
  const meta = "meta" in error && typeof error.meta === "object" && error.meta !== null ? error.meta as { target?: unknown } : {};
  return meta.target === "Transaction_walletAddress_idempotencyKey_key"
    || (Array.isArray(meta.target) && meta.target.length === 2 && meta.target[0] === "walletAddress" && meta.target[1] === "idempotencyKey");
}

function storedCommand(value: unknown): TradeCommand {
  if (!isRecord(value) || typeof value.assetId !== "string" || (value.side !== "BUY" && value.side !== "SELL") || typeof value.quantity !== "string" || typeof value.idempotencyKey !== "string") {
    throw new ApiError(500, "INVALID_TRADE_SNAPSHOT", "Stored trade command is invalid");
  }
  return { assetId: value.assetId, side: value.side, quantity: value.quantity, idempotencyKey: value.idempotencyKey };
}

function isStringOrNull(value: unknown): value is string | null { return typeof value === "string" || value === null; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isOptionalString(value: unknown): boolean { return value === undefined || value === null || typeof value === "string"; }
function isDecimalString(value: unknown): value is string { return typeof value === "string" && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value); }
function isDateString(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
function projectionSnapshot(value: unknown): AccountProjection {
  if (!isRecord(value)
    || typeof value.walletAddress !== "string" || !isStringOrNull(value.walletName ?? null)
    || !isDecimalString(value.cash) || !isDecimalString(value.holdingsValue) || !isDecimalString(value.netWorth) || !isDecimalString(value.pnl)
    || !Array.isArray(value.positions) || !Array.isArray(value.assets) || !Array.isArray(value.recentTransactions)
    || !(value.marketAsOf === null || isDateString(value.marketAsOf)) || typeof value.settlementLocked !== "boolean" || !isDateString(value.updatedAt)) {
    throw new ApiError(500, "INVALID_TRADE_SNAPSHOT", "Stored trade result is invalid");
  }
  const validPositions = value.positions.every((item) => isRecord(item) && typeof item.assetId === "string" && isDecimalString(item.quantity) && isDecimalString(item.costBasis) && (item.marketValue === null || isDecimalString(item.marketValue)) && (item.unrealizedPnl === null || isDecimalString(item.unrealizedPnl)));
  const validAssets = value.assets.every((item) => isRecord(item) && typeof item.id === "string" && typeof item.name === "string" && isOptionalString(item.nameEn) && typeof item.category === "string" && isOptionalString(item.subCategory) && typeof item.ticker === "string" && typeof item.currency === "string" && typeof item.unit === "string" && isOptionalString(item.unitEn) && typeof item.enabled === "boolean" && Number.isInteger(item.displayOrder) && (item.usdPrice === null || isDecimalString(item.usdPrice)) && (item.marketDate === null || isDateString(item.marketDate)) && ["ACTIVE", "STALE", "ERROR", "MISSING"].includes(String(item.quoteStatus)));
  const validTransactions = value.recentTransactions.every((item) => isRecord(item) && /^\d+$/.test(String(item.id)) && ["BUY", "SELL", "RESET"].includes(String(item.type)) && isStringOrNull(item.assetId) && (item.quantity === null || isDecimalString(item.quantity)) && (item.usdUnitPrice === null || isDecimalString(item.usdUnitPrice)) && isDecimalString(item.usdAmount) && isDateString(item.createdAt));
  if (!validPositions || !validAssets || !validTransactions) throw new ApiError(500, "INVALID_TRADE_SNAPSHOT", "Stored trade result is invalid");
  return value as unknown as AccountProjection;
}

function assertDecimal(value: Prisma.Decimal, max: Prisma.Decimal, scale: number): void {
  if (!value.isFinite() || value.abs().gt(max) || value.decimalPlaces() > scale) {
    throw new ApiError(422, "VALUE_OUT_OF_RANGE", "Trade value exceeds supported precision or range");
  }
}

// Database money policy: every USD-derived value is rounded HALF_UP to Decimal(30,8).
function money(value: Prisma.Decimal): Prisma.Decimal {
  return value.toDecimalPlaces(8, Prisma.Decimal.ROUND_HALF_UP);
}

function replay(row: { commandSnapshot: Prisma.JsonValue; resultSnapshot: Prisma.JsonValue }, command: TradeCommand): AccountProjection {
  const original = storedCommand(row.commandSnapshot);
  if (original.assetId !== command.assetId || original.side !== command.side || original.quantity !== command.quantity || original.idempotencyKey !== command.idempotencyKey) throw new ApiError(422, "IDEMPOTENCY_KEY_REUSED", "Idempotency key was already used for another command");
  return projectionSnapshot(row.resultSnapshot);
}

export async function executeTrade(walletAddress: string, command: TradeCommand): Promise<AccountProjection> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        const duplicate = await tx.transaction.findUnique({
          where: { walletAddress_idempotencyKey: { walletAddress, idempotencyKey: command.idempotencyKey } },
        });
        if (duplicate) return replay(duplicate, command);
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
        assertDecimal(quantity, MAX_QUANTITY, 12);

        const amount = money(price.mul(quantity));
        if (!amount.gt(0)) {
          throw new ApiError(422, "MINIMUM_NOTIONAL", "Trade amount is below the minimum supported USD value");
        }
        const quantityBefore = position?.quantity ?? new Prisma.Decimal(0);
        const costBefore = position?.costBasis ?? new Prisma.Decimal(0);
        let cashAfter: Prisma.Decimal;
        let quantityAfter: Prisma.Decimal;
        let costAfter: Prisma.Decimal;
        if (command.side === "BUY") {
          if (amount.gt(player.cash)) throw new ApiError(422, "INSUFFICIENT_CASH", "Insufficient cash");
          cashAfter = money(player.cash.sub(amount)); quantityAfter = quantityBefore.add(quantity); costAfter = money(costBefore.add(amount));
        } else {
          if (!position || quantity.gt(quantityBefore)) throw new ApiError(422, "INSUFFICIENT_HOLDINGS", "Insufficient holdings");
          cashAfter = money(player.cash.add(amount)); quantityAfter = quantityBefore.sub(quantity);
          costAfter = quantityAfter.isZero() ? new Prisma.Decimal(0) : money(costBefore.mul(quantityAfter).div(quantityBefore));
        }
        assertDecimal(quantityAfter, MAX_QUANTITY, 12);
        for (const value of [amount, cashAfter, costAfter, player.cash, costBefore]) assertDecimal(value, MAX_MONEY, 8);
        if (command.side === "BUY") {
          await tx.position.upsert({ where: positionKey(walletAddress, command.assetId), create: { walletAddress, assetId: command.assetId, quantity: quantityAfter, costBasis: costAfter }, update: { quantity: quantityAfter, costBasis: costAfter } });
        } else if (quantityAfter.isZero()) await tx.position.delete({ where: positionKey(walletAddress, command.assetId) });
        else await tx.position.update({ where: positionKey(walletAddress, command.assetId), data: { quantity: quantityAfter, costBasis: costAfter } });
        await tx.player.update({ where: { walletAddress }, data: { cash: cashAfter } });
        const ledger = await tx.transaction.create({ data: {
          walletAddress, idempotencyKey: command.idempotencyKey, type: command.side, assetId: command.assetId,
          commandSnapshot: command as unknown as Prisma.InputJsonValue,
          resultSnapshot: {},
          quantity, nativePrice: quote.nativePrice, currency: quote.currency, fxRateToUsd: quote.fxRateToUsd,
          usdUnitPrice: price, usdAmount: amount, cashBefore: player.cash, cashAfter,
          quantityBefore, quantityAfter, costBasisBefore: costBefore, costBasisAfter: costAfter, marketDate: quote.marketDate,
        }, select: { id: true } });
        const snapshot = await getAccountProjectionInTransaction(tx, walletAddress);
        await tx.transaction.update({ where: { id: ledger.id }, data: { resultSnapshot: snapshot as unknown as Prisma.InputJsonValue } });
        return snapshot;
      }, { isolationLevel: "Serializable" });
      return result;
    } catch (error) {
      if (idempotencyConflict(error)) {
        const duplicate = await prisma.transaction.findUnique({ where: { walletAddress_idempotencyKey: { walletAddress, idempotencyKey: command.idempotencyKey } } });
        if (!duplicate) throw new ApiError(409, "TRADE_CONFLICT", "Concurrent idempotent trade could not be replayed");
        return replay(duplicate, command);
      }
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
    if (!/^\d+$/.test(options.cursor)) throw new ApiError(422, "INVALID_CURSOR", "Invalid history cursor");
    try { cursor = BigInt(options.cursor); } catch { throw new ApiError(422, "INVALID_CURSOR", "Invalid history cursor"); }
    if (cursor < 1n || cursor > MAX_CURSOR) throw new ApiError(422, "INVALID_CURSOR", "Invalid history cursor");
  }
  const rows = await prisma.transaction.findMany({ where: { walletAddress, ...(cursor ? { id: { lt: cursor } } : {}) }, orderBy: { id: "desc" }, take: limit + 1 });
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  return { rows: page.map(view), nextCursor: hasMore ? page.at(-1)!.id.toString() : null };
}
