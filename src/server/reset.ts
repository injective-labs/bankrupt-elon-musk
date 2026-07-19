import { Prisma } from "@prisma/client";
import type { AccountProjection } from "@/types";
import { STARTING_CASH, getAccountProjectionInTransaction } from "./account";
import { prisma } from "./db";
import { ApiError } from "./http/errors";

const MAX_ATTEMPTS = 3;

interface ResetCommand {
  type: "RESET";
  idempotencyKey: string;
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

function storedCommand(value: unknown): ResetCommand {
  if (!isRecord(value) || value.type !== "RESET" || typeof value.idempotencyKey !== "string") {
    throw new ApiError(500, "INVALID_RESET_SNAPSHOT", "Stored reset command is invalid");
  }
  return { type: "RESET", idempotencyKey: value.idempotencyKey };
}

function isOptionalString(value: unknown): boolean { return value === undefined || value === null || typeof value === "string"; }
function isDecimalString(value: unknown): value is string { return typeof value === "string" && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value); }
function isDateString(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)); }

function projectionSnapshot(value: unknown): AccountProjection {
  if (!isRecord(value)
    || typeof value.walletAddress !== "string"
    || !(value.walletName === null || typeof value.walletName === "string")
    || ![value.cash, value.holdingsValue, value.netWorth, value.pnl].every(isDecimalString)
    || !Array.isArray(value.positions) || !Array.isArray(value.assets) || !Array.isArray(value.recentTransactions)
    || !(value.marketAsOf === null || isDateString(value.marketAsOf))
    || typeof value.settlementLocked !== "boolean" || !isDateString(value.updatedAt)) {
    throw new ApiError(500, "INVALID_RESET_SNAPSHOT", "Stored reset result is invalid");
  }
  const validPositions = value.positions.every((item) => isRecord(item) && typeof item.assetId === "string" && isDecimalString(item.quantity) && isDecimalString(item.costBasis) && (item.marketValue === null || isDecimalString(item.marketValue)) && (item.unrealizedPnl === null || isDecimalString(item.unrealizedPnl)));
  const validAssets = value.assets.every((item) => isRecord(item) && typeof item.id === "string" && typeof item.name === "string" && isOptionalString(item.nameEn) && typeof item.category === "string" && isOptionalString(item.subCategory) && typeof item.ticker === "string" && typeof item.currency === "string" && typeof item.unit === "string" && isOptionalString(item.unitEn) && typeof item.enabled === "boolean" && Number.isInteger(item.displayOrder) && (item.usdPrice === null || isDecimalString(item.usdPrice)) && (item.marketDate === null || isDateString(item.marketDate)) && ["ACTIVE", "STALE", "ERROR", "MISSING"].includes(String(item.quoteStatus)));
  const validTransactions = value.recentTransactions.every((item) => isRecord(item) && /^\d+$/.test(String(item.id)) && ["BUY", "SELL", "RESET"].includes(String(item.type)) && (item.assetId === null || typeof item.assetId === "string") && (item.quantity === null || isDecimalString(item.quantity)) && (item.usdUnitPrice === null || isDecimalString(item.usdUnitPrice)) && isDecimalString(item.usdAmount) && isDateString(item.createdAt));
  if (!validPositions || !validAssets || !validTransactions) {
    throw new ApiError(500, "INVALID_RESET_SNAPSHOT", "Stored reset result is invalid");
  }
  return value as unknown as AccountProjection;
}

function replay(row: { commandSnapshot: Prisma.JsonValue; resultSnapshot: Prisma.JsonValue }, command: ResetCommand): AccountProjection {
  const original = storedCommand(row.commandSnapshot);
  if (original.idempotencyKey !== command.idempotencyKey) {
    throw new ApiError(422, "IDEMPOTENCY_KEY_REUSED", "Idempotency key was already used for another command");
  }
  return projectionSnapshot(row.resultSnapshot);
}

export async function resetAccount(walletAddress: string, idempotencyKey: string): Promise<AccountProjection> {
  if (process.env.ENABLE_GAME_RESET !== "true") {
    throw new ApiError(403, "RESET_DISABLED", "Game reset is disabled");
  }
  const command: ResetCommand = { type: "RESET", idempotencyKey };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const duplicate = await tx.transaction.findUnique({
          where: { walletAddress_idempotencyKey: { walletAddress, idempotencyKey } },
        });
        if (duplicate) return replay(duplicate, command);

        const [player, positions] = await Promise.all([
          tx.player.findUnique({ where: { walletAddress } }),
          tx.position.findMany({ where: { walletAddress }, select: { quantity: true, costBasis: true } }),
        ]);
        if (!player) throw new ApiError(404, "PLAYER_NOT_FOUND", "Player not found");

        const quantityBefore = positions.reduce((total, position) => total.add(position.quantity), new Prisma.Decimal(0));
        const costBasisBefore = positions.reduce((total, position) => total.add(position.costBasis), new Prisma.Decimal(0));
        await tx.position.deleteMany({ where: { walletAddress } });
        await tx.player.update({ where: { walletAddress }, data: { cash: STARTING_CASH } });
        const ledger = await tx.transaction.create({
          data: {
            walletAddress, idempotencyKey, type: "RESET", assetId: null,
            commandSnapshot: command as unknown as Prisma.InputJsonValue,
            resultSnapshot: {}, usdAmount: new Prisma.Decimal(0),
            cashBefore: player.cash, cashAfter: STARTING_CASH,
            quantityBefore, quantityAfter: new Prisma.Decimal(0),
            costBasisBefore, costBasisAfter: new Prisma.Decimal(0),
          },
          select: { id: true },
        });
        const snapshot = await getAccountProjectionInTransaction(tx, walletAddress);
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
        return replay(duplicate, command);
      }
      if (!conflict(error)) throw error;
      if (attempt === MAX_ATTEMPTS) {
        throw new ApiError(409, "RESET_CONFLICT", "Reset conflicted with another request; retry with the same idempotency key");
      }
    }
  }
  throw new ApiError(409, "RESET_CONFLICT", "Reset conflict");
}
