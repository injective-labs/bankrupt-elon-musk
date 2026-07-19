import { Prisma } from "@prisma/client";
import type { AccountProjection } from "@/types";
import { STARTING_CASH, getAccountProjectionInTransaction } from "./account";
import { prisma } from "./db";
import { ApiError } from "./http/errors";

const MAX_ATTEMPTS = 3;
const MAX_AUDIT_POSITIONS = 160;
const MAX_ASSET_ID_LENGTH = 128;

interface ResetCommand {
  kind: "RESET";
  version: 1;
  idempotencyKey: string;
  positionsBefore: Array<{ assetId: string; quantity: string; costBasis: string }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function conflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2034";
}

function idempotencyConflict(error: unknown): boolean {
  if (!isRecord(error) || error.code !== "P2002") return false;
  const meta = isRecord(error.meta) ? error.meta : {};
  return meta.target === "Transaction_walletAddress_idempotencyKey_key"
    || (Array.isArray(meta.target) && meta.target.length === 2 && meta.target[0] === "walletAddress" && meta.target[1] === "idempotencyKey");
}

function isTradeCommand(value: unknown): boolean {
  return isRecord(value) && typeof value.assetId === "string" && value.assetId.length > 0
    && (value.side === "BUY" || value.side === "SELL")
    && typeof value.quantity === "string" && typeof value.idempotencyKey === "string";
}

function canonicalPositionDecimal(value: unknown, integerDigits: number, scale: number): value is string {
  if (typeof value !== "string") return false;
  const match = /^(0|[1-9]\d*)(?:\.(\d*[1-9]))?$/.exec(value);
  if (!match) return false;
  return match[1].length <= integerDigits && (match[2]?.length ?? 0) <= scale;
}

function positionsAudit(value: unknown): ResetCommand["positionsBefore"] {
  if (!Array.isArray(value) || value.length > MAX_AUDIT_POSITIONS) {
    throw new ApiError(500, "INVALID_RESET_SNAPSHOT", "Stored reset command is invalid");
  }
  let previous: string | null = null;
  return value.map((position) => {
    if (!isRecord(position) || typeof position.assetId !== "string" || position.assetId.length === 0 || position.assetId.length > MAX_ASSET_ID_LENGTH
      || previous !== null && position.assetId <= previous
      || !canonicalPositionDecimal(position.quantity, 18, 12)
      || !canonicalPositionDecimal(position.costBasis, 22, 8)) {
      throw new ApiError(500, "INVALID_RESET_SNAPSHOT", "Stored reset command is invalid");
    }
    previous = position.assetId;
    return { assetId: position.assetId, quantity: position.quantity, costBasis: position.costBasis };
  });
}

function storedCommand(value: unknown): ResetCommand {
  if (isTradeCommand(value) || (isRecord(value) && typeof value.kind === "string" && value.kind !== "RESET")) {
    throw new ApiError(422, "IDEMPOTENCY_KEY_REUSED", "Idempotency key was already used for another command");
  }
  if (!isRecord(value) || value.kind !== "RESET" || value.version !== 1 || typeof value.idempotencyKey !== "string" || !Array.isArray(value.positionsBefore)) {
    throw new ApiError(500, "INVALID_RESET_SNAPSHOT", "Stored reset command is invalid");
  }
  const positionsBefore = positionsAudit(value.positionsBefore);
  return { kind: "RESET", version: 1, idempotencyKey: value.idempotencyKey, positionsBefore };
}

function isOptionalString(value: unknown): boolean { return value === undefined || value === null || typeof value === "string"; }
function isDecimalString(value: unknown): value is string { return typeof value === "string" && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value); }
function isDateString(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)); }

