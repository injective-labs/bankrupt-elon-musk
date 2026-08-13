import type { InjPassMiniAppSession } from "@injpass/cli";

import { GameApiError } from "@/client/gameApi";
import type { AssetView } from "@/types";
import type { ElonAgentApi } from "./api";
import { resolveElonAsset } from "./assets";
import type { ElonAgentCommand, ElonAgentResult } from "./protocol";

const ERROR_KEYS: Record<string, string> = {
  INSUFFICIENT_CASH: "insufficient_cash",
  INSUFFICIENT_HOLDINGS: "insufficient_position",
  SETTLEMENT_LOCKED: "market_locked",
  QUOTE_MISSING: "quote_missing",
  QUOTE_STALE: "quote_stale",
  ASSET_DISABLED: "asset_disabled",
  UNAUTHORIZED: "session_expired",
};

interface ExecuteDependencies {
  api: ElonAgentApi;
  session: InjPassMiniAppSession | null;
  randomUUID?: () => string;
  signal?: AbortSignal;
}

function hasAuthenticatedSession(session: InjPassMiniAppSession | null): session is InjPassMiniAppSession & { authenticated: true; address: string } {
  return session?.authenticated === true && typeof session.address === "string" && session.address.length > 0;
}

function assetData(asset: AssetView): Record<string, unknown> {
  return {
    id: asset.id,
    ticker: asset.ticker,
    name: asset.name,
    nameEn: asset.nameEn ?? null,
    category: asset.category,
    usdPrice: asset.usdPrice,
    quoteStatus: asset.quoteStatus,
    marketDate: asset.marketDate,
  };
}

function normalized(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function assertActive(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("The host session changed", "AbortError");
}

function createIdempotencyKey(randomUUID?: () => string): string {
  return randomUUID ? randomUUID() : crypto.randomUUID();
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export async function executeElonAgentCommand(
  command: ElonAgentCommand,
  dependencies: ExecuteDependencies,
): Promise<ElonAgentResult> {
  const { api, session, signal } = dependencies;
  try {
    if (command.action === "open") return { ok: true, key: "app_ready" };

    assertActive(signal);
    if (command.action === "market") {
      const market = await api.getMarket(signal);
      const query = normalized(command.params.query ?? "");
      const assets = market.assets
        .filter((asset) => !query || [asset.id, asset.ticker, asset.name, asset.nameEn, asset.category]
          .some((value) => value && normalized(value).includes(query)))
        .slice(0, 10)
        .map(assetData);
      return { ok: true, key: "game_market", data: { assets } };
    }

    if (!hasAuthenticatedSession(session)) return { ok: false, key: "login_required" };

    if (command.action === "balance") {
      const account = await api.getGame(session, signal);
      return {
        ok: true,
        key: "game_balance",
        data: {
          cash: account.cash,
          holdingsValue: account.holdingsValue,
          netWorth: account.netWorth,
          pnl: account.pnl,
        },
      };
    }

    if (command.action === "portfolio") {
      const account = await api.getGame(session, signal);
      const assets = new Map(account.assets.map((asset) => [asset.id, asset]));
      const positions = account.positions.map((position) => {
        const asset = assets.get(position.assetId);
        return {
          assetId: position.assetId,
          symbol: asset?.ticker ?? position.assetId,
          name: asset?.name ?? position.assetId,
          quantity: position.quantity,
          value: position.marketValue,
          costBasis: position.costBasis,
          unrealizedPnl: position.unrealizedPnl,
        };
      });
      return { ok: true, key: "game_portfolio", data: { positions } };
    }

    if (command.action === "history") {
      const limit = Math.max(1, Math.min(Math.trunc(command.params.limit ?? 20), 100));
      const page = await api.getTransactions(session, undefined, limit, signal);
      return {
        ok: true,
        key: "game_history",
        data: { transactions: page.rows.slice(0, 100), nextCursor: page.nextCursor },
      };
    }

    if (command.action === "rank") {
      const leaderboard = await api.getLeaderboard(session, signal);
      return {
        ok: true,
        key: "game_rank",
        data: {
          rank: leaderboard.you?.rank ?? null,
          total: leaderboard.you?.total ?? leaderboard.total,
          pnl: leaderboard.you?.pnl ?? null,
          top: leaderboard.top.slice(0, 10),
        },
      };
    }

    if (command.action === "prepare_trade") {
      if (!command.params.legs?.length) return { ok: false, key: "invalid_trade_plan" };
      const plan = await api.prepareTradePlan(session, { legs: command.params.legs }, signal);
      return { ok: true, key: "game_trade_preview", data: plan as unknown as Record<string, unknown> };
    }

    if (command.action === "execute_trade_plan") {
      if (!command.params.planId || !command.params.confirmationMessage) return { ok: false, key: "invalid_trade_plan" };
      const receipt = await api.executeTradePlan(session, command.params.planId, command.params.confirmationMessage, signal);
      return { ok: true, key: "game_trade_plan", data: receipt as unknown as Record<string, unknown> };
    }

    if (command.action === "cancel_trade_plan") {
      if (!command.params.planId) return { ok: false, key: "invalid_trade_plan" };
      const cancelled = await api.cancelTradePlan(session, command.params.planId, signal);
      return { ok: true, key: "game_trade_cancelled", data: cancelled as unknown as Record<string, unknown> };
    }

    if (command.action === "buy" || command.action === "sell") {
      if (!command.params.asset?.trim()) return { ok: false, key: "missing_asset" };
      if (!command.params.quantity) return { ok: false, key: "missing_quantity" };

      const market = await api.getMarket(signal);
      const resolution = resolveElonAsset(market.assets, command.params.asset);
      if (resolution.kind === "missing") return { ok: false, key: "product_not_found" };
      if (resolution.kind === "ambiguous") {
        return {
          ok: false,
          key: "ambiguous_asset",
          data: { candidates: resolution.candidates.slice(0, 10).map(assetData) },
        };
      }

      assertActive(signal);
      const idempotencyKey = createIdempotencyKey(dependencies.randomUUID);
      const receipt = await api.submitTrade(session, {
        assetId: resolution.asset.id,
        side: command.action === "buy" ? "BUY" : "SELL",
        quantity: command.params.quantity,
        idempotencyKey,
      }, signal);
      return {
        ok: true,
        key: "game_trade",
        data: {
          side: command.action,
          product: resolution.asset.ticker || resolution.asset.name,
          assetId: resolution.asset.id,
          assetName: resolution.asset.name,
          requestedQuantity: receipt.requestedQuantity,
          quantity: receipt.quantity,
          usdUnitPrice: receipt.usdUnitPrice,
          usdAmount: receipt.usdAmount,
          cash: receipt.cashAfter,
          positionQuantity: receipt.quantityAfter,
          transactionId: receipt.id,
          createdAt: receipt.createdAt,
        },
      };
    }

    return { ok: false, key: "unsupported_action" };
  } catch (error) {
    if (isAbortError(error)) return { ok: false, key: "session_expired" };
    if (error instanceof GameApiError) {
      return { ok: false, key: ERROR_KEYS[error.code] ?? "unknown_error" };
    }
    return { ok: false, key: "unknown_error" };
  }
}
