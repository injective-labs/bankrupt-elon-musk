import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { verifyMessage, type Hex } from "viem";

import { CATEGORY_LABELS, SUBCATEGORY_LABELS } from "@/data/categoryLabels";
import { isSettlementLocked } from "@/game/marketClock";
import { decimalToString } from "./decimal";
import { prisma } from "./db";
import { ApiError } from "./http/errors";
import { isQuoteFresh } from "./quoteFreshness";

export type TradePlanLeg =
  | { side: "BUY"; asset: string; quantity: string }
  | { side: "BUY"; asset: string; cashAmount: string }
  | { side: "BUY"; asset: string; cashBps: number }
  | { side: "SELL"; asset: string; quantity: string }
  | { side: "SELL"; asset: string; positionBps: number }
  | { side: "SELL"; category: string; positionBps: 10000 };

export interface TradePlanRequest {
  legs: TradePlanLeg[];
}

export interface TradePlanPreviewLeg {
  side: "BUY" | "SELL";
  assetId: string;
  ticker: string;
  name: string;
  quantity: string;
  usdUnitPrice: string;
  usdAmount: string;
  cashBefore: string;
  cashAfter: string;
  quantityBefore: string;
  quantityAfter: string;
  costBasisBefore: string;
  costBasisAfter: string;
  marketDate: string;
  requested: Record<string, string | number>;
}

export interface TradePlanPreview {
  cashBefore: string;
  cashAfter: string;
  legs: TradePlanPreviewLeg[];
  settlementLocked: false;
}

export interface PreparedTradePlan {
  planId: string;
  status: "PENDING";
  expiresAt: string;
  previewHash: string;
  confirmationMessage: string;
  preview: TradePlanPreview;
}

export interface TradePlanReceipt {
  planId: string;
  cashBefore: string;
  cashAfter: string;
  executedAt: string;
  legs: Array<TradePlanPreviewLeg & { transactionId: string }>;
}

