import { afterEach, describe, expect, it, vi } from "vitest";
import { stringToHex } from "viem";

import { createElonAgentApi } from "./api";

const wallet = "0x0000000000000000000000000000000000000001";
const otherWallet = "0x0000000000000000000000000000000000000002";
const session = (address = wallet) => ({
  authenticated: true,
  address,
  walletName: "alice.inj",
  chainId: 1,
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});
const game = (address = wallet) => ({
  walletAddress: address, walletName: "alice.inj", cash: "100", holdingsValue: "0",
  netWorth: "100", pnl: "0", positions: [], assets: [], recentTransactions: [],
  marketAsOf: null, settlementLocked: false, resetEnabled: false,
  updatedAt: "2026-08-12T00:00:00.000Z",
});

describe("createElonAgentApi", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("signs once and keeps the Agent token only in memory for repeated protected calls", async () => {
    const provider = { request: vi.fn().mockResolvedValue("0xsigned") };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ nonce: "n", message: "sign this exact message" }))
      .mockResolvedValueOnce(json({ walletAddress: wallet, walletName: "alice.inj", accessToken: "agent.jwt", expiresIn: 900 }))
      .mockResolvedValueOnce(json(game()))
      .mockResolvedValueOnce(json(game()));
    vi.stubGlobal("fetch", fetchMock);
    const api = createElonAgentApi(provider);

    await api.getGame(session());
    await api.getGame(session());

    expect(provider.request).toHaveBeenCalledTimes(1);
    expect(provider.request).toHaveBeenCalledWith({
      method: "personal_sign",
      params: [stringToHex("sign this exact message"), wallet],
    });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      address: wallet,
      walletName: "alice.inj",
      signature: "0xsigned",
    });
    expect(fetchMock.mock.calls.slice(2).every(([, init]) =>
      init.headers.Authorization === "Bearer agent.jwt")).toBe(true);
    expect(JSON.stringify(api)).not.toContain("agent.jwt");
  });

  it("clears and rebinds when the host wallet changes", async () => {
    const provider = { request: vi.fn().mockResolvedValue("0xsigned") };
    const fetchMock = vi.fn();
    for (const address of [wallet, otherWallet]) {
      fetchMock
        .mockResolvedValueOnce(json({ nonce: "n", message: `sign ${address}` }))
        .mockResolvedValueOnce(json({ walletAddress: address, walletName: null, accessToken: `${address}.jwt`, expiresIn: 900 }))
        .mockResolvedValueOnce(json(game(address)));
    }
    vi.stubGlobal("fetch", fetchMock);
    const api = createElonAgentApi(provider);

    await api.getGame(session(wallet));
    await api.getGame(session(otherWallet));
    expect(provider.request).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[5][1].headers.Authorization).toBe(`Bearer ${otherWallet}.jwt`);
  });

  it("rebinds once after a protected request returns 401", async () => {
    const provider = { request: vi.fn().mockResolvedValue("0xsigned") };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ nonce: "n1", message: "sign one" }))
      .mockResolvedValueOnce(json({ walletAddress: wallet, walletName: null, accessToken: "expired.jwt", expiresIn: 900 }))
      .mockResolvedValueOnce(json({ error: { code: "UNAUTHORIZED", message: "expired" } }, 401))
      .mockResolvedValueOnce(json({ nonce: "n2", message: "sign two" }))
      .mockResolvedValueOnce(json({ walletAddress: wallet, walletName: null, accessToken: "fresh.jwt", expiresIn: 900 }))
      .mockResolvedValueOnce(json(game()));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createElonAgentApi(provider).getGame(session())).resolves.toMatchObject({ cash: "100" });
    expect(provider.request).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[5][1].headers.Authorization).toBe("Bearer fresh.jwt");
  });

  it("requires an authenticated host session for protected calls", async () => {
    const api = createElonAgentApi({ request: vi.fn() });
    await expect(api.getGame({ authenticated: false, address: null, chainId: 1 }))
      .rejects.toMatchObject({ status: 401, code: "UNAUTHORIZED" });
  });

  it("stops binding after signing when the host session is aborted", async () => {
    const controller = new AbortController();
    const provider = {
      request: vi.fn().mockImplementation(async () => {
        controller.abort();
        return "0xsigned";
      }),
    };
    const fetchMock = vi.fn().mockResolvedValueOnce(
      json({ nonce: "n", message: "sign this exact message" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(createElonAgentApi(provider).getGame(session(), controller.signal))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