function projectionSnapshot(value: unknown, walletAddress: string): AccountProjection {
  if (!isRecord(value)
    || typeof value.walletAddress !== "string"
    || !(value.walletName === null || typeof value.walletName === "string")
    || ![value.cash, value.holdingsValue, value.netWorth, value.pnl].every(isDecimalString)
    || !Array.isArray(value.positions) || !Array.isArray(value.assets) || !Array.isArray(value.recentTransactions)
    || !(value.marketAsOf === null || isDateString(value.marketAsOf))
    || typeof value.settlementLocked !== "boolean" || typeof value.resetEnabled !== "boolean" || !isDateString(value.updatedAt)) {
    throw new ApiError(500, "INVALID_RESET_SNAPSHOT", "Stored reset result is invalid");
  }
  const validPositions = value.positions.every((item) => isRecord(item) && typeof item.assetId === "string" && isDecimalString(item.quantity) && isDecimalString(item.costBasis) && (item.marketValue === null || isDecimalString(item.marketValue)) && (item.unrealizedPnl === null || isDecimalString(item.unrealizedPnl)));
  const validAssets = value.assets.every((item) => isRecord(item) && typeof item.id === "string" && typeof item.name === "string" && isOptionalString(item.nameEn) && typeof item.category === "string" && isOptionalString(item.subCategory) && typeof item.ticker === "string" && typeof item.currency === "string" && typeof item.unit === "string" && isOptionalString(item.unitEn) && typeof item.enabled === "boolean" && Number.isInteger(item.displayOrder) && (item.usdPrice === null || isDecimalString(item.usdPrice)) && (item.marketDate === null || isDateString(item.marketDate)) && ["ACTIVE", "STALE", "ERROR", "MISSING"].includes(String(item.quoteStatus)));
  const validTransactions = value.recentTransactions.every((item) => isRecord(item) && /^\d+$/.test(String(item.id)) && ["BUY", "SELL", "RESET"].includes(String(item.type)) && (item.assetId === null || typeof item.assetId === "string") && (item.quantity === null || isDecimalString(item.quantity)) && (item.usdUnitPrice === null || isDecimalString(item.usdUnitPrice)) && isDecimalString(item.usdAmount) && isDateString(item.createdAt) && (item.type !== "RESET" || (item.assetId === null && item.cashAfter === STARTING_CASH.toString())));
  const resetState = value.walletAddress === walletAddress
    && value.cash === STARTING_CASH.toString()
    && value.positions.length === 0
    && value.holdingsValue === "0"
    && value.netWorth === STARTING_CASH.toString()
    && value.pnl === "0";
  if (!validPositions || !validAssets || !validTransactions || !resetState) {
    throw new ApiError(500, "INVALID_RESET_SNAPSHOT", "Stored reset result is invalid");
  }
  return value as unknown as AccountProjection;
}

function replay(row: { commandSnapshot: Prisma.JsonValue; resultSnapshot: Prisma.JsonValue }, walletAddress: string, idempotencyKey: string): AccountProjection {
  const original = storedCommand(row.commandSnapshot);
  if (original.idempotencyKey !== idempotencyKey) {
    throw new ApiError(422, "IDEMPOTENCY_KEY_REUSED", "Idempotency key was already used for another command");
  }
  return projectionSnapshot(row.resultSnapshot, walletAddress);
}

export async function resetAccount(walletAddress: string, idempotencyKey: string): Promise<AccountProjection> {
  if (process.env.ENABLE_GAME_RESET !== "true") {
    throw new ApiError(403, "RESET_DISABLED", "Game reset is disabled");
  }
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const duplicate = await tx.transaction.findUnique({
          where: { walletAddress_idempotencyKey: { walletAddress, idempotencyKey } },
        });
        if (duplicate) return replay(duplicate, walletAddress, idempotencyKey);

        const [player, positions] = await Promise.all([
          tx.player.findUnique({ where: { walletAddress } }),
          tx.position.findMany({ where: { walletAddress }, select: { assetId: true, quantity: true, costBasis: true }, orderBy: { assetId: "asc" } }),
        ]);
        if (!player) throw new ApiError(404, "PLAYER_NOT_FOUND", "Player not found");

        const positionsBefore = positionsAudit(positions
          .map((position) => ({ assetId: position.assetId, quantity: position.quantity.toFixed(), costBasis: position.costBasis.toFixed() }))
          .sort((left, right) => left.assetId < right.assetId ? -1 : left.assetId > right.assetId ? 1 : 0));
        const command: ResetCommand = { kind: "RESET", version: 1, idempotencyKey, positionsBefore };
        await tx.position.deleteMany({ where: { walletAddress } });
        await tx.player.update({ where: { walletAddress }, data: { cash: STARTING_CASH } });
        const ledger = await tx.transaction.create({
          data: {
            walletAddress, idempotencyKey, type: "RESET", assetId: null,
            commandSnapshot: command as unknown as Prisma.InputJsonValue,
            resultSnapshot: {}, usdAmount: new Prisma.Decimal(0),
            cashBefore: player.cash, cashAfter: STARTING_CASH,
            quantityBefore: null, quantityAfter: null,
            costBasisBefore: null, costBasisAfter: null,
          },
          select: { id: true },
        });
        const projection = await getAccountProjectionInTransaction(tx, walletAddress);
        const snapshot = {
          ...projection,
          recentTransactions: projection.recentTransactions.map((transaction) => transaction.type === "RESET"
            ? { ...transaction, cashAfter: STARTING_CASH.toString() }
            : transaction),
        };
        await tx.transaction.update({
          where: { id: ledger.id },
          data: { resultSnapshot: snapshot as unknown as Prisma.InputJsonValue },
        });
        return snapshot;
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (idempotencyConflict(error)) {
        const duplicate = await prisma.transaction.findUnique({
          where: { walletAddress_idempotencyKey: { walletAddress, idempotencyKey } },
        });
        if (!duplicate) throw new ApiError(409, "RESET_CONFLICT", "Concurrent idempotent reset could not be replayed");
        return replay(duplicate, walletAddress, idempotencyKey);
      }
      if (!conflict(error)) throw error;
      if (attempt === MAX_ATTEMPTS) {
        throw new ApiError(409, "RESET_CONFLICT", "Reset conflicted with another request; retry with the same idempotency key");
      }
    }
  }
  throw new ApiError(409, "RESET_CONFLICT", "Reset conflict");
}