const MAX_LEGS = 20;
const MONEY_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/;
const QUANTITY_PATTERN = /^[1-9]\d*$/;
const LEG_KEYS = new Set(["side", "asset", "category", "quantity", "cashAmount", "cashBps", "positionBps"]);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(code: string, message: string): never {
  throw new ApiError(422, code, message);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseLeg(value: unknown): TradePlanLeg {
  if (!record(value) || Object.keys(value).some((key) => !LEG_KEYS.has(key))) {
    return fail("INVALID_TRADE_PLAN", "Every trade leg must use only supported fields");
  }
  if (value.side !== "BUY" && value.side !== "SELL") {
    return fail("INVALID_TRADE_PLAN", "Every trade leg requires BUY or SELL");
  }

  const sizingKeys = ["quantity", "cashAmount", "cashBps", "positionBps"]
    .filter((key) => value[key] !== undefined);
  if (sizingKeys.length !== 1) {
    return fail("UNSUPPORTED_SIZING", "Every trade leg requires exactly one sizing field");
  }

  if (value.quantity !== undefined) {
    if (!nonEmptyString(value.asset) || typeof value.quantity !== "string" || !QUANTITY_PATTERN.test(value.quantity)) {
      return fail("INVALID_QUANTITY", "Quantity must be a positive integer");
    }
    return value.side === "BUY"
      ? { side: "BUY", asset: value.asset.trim(), quantity: value.quantity }
      : { side: "SELL", asset: value.asset.trim(), quantity: value.quantity };
  }

  if (value.cashAmount !== undefined) {
    if (value.side !== "BUY" || !nonEmptyString(value.asset)) {
      return fail("UNSUPPORTED_SIZING", "Cash amount is supported only for asset buys");
    }
    if (typeof value.cashAmount !== "string" || !MONEY_PATTERN.test(value.cashAmount)) {
      return fail("VALUE_OUT_OF_RANGE", "Cash amount must have at most eight decimal places");
    }
    if (/^0(?:\.0+)?$/.test(value.cashAmount)) {
      return fail("INVALID_QUANTITY", "Cash amount must be positive");
    }
    return { side: "BUY", asset: value.asset.trim(), cashAmount: value.cashAmount };
  }

  if (value.cashBps !== undefined) {
    if (value.side !== "BUY" || !nonEmptyString(value.asset)) {
      return fail("UNSUPPORTED_SIZING", "Cash percentage is supported only for asset buys");
    }
    if (!Number.isInteger(value.cashBps) || Number(value.cashBps) < 1 || Number(value.cashBps) > 10000) {
      return fail("INVALID_ALLOCATION", "Cash basis points must be between 1 and 10000");
    }
    return { side: "BUY", asset: value.asset.trim(), cashBps: Number(value.cashBps) };
  }

  if (!Number.isInteger(value.positionBps) || Number(value.positionBps) < 1 || Number(value.positionBps) > 10000) {
    return fail("INVALID_ALLOCATION", "Position basis points must be between 1 and 10000");
  }
  if (value.side !== "SELL") {
    return fail("UNSUPPORTED_SIZING", "Position percentage is supported only for sells");
  }
  if (nonEmptyString(value.category)) {
    if (value.positionBps !== 10000 || value.asset !== undefined) {
      return fail("UNSUPPORTED_SIZING", "Category sells must liquidate the full category");
    }
    return { side: "SELL", category: value.category.trim(), positionBps: 10000 };
  }
  if (!nonEmptyString(value.asset)) {
    return fail("MISSING_ASSET", "Asset is required");
  }
  return { side: "SELL", asset: value.asset.trim(), positionBps: Number(value.positionBps) };
}

export function parseTradePlanRequest(value: unknown): TradePlanRequest {
  if (!record(value) || Object.keys(value).some((key) => key !== "legs") || !Array.isArray(value.legs) || value.legs.length === 0) {
    return fail("INVALID_TRADE_PLAN", "A non-empty legs array is required");
  }
  if (value.legs.length > MAX_LEGS) {
    return fail("TOO_MANY_LEGS", `A trade plan supports at most ${MAX_LEGS} legs`);
  }
  const legs = value.legs.map(parseLeg);
  const allocatedCashBps = legs.reduce((sum, leg) => sum + ("cashBps" in leg ? leg.cashBps : 0), 0);
  if (allocatedCashBps > 10000) {
    return fail("INVALID_ALLOCATION", "Combined cash allocation cannot exceed 100 percent");
  }
  return { legs };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (record(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function canonicalTradePlanHash(preview: unknown): string {
  return createHash("sha256").update(canonicalJson(preview)).digest("hex");
}

export function buildTradePlanConfirmationMessage(input: {
  walletAddress: string;
  planId: string;
  previewHash: string;
  expiresAt: Date;
}): string {
  return [
    "Bankrupt Elon Musk — confirm simulated trade plan v1",
    `Wallet: ${input.walletAddress}`,
    `Plan: ${input.planId}`,
    `Preview SHA-256: ${input.previewHash}`,
    `Expires: ${input.expiresAt.toISOString()}`,
  ].join("\n");
}

type CatalogueAsset = {
  id: string;
  ticker: string;
  nameZh: string;
  nameEn: string | null;
  assetClass: string;
  subCategory: string | null;
  enabled: boolean;
  quote: {
    status: string;
    usdPrice: Prisma.Decimal;
    marketDate: Date;
  } | null;
};

type HeldPosition = {
  assetId: string;
  quantity: Prisma.Decimal;
  costBasis: Prisma.Decimal;
};

type ResolvedLeg =
  | { side: "BUY"; asset: CatalogueAsset; quantity: string }
  | { side: "BUY"; asset: CatalogueAsset; cashAmount: string }
  | { side: "BUY"; asset: CatalogueAsset; cashBps: number }
  | { side: "SELL"; asset: CatalogueAsset; quantity: string }
  | { side: "SELL"; asset: CatalogueAsset; positionBps: number };

const ZERO = new Prisma.Decimal(0);

function money(value: Prisma.Decimal): Prisma.Decimal {
  return value.toDecimalPlaces(8, Prisma.Decimal.ROUND_HALF_UP);
}

function normalized(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase().replace(/[\s_-]+/g, " ");
}

function categoryMatches(asset: CatalogueAsset, input: string): boolean {
  const query = normalized(input);
  const labels = [asset.assetClass, asset.subCategory].flatMap((value) => {
    if (!value) return [];
    const categoryLabel = CATEGORY_LABELS[value];
    const subCategoryLabel = SUBCATEGORY_LABELS[value];
    return [
      value,
      categoryLabel?.zh,
      categoryLabel?.en,
      subCategoryLabel?.zh,
      subCategoryLabel?.en,
    ].filter((label): label is string => Boolean(label));
  });
  return labels.some((label) => normalized(label) === query);
}

function resolveAsset(assets: CatalogueAsset[], input: string): CatalogueAsset {
  const query = normalized(input);
  const stages = [
    assets.filter((asset) => normalized(asset.id) === query),
    assets.filter((asset) => normalized(asset.ticker) === query),
    assets.filter((asset) => [asset.nameZh, asset.nameEn].some((name) => name && normalized(name) === query)),
  ];
  for (const matches of stages) {
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) fail("AMBIGUOUS_ASSET", `Asset '${input}' matches more than one catalogue entry`);
  }
  const partial = assets.filter((asset) => [asset.id, asset.ticker, asset.nameZh, asset.nameEn]
    .some((name) => name && normalized(name).includes(query)));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) fail("AMBIGUOUS_ASSET", `Asset '${input}' matches more than one catalogue entry`);
  return fail("MISSING_ASSET", `Asset '${input}' was not found`);
}

function assertQuote(asset: CatalogueAsset, now: Date) {
  if (!asset.enabled) fail("ASSET_DISABLED", `${asset.ticker} is disabled`);
  if (!asset.quote) fail("QUOTE_MISSING", `${asset.ticker} has no quote`);
  if (asset.quote.status !== "ACTIVE" || !isQuoteFresh(asset.quote.marketDate, now)) {
    fail("QUOTE_STALE", `${asset.ticker} quote is stale`);
  }
  if (!asset.quote.usdPrice.gt(0)) fail("QUOTE_MISSING", `${asset.ticker} has no valid price`);
  return asset.quote;
}

function requestedSizing(leg: TradePlanLeg | ResolvedLeg): Record<string, string | number> {
  if ("quantity" in leg) return { quantity: leg.quantity };
  if ("cashAmount" in leg) return { cashAmount: leg.cashAmount };
  if ("cashBps" in leg) return { cashBps: leg.cashBps };
  return { positionBps: leg.positionBps };
}

function resolveLegs(
  request: TradePlanRequest,
  assets: CatalogueAsset[],
  positions: Map<string, HeldPosition>,
): ResolvedLeg[] {
  const resolved: ResolvedLeg[] = [];
  for (const leg of request.legs) {
    if ("category" in leg) {
      const matches = assets.filter((asset) => (
        categoryMatches(asset, leg.category)
      ) && (positions.get(asset.id)?.quantity.gt(0) ?? false));
      if (matches.length === 0) fail("INSUFFICIENT_HOLDINGS", `No held positions match category '${leg.category}'`);
      for (const asset of matches) resolved.push({ side: "SELL", asset, positionBps: 10000 });
      continue;
    }
    const asset = resolveAsset(assets, leg.asset);
    if ("quantity" in leg) resolved.push({ side: leg.side, asset, quantity: leg.quantity } as ResolvedLeg);
    else if ("cashAmount" in leg) resolved.push({ side: "BUY", asset, cashAmount: leg.cashAmount });
    else if ("cashBps" in leg) resolved.push({ side: "BUY", asset, cashBps: leg.cashBps });
    else resolved.push({ side: "SELL", asset, positionBps: leg.positionBps });
  }
  if (resolved.length > MAX_LEGS) fail("TOO_MANY_LEGS", `A trade plan supports at most ${MAX_LEGS} expanded legs`);
  const ids = resolved.map((leg) => leg.asset.id);
  if (new Set(ids).size !== ids.length) fail("DUPLICATE_ASSET", "A trade plan cannot contain the same asset twice");
  return resolved;
}

function requestedQuantity(
  leg: ResolvedLeg,
  price: Prisma.Decimal,
  cashBefore: Prisma.Decimal,
  position: HeldPosition | undefined,
): Prisma.Decimal {
  if ("quantity" in leg) return new Prisma.Decimal(leg.quantity);
  if ("cashAmount" in leg) return new Prisma.Decimal(leg.cashAmount).div(price).floor();
  if ("cashBps" in leg) return cashBefore.mul(leg.cashBps).div(10000).div(price).floor();
  return (position?.quantity ?? ZERO).mul(leg.positionBps).div(10000).floor();
}

export async function prepareTradePlan(
  walletAddress: string,
  value: unknown,
  dependencies: { randomUUID?: () => string } = {},
): Promise<PreparedTradePlan> {
  const request = parseTradePlanRequest(value);
  const now = new Date();
  if (isSettlementLocked(now)) fail("SETTLEMENT_LOCKED", "Trading is locked during settlement");
  const planId = dependencies.randomUUID?.() ?? randomUUID();
  const expiresAt = new Date(now.getTime() + 5 * 60 * 1000);

  return prisma.$transaction(async (tx) => {
    const [player, assets, held] = await Promise.all([
      tx.player.findUnique({ where: { walletAddress } }),
      tx.asset.findMany({ include: { quote: true }, orderBy: { displayOrder: "asc" } }),
      tx.position.findMany({ where: { walletAddress } }),
    ]);
    if (!player) fail("PLAYER_NOT_FOUND", "Player not found");
    const catalogue = assets as CatalogueAsset[];
    const positions = new Map((held as HeldPosition[]).map((position) => [position.assetId, position]));
    const resolved = resolveLegs(request, catalogue, positions);
    const cashBefore = player.cash;
    let cashAfter = cashBefore;
    const previewLegs: TradePlanPreviewLeg[] = [];

    for (const leg of resolved) {
      const quote = assertQuote(leg.asset, now);
      const before = positions.get(leg.asset.id) ?? { assetId: leg.asset.id, quantity: ZERO, costBasis: ZERO };
      const quantity = requestedQuantity(leg, quote.usdPrice, cashBefore, before);
      if (!quantity.gt(0) || !quantity.isInteger()) fail("INVALID_QUANTITY", `${leg.asset.ticker} resolves to zero quantity`);
      const amount = money(quote.usdPrice.mul(quantity));
      if (!amount.gt(0)) fail("MINIMUM_NOTIONAL", `${leg.asset.ticker} amount is below minimum notional`);

      let quantityAfter: Prisma.Decimal;
      let costBasisAfter: Prisma.Decimal;
      const legCashBefore = cashAfter;
      if (leg.side === "BUY") {
        if (amount.gt(cashAfter)) fail("INSUFFICIENT_CASH", "The complete plan exceeds available cash");
        cashAfter = money(cashAfter.sub(amount));
        quantityAfter = before.quantity.add(quantity);
        costBasisAfter = money(before.costBasis.add(amount));
      } else {
        if (quantity.gt(before.quantity)) fail("INSUFFICIENT_HOLDINGS", `Insufficient ${leg.asset.ticker} holdings`);
        cashAfter = money(cashAfter.add(amount));
        quantityAfter = before.quantity.sub(quantity);
        costBasisAfter = quantityAfter.isZero()
          ? ZERO
          : money(before.costBasis.mul(quantityAfter).div(before.quantity));
      }

      previewLegs.push({
        side: leg.side,
        assetId: leg.asset.id,
        ticker: leg.asset.ticker,
        name: leg.asset.nameZh,
        quantity: decimalToString(quantity),
        usdUnitPrice: decimalToString(quote.usdPrice),
        usdAmount: decimalToString(amount),
        cashBefore: decimalToString(legCashBefore),
        cashAfter: decimalToString(cashAfter),
        quantityBefore: decimalToString(before.quantity),
        quantityAfter: decimalToString(quantityAfter),
        costBasisBefore: decimalToString(before.costBasis),
        costBasisAfter: decimalToString(costBasisAfter),
        marketDate: quote.marketDate.toISOString(),
        requested: requestedSizing(leg),
      });
    }

    const preview: TradePlanPreview = {
      cashBefore: decimalToString(cashBefore),
      cashAfter: decimalToString(cashAfter),
      legs: previewLegs,
      settlementLocked: false,
    };
    const previewHash = canonicalTradePlanHash(preview);
    const confirmationMessage = buildTradePlanConfirmationMessage({
      walletAddress,
      planId,
      previewHash,
      expiresAt,
    });
    await tx.tradePlan.create({
      data: {
        id: planId,
        walletAddress,
        request: request as unknown as Prisma.InputJsonValue,
        preview: preview as unknown as Prisma.InputJsonValue,
        previewHash,
        confirmationMessage,
        status: "PENDING",
        expiresAt,
      },
    });
    return {
      planId,
      status: "PENDING",
      expiresAt: expiresAt.toISOString(),
      previewHash,
      confirmationMessage,
      preview,
    };
  }, { isolationLevel: "Serializable" });
}

function storedPreview(value: unknown): TradePlanPreview {
  if (!record(value) || typeof value.cashBefore !== "string" || typeof value.cashAfter !== "string" || !Array.isArray(value.legs)) {
    throw new ApiError(500, "INVALID_TRADE_PLAN_SNAPSHOT", "Stored trade plan preview is invalid");
  }
  const legs = value.legs.map((leg) => {
    if (!record(leg)
      || (leg.side !== "BUY" && leg.side !== "SELL")
      || !["assetId", "ticker", "name", "quantity", "usdUnitPrice", "usdAmount", "cashBefore", "cashAfter", "quantityBefore", "quantityAfter", "costBasisBefore", "costBasisAfter", "marketDate"]
        .every((key) => typeof leg[key] === "string")
      || !record(leg.requested)) {
      throw new ApiError(500, "INVALID_TRADE_PLAN_SNAPSHOT", "Stored trade plan leg is invalid");
    }
    return leg as unknown as TradePlanPreviewLeg;
  });
  return {
    cashBefore: value.cashBefore,
    cashAfter: value.cashAfter,
    settlementLocked: false,
    legs,
  };
}

function storedReceipt(value: unknown): TradePlanReceipt {
  if (!record(value) || typeof value.planId !== "string" || typeof value.cashBefore !== "string"
    || typeof value.cashAfter !== "string" || typeof value.executedAt !== "string" || !Array.isArray(value.legs)) {
    throw new ApiError(500, "INVALID_TRADE_PLAN_RECEIPT", "Stored trade plan receipt is invalid");
  }
  return value as unknown as TradePlanReceipt;
}

function equalDecimal(left: Prisma.Decimal, right: string): boolean {
  try {
    return left.equals(new Prisma.Decimal(right));
  } catch {
    return false;
  }
}

function serializationConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2034";
}

export async function executeTradePlan(
  walletAddress: string,
  planId: string,
  signature: string,
): Promise<TradePlanReceipt> {
  if (typeof signature !== "string" || !/^0x[0-9a-f]+$/i.test(signature)) {
    fail("INVALID_SIGNATURE", "A plan confirmation signature is required");
  }
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const plan = await tx.tradePlan.findUnique({ where: { id: planId } });
        if (!plan || plan.walletAddress.toLowerCase() !== walletAddress.toLowerCase()) {
          throw new ApiError(404, "PLAN_NOT_FOUND", "Trade plan was not found");
        }
        const validSignature = await verifyMessage({
          address: walletAddress as Hex,
          message: plan.confirmationMessage,
          signature: signature as Hex,
        }).catch(() => false);
        if (!validSignature) fail("INVALID_SIGNATURE", "Trade plan confirmation signature is invalid");
        if (plan.status === "EXECUTED") return storedReceipt(plan.receipt);
        if (plan.status === "CANCELLED") fail("PLAN_CANCELLED", "Trade plan was cancelled");
        const now = new Date();
        if (plan.status === "EXPIRED" || plan.expiresAt.getTime() <= now.getTime()) {
          if (plan.status === "PENDING") {
            await tx.tradePlan.update({ where: { id: plan.id }, data: { status: "EXPIRED" } });
          }
          fail("PLAN_EXPIRED", "Trade plan expired");
        }
        if (plan.status !== "PENDING") fail("PLAN_STALE", "Trade plan is not pending");
        if (isSettlementLocked(now)) fail("SETTLEMENT_LOCKED", "Trading is locked during settlement");

        const preview = storedPreview(plan.preview);
        if (canonicalTradePlanHash(preview) !== plan.previewHash) {
          throw new ApiError(500, "INVALID_TRADE_PLAN_SNAPSHOT", "Trade plan preview hash mismatch");
        }
        const assetIds = preview.legs.map((leg) => leg.assetId);
        const [player, assets, held] = await Promise.all([
          tx.player.findUnique({ where: { walletAddress } }),
          tx.asset.findMany({ where: { id: { in: assetIds } }, include: { quote: true } }),
          tx.position.findMany({ where: { walletAddress, assetId: { in: assetIds } } }),
        ]);
        if (!player) throw new ApiError(404, "PLAYER_NOT_FOUND", "Player not found");
        if (!equalDecimal(player.cash, preview.cashBefore)) fail("PLAN_STALE", "Cash changed after preview");
        const assetsById = new Map((assets as CatalogueAsset[]).map((asset) => [asset.id, asset]));
        const positionsById = new Map((held as HeldPosition[]).map((position) => [position.assetId, position]));

        for (const leg of preview.legs) {
          const asset = assetsById.get(leg.assetId);
          if (!asset) fail("PLAN_STALE", `${leg.ticker} is no longer in the catalogue`);
          const quote = assertQuote(asset, now);
          if (!equalDecimal(quote.usdPrice, leg.usdUnitPrice) || quote.marketDate.toISOString() !== leg.marketDate) {
            fail("PLAN_STALE", `${leg.ticker} quote changed after preview`);
          }
          const position = positionsById.get(leg.assetId);
          if (!equalDecimal(position?.quantity ?? ZERO, leg.quantityBefore)
            || !equalDecimal(position?.costBasis ?? ZERO, leg.costBasisBefore)) {
            fail("PLAN_STALE", `${leg.ticker} position changed after preview`);
          }
        }

        const receiptLegs: TradePlanReceipt["legs"] = [];
        for (let index = 0; index < preview.legs.length; index += 1) {
          const leg = preview.legs[index];
          const asset = assetsById.get(leg.assetId)!;
          const quote = asset.quote!;
          const quantityAfter = new Prisma.Decimal(leg.quantityAfter);
          const costBasisAfter = new Prisma.Decimal(leg.costBasisAfter);
          if (leg.side === "BUY") {
            await tx.position.upsert({
              where: { walletAddress_assetId: { walletAddress, assetId: leg.assetId } },
              create: { walletAddress, assetId: leg.assetId, quantity: quantityAfter, costBasis: costBasisAfter },
              update: { quantity: quantityAfter, costBasis: costBasisAfter },
            });
          } else if (quantityAfter.isZero()) {
            await tx.position.delete({ where: { walletAddress_assetId: { walletAddress, assetId: leg.assetId } } });
          } else {
            await tx.position.update({
              where: { walletAddress_assetId: { walletAddress, assetId: leg.assetId } },
              data: { quantity: quantityAfter, costBasis: costBasisAfter },
            });
          }
          const ledger = await tx.transaction.create({ data: {
            walletAddress,
            idempotencyKey: `${plan.id}:${index}`,
            type: leg.side,
            assetId: leg.assetId,
            commandSnapshot: Prisma.DbNull,
            resultSnapshot: Prisma.DbNull,
            requestedQuantity: JSON.stringify(leg.requested),
            requestFingerprint: createHash("sha256").update(`${plan.previewHash}:${index}`).digest("hex"),
            quantity: new Prisma.Decimal(leg.quantity),
            nativePrice: "nativePrice" in quote && quote.nativePrice instanceof Prisma.Decimal ? quote.nativePrice : quote.usdPrice,
            currency: "currency" in quote && typeof quote.currency === "string" ? quote.currency : "USD",
            fxRateToUsd: "fxRateToUsd" in quote && quote.fxRateToUsd instanceof Prisma.Decimal ? quote.fxRateToUsd : new Prisma.Decimal(1),
            usdUnitPrice: new Prisma.Decimal(leg.usdUnitPrice),
            usdAmount: new Prisma.Decimal(leg.usdAmount),
            cashBefore: new Prisma.Decimal(leg.cashBefore),
            cashAfter: new Prisma.Decimal(leg.cashAfter),
            quantityBefore: new Prisma.Decimal(leg.quantityBefore),
            quantityAfter,
            costBasisBefore: new Prisma.Decimal(leg.costBasisBefore),
            costBasisAfter,
            marketDate: new Date(leg.marketDate),
          } });
          receiptLegs.push({ ...leg, transactionId: ledger.id.toString() });
        }
        await tx.player.update({ where: { walletAddress }, data: { cash: new Prisma.Decimal(preview.cashAfter) } });
        const receipt: TradePlanReceipt = {
          planId: plan.id,
          cashBefore: preview.cashBefore,
          cashAfter: preview.cashAfter,
          executedAt: now.toISOString(),
          legs: receiptLegs,
        };
        await tx.tradePlan.update({
          where: { id: plan.id },
          data: {
            status: "EXECUTED",
            executedAt: now,
            receipt: receipt as unknown as Prisma.InputJsonValue,
          },
        });
        return receipt;
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (!serializationConflict(error) || attempt === 3) {
        if (serializationConflict(error)) throw new ApiError(409, "TRADE_CONFLICT", "Trade plan conflicted with another request");
        throw error;
      }
    }
  }
  throw new ApiError(409, "TRADE_CONFLICT", "Trade plan conflict");
}

export async function cancelTradePlan(walletAddress: string, planId: string): Promise<{ planId: string; status: "CANCELLED" }> {
  return prisma.$transaction(async (tx) => {
    const plan = await tx.tradePlan.findUnique({ where: { id: planId } });
    if (!plan || plan.walletAddress.toLowerCase() !== walletAddress.toLowerCase()) {
      throw new ApiError(404, "PLAN_NOT_FOUND", "Trade plan was not found");
    }
    if (plan.status === "EXECUTED") fail("PLAN_EXECUTED", "Executed trade plans cannot be cancelled");
    if (plan.status === "PENDING") {
      await tx.tradePlan.update({
        where: { id: plan.id },
        data: { status: "CANCELLED", cancelledAt: new Date() },
      });
    }
    return { planId: plan.id, status: "CANCELLED" };
  }, { isolationLevel: "Serializable" });
}
