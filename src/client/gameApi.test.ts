import { afterEach, describe, expect, it, vi } from "vitest";
import { getGame, getLeaderboard, getMarket, getSession, getTransactions, loginWithSignature, logout } from "./gameApi";

const json = (body: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("gameApi", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("signs the exact nonce message and verifies its hexadecimal bytes with same-origin cookies", async () => {
    const message = "line one\n空 格\nline three";
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ nonce: "n", message })).mockResolvedValueOnce(json({ walletAddress: "0x1", walletName: null }));
    vi.stubGlobal("fetch", fetchMock);
    const signer = vi.fn().mockResolvedValue(new Uint8Array([0, 15, 255]));
    await loginWithSignature("0x1", null, signer);
    expect(signer).toHaveBeenCalledWith(message);
    expect(fetchMock.mock.calls.every(([, init]) => init.credentials === "same-origin")).toBe(true);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ address: "0x1", walletName: null, signature: "0x000fff" });
  });

  it.each([
    [{ error: { code: "TRADE_REJECTED", message: "No" } }, "TRADE_REJECTED", "No"],
    [{ error: "Bad address" }, "HTTP_400", "Bad address"],
  ])("parses structured and string error bodies", async (body, code, message) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(body, 400)));
    await expect(getGame()).rejects.toEqual(expect.objectContaining({ status: 400, code, message }));
  });

  it("rejects malformed or empty successful session and account payloads", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json({ walletName: null })).mockResolvedValueOnce(json(null, 204)));
    await expect(getSession()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(getGame()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("accepts empty logout success but rejects unexpected logout, transaction, and leaderboard payloads", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json(null, 204)).mockResolvedValueOnce(json({ ok: false })).mockResolvedValueOnce(json({ rows: "bad", nextCursor: null })).mockResolvedValueOnce(json({ top: [], total: "bad" })));
    await expect(logout()).resolves.toBeUndefined();
    await expect(logout()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(getTransactions()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(getLeaderboard()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("validates exact decimal strings in the public market response", async () => {
    const market = {
      assets: [{
        id: "asset", name: "资产", category: "美股", ticker: "AST",
        currency: "USD", unit: "股", enabled: true, displayOrder: 1,
        usdPrice: "12.25", marketDate: "2026-07-20T00:00:00.000Z", quoteStatus: "ACTIVE",
      }],
      marketAsOf: "2026-07-20T00:00:00.000Z",
    };
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(json(market))
      .mockResolvedValueOnce(json({ ...market, assets: [{ ...market.assets[0], usdPrice: 12.25 }] })));

    await expect(getMarket()).resolves.toEqual(market);
    await expect(getMarket()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});
