import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GameApiError } from "@/client/gameApi";
import type { AssetView } from "@/types";
import { executeElonAgentCommand } from "./execute";
import type { ElonAgentCommand } from "./protocol";

const walletSession = {
  authenticated: true,
  address: "0x0000000000000000000000000000000000000001",
  walletName: "alice.inj",
  chainId: 1,
};
const asset: AssetView = {
  id: "tesla-stock", ticker: "TSLA", name: "特斯拉股票", nameEn: "Tesla Stock",
  category: "美股", currency: "USD", unit: "股", enabled: true, displayOrder: 1,
  usdPrice: "250", marketDate: "2026-08-12T00:00:00.000Z", quoteStatus: "ACTIVE",
};
const account = {
  walletAddress: walletSession.address, walletName: "alice.inj", cash: "750",
  holdingsValue: "250", netWorth: "1000", pnl: "-49999999000",
  positions: [{ assetId: asset.id, quantity: "1", costBasis: "250", marketValue: "250", unrealizedPnl: "0" }],
  assets: [asset], recentTransactions: [], marketAsOf: asset.marketDate,
  settlementLocked: false, resetEnabled: false, updatedAt: "2026-08-12T00:00:00.000Z",
};
const command = (action: ElonAgentCommand["action"], params: ElonAgentCommand["params"] = {}): ElonAgentCommand => ({
  appId: "bankrupt-elon-musk", action, rawText: "", language: "en", params,
});

describe("executeElonAgentCommand", () => {
  const api = {
    getMarket: vi.fn(),
    getGame: vi.fn(),
    getTransactions: vi.fn(),
    getLeaderboard: vi.fn(),
    submitTrade: vi.fn(),
    clearAgentSession: vi.fn(),
  };

  beforeEach(() => {
    vi.resetAllMocks();
    api.getMarket.mockResolvedValue({ assets: [asset], marketAsOf: asset.marketDate });
    api.getGame.mockResolvedValue(account);
    api.getTransactions.mockResolvedValue({ rows: [], nextCursor: null });
    api.getLeaderboard.mockResolvedValue({ top: [], total: 1, you: { rank: 1, total: 1, pnl: account.pnl } });
    api.submitTrade.mockResolvedValue({
      id: "transaction-1", idempotencyKey: "generated-uuid", side: "BUY", assetId: asset.id,
      requestedQuantity: "2", quantity: "2", usdUnitPrice: "250", usdAmount: "500",
      cashBefore: "1250", cashAfter: "750", quantityBefore: "0", quantityAfter: "2",
      costBasisBefore: "0", costBasisAfter: "500", marketDate: asset.marketDate,
      createdAt: "2026-08-12T01:00:00.000Z",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("answers the host open handshake without requiring a wallet", async () => {
    await expect(executeElonAgentCommand(command("open"), { api, session: null }))
      .resolves.toEqual({ ok: true, key: "app_ready" });
  });

  it("returns bounded public market matches without requiring a session", async () => {
    const result = await executeElonAgentCommand(command("market", { query: "tesla" }), {
      api, session: null,
    });
    expect(result).toEqual({ ok: true, key: "game_market", data: { assets: [expect.objectContaining({ id: asset.id, ticker: "TSLA" })] } });
  });

  it("returns account balance fields from the authoritative account projection", async () => {
    await expect(executeElonAgentCommand(command("balance"), { api, session: walletSession }))
      .resolves.toEqual({
        ok: true,
        key: "game_balance",
        data: { cash: "750", holdingsValue: "250", netWorth: "1000", pnl: "-49999999000" },
      });
  });

  it("joins portfolio positions to authoritative asset display data", async () => {
    const result = await executeElonAgentCommand(command("portfolio"), { api, session: walletSession });
    expect(result).toEqual({
      ok: true,
      key: "game_portfolio",
      data: { positions: [{
        assetId: asset.id, symbol: "TSLA", name: asset.name, quantity: "1", value: "250",
        costBasis: "250", unrealizedPnl: "0",
      }] },
    });
  });

  it("clamps history limits to 1 through 100", async () => {
    await executeElonAgentCommand(command("history", { limit: 900 }), { api, session: walletSession });
    expect(api.getTransactions).toHaveBeenCalledWith(walletSession, undefined, 100, undefined);
  });

  it("returns current rank and public top entries", async () => {
    const result = await executeElonAgentCommand(command("rank"), { api, session: walletSession });
    expect(result).toMatchObject({
      ok: true,
      key: "game_rank",
      data: { rank: 1, total: 1, pnl: account.pnl, top: [] },
    });
  });

  it.each([
    ["buy", "BUY", "2"],
    ["sell", "SELL", "MAX"],
  ] as const)("executes an explicit %s with one generated idempotency key", async (action, side, quantity) => {
    api.submitTrade.mockResolvedValueOnce({
      ...await api.submitTrade(),
      side,
      requestedQuantity: quantity,
      quantity: quantity === "MAX" ? "1" : quantity,
    });
    api.submitTrade.mockClear();
    const randomUUID = vi.fn().mockReturnValue("00000000-0000-4000-8000-000000000001");

    const result = await executeElonAgentCommand(command(action, { asset: "TSLA", quantity }), {
      api, session: walletSession, randomUUID,
    });

    expect(randomUUID).toHaveBeenCalledTimes(1);
    expect(api.submitTrade).toHaveBeenCalledWith(walletSession, {
      assetId: asset.id,
      side,
      quantity,
      idempotencyKey: "00000000-0000-4000-8000-000000000001",
    }, undefined);
    expect(result).toMatchObject({
      ok: true,
      key: "game_trade",
      data: {
        side: action,
        product: "TSLA",
        assetId: asset.id,
        requestedQuantity: quantity,
        transactionId: "transaction-1",
        cash: "750",
        positionQuantity: quantity === "MAX" ? "2" : "2",
      },
    });
    expect(api.getGame).not.toHaveBeenCalled();
  });

  it("uses the browser crypto receiver when generating a default trade id", async () => {
    const browserCrypto = {
      randomUUID(this: unknown) {
        if (this !== browserCrypto) throw new TypeError("Illegal invocation");
        return "00000000-0000-4000-8000-000000000009";
      },
    };
    vi.stubGlobal("crypto", browserCrypto);

    const result = await executeElonAgentCommand(
      command("buy", { asset: "TSLA", quantity: "1" }),
      { api, session: walletSession },
    );

    expect(result).toMatchObject({ ok: true, key: "game_trade" });
    expect(api.submitTrade).toHaveBeenCalledWith(walletSession, {
      assetId: asset.id,
      side: "BUY",
      quantity: "1",
      idempotencyKey: "00000000-0000-4000-8000-000000000009",
    }, undefined);
  });

  it.each([
    ["tsla", "tesla-basket", "1"],
    ["NVDA", "nvidia-basket", "2"],
    ["btc", "bitcoin-coin", "MAX"],
    ["doge", "dogecoin-pack", "MAX"],
  ] as const)("buys %s through the generic catalogue path", async (input, assetId, quantity) => {
    const assets = [
      { ...asset, id: "tesla-basket", ticker: "TSLA" },
      { ...asset, id: "nvidia-basket", ticker: "NVDA" },
      { ...asset, id: "bitcoin-coin", ticker: "BTC" },
      { ...asset, id: "dogecoin-pack", ticker: "DOGE" },
    ];
    api.getMarket.mockResolvedValueOnce({ assets, marketAsOf: asset.marketDate });

    await executeElonAgentCommand(
      command("buy", { asset: input, quantity }),
      {
        api,
        session: walletSession,
        randomUUID: () => "00000000-0000-4000-8000-000000000010",
      },
    );

    expect(api.submitTrade).toHaveBeenCalledWith(walletSession, {
      assetId,
      side: "BUY",
      quantity,
      idempotencyKey: "00000000-0000-4000-8000-000000000010",
    }, undefined);
  });

  it("keeps a successful trade successful when the account projection is unavailable", async () => {
    api.getGame.mockRejectedValueOnce(new Error("projection unavailable"));
    const result = await executeElonAgentCommand(
      command("buy", { asset: "TSLA", quantity: "2" }),
      { api, session: walletSession, randomUUID: () => "trade-idempotency-key" },
    );

    expect(result).toMatchObject({
      ok: true,
      key: "game_trade",
      data: {
        usdUnitPrice: "250",
        usdAmount: "500",
        cash: "750",
        positionQuantity: "2",
        transactionId: "transaction-1",
      },
    });
    expect(api.getGame).not.toHaveBeenCalled();
  });

  it("does not submit a trade after its host session is aborted", async () => {
    const controller = new AbortController();
    api.getMarket.mockImplementationOnce(async () => {
      controller.abort();
      return { assets: [asset], marketAsOf: asset.marketDate };
    });

    await expect(executeElonAgentCommand(
      command("buy", { asset: "TSLA", quantity: "2" }),
      { api, session: walletSession, signal: controller.signal },
    )).resolves.toEqual({ ok: false, key: "session_expired" });
    expect(api.submitTrade).not.toHaveBeenCalled();
  });

  it.each([
    [{ asset: undefined, quantity: "1" }, "missing_asset"],
    [{ asset: "TSLA", quantity: undefined }, "missing_quantity"],
  ])("never trades with incomplete input %#", async (params, key) => {
    await expect(executeElonAgentCommand(command("buy", params), { api, session: walletSession }))
      .resolves.toEqual({ ok: false, key });
    expect(api.submitTrade).not.toHaveBeenCalled();
  });

  it("returns clarification candidates for an ambiguous asset and does not trade", async () => {
    const second = { ...asset, id: "tesla-bond", ticker: "TSLB", name: "特斯拉债券", nameEn: "Tesla Bond" };
    api.getMarket.mockResolvedValueOnce({ assets: [asset, second], marketAsOf: asset.marketDate });
    const result = await executeElonAgentCommand(command("sell", { asset: "特斯拉", quantity: "1" }), {
      api, session: walletSession,
    });
    expect(result).toMatchObject({ ok: false, key: "ambiguous_asset", data: { candidates: [{ id: asset.id }, { id: second.id }] } });
    expect(api.submitTrade).not.toHaveBeenCalled();
  });

  it("requires an authenticated host session for private actions", async () => {
    await expect(executeElonAgentCommand(command("balance"), { api, session: null }))
      .resolves.toEqual({ ok: false, key: "login_required" });
  });

  it.each([
    ["INSUFFICIENT_CASH", "insufficient_cash"],
    ["INSUFFICIENT_HOLDINGS", "insufficient_position"],
    ["SETTLEMENT_LOCKED", "market_locked"],
    ["QUOTE_MISSING", "quote_missing"],
    ["QUOTE_STALE", "quote_stale"],
    ["ASSET_DISABLED", "asset_disabled"],
    ["UNAUTHORIZED", "session_expired"],
  ])("maps server error %s to %s", async (code, key) => {
    api.getGame.mockRejectedValueOnce(new GameApiError(400, code, "server detail"));
    await expect(executeElonAgentCommand(command("balance"), { api, session: walletSession }))
      .resolves.toEqual({ ok: false, key });
  });

  it("does not expose unknown internal errors", async () => {
    api.getGame.mockRejectedValueOnce(new Error("database password is secret"));
    const result = await executeElonAgentCommand(command("balance"), { api, session: walletSession });
    expect(result).toEqual({ ok: false, key: "unknown_error" });
    expect(JSON.stringify(result)).not.toContain("database password");
  });
});
