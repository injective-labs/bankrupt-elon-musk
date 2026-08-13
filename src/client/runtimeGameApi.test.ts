import { afterEach, describe, expect, it, vi } from "vitest";

import * as realHttp from "./gameApi";
import { GameApiError, type AgentSessionView } from "./gameApi";
import { createRuntimeGameApi, type RuntimeGameTransport } from "./runtimeGameApi";

const wallet = "0x1111111111111111111111111111111111111111";
const account = {
  walletAddress: wallet,
  walletName: "hello_1",
  cash: "50000000000",
  holdingsValue: "0",
  netWorth: "50000000000",
  pnl: "0",
  positions: [],
  assets: [],
  recentTransactions: [],
  marketAsOf: null,
  settlementLocked: false,
  resetEnabled: false,
  updatedAt: "2026-08-13T00:00:00.000Z",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function transport(overrides: Partial<RuntimeGameTransport> = {}): RuntimeGameTransport {
  return {
    getSession: vi.fn().mockResolvedValue(null),
    loginWithSignature: vi.fn(),
    logout: vi.fn().mockResolvedValue(undefined),
    getAuthChallenge: vi.fn().mockResolvedValue({ nonce: "nonce", message: "exact nonce message" }),
    verifyAgentSignature: vi.fn().mockResolvedValue({
      walletAddress: wallet,
      walletName: "hello_1",
      accessToken: "agent.jwt",
      expiresIn: 900,
    } satisfies AgentSessionView),
    getGame: vi.fn().mockResolvedValue(account),
    getMarket: vi.fn().mockResolvedValue({ assets: [], marketAsOf: null }),
    submitTrade: vi.fn().mockResolvedValue(account),
    resetGame: vi.fn().mockResolvedValue(account),
    getTransactions: vi.fn().mockResolvedValue({ rows: [], nextCursor: null }),
    getLeaderboard: vi.fn().mockResolvedValue({ top: [], total: 0, you: null }),
    ...overrides,
  };
}

describe("runtimeGameApi", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses an in-memory Agent bearer for every protected embedded game request", async () => {
    const http = transport();
    const api = createRuntimeGameApi({ embedded: () => true, transport: http });
    const signer = vi.fn().mockResolvedValue(new Uint8Array([0, 15, 255]));

    await expect(api.getSession()).resolves.toBeNull();
    await expect(api.loginWithSignature(wallet, "hello_1", signer)).resolves.toEqual({
      walletAddress: wallet,
      walletName: "hello_1",
    });
    expect(signer).toHaveBeenCalledWith("exact nonce message");
    expect(http.verifyAgentSignature).toHaveBeenCalledWith(
      wallet,
      "hello_1",
      "0x000fff",
    );
    expect(http.loginWithSignature).not.toHaveBeenCalled();

    await api.getGame();
    await api.submitTrade({ assetId: "asset", side: "BUY", quantity: "1", idempotencyKey: "key" });
    await api.resetGame("reset-key");
    await api.getTransactions("cursor", 20);
    await api.getLeaderboard();

    expect(http.getGame).toHaveBeenCalledWith("agent.jwt");
    expect(http.submitTrade).toHaveBeenCalledWith(expect.any(Object), "agent.jwt");
    expect(http.resetGame).toHaveBeenCalledWith("reset-key", "agent.jwt");
    expect(http.getTransactions).toHaveBeenCalledWith("cursor", 20, "agent.jwt");
    expect(http.getLeaderboard).toHaveBeenCalledWith("agent.jwt");
  });

  it("keeps the standalone cookie client unchanged", async () => {
    const standaloneSession = { walletAddress: wallet, walletName: "hello_1" };
    const http = transport({
      getSession: vi.fn().mockResolvedValue(standaloneSession),
      loginWithSignature: vi.fn().mockResolvedValue(standaloneSession),
    });
    const api = createRuntimeGameApi({ embedded: () => false, transport: http });
    const signer = vi.fn();

    await expect(api.getSession()).resolves.toEqual(standaloneSession);
    await expect(api.loginWithSignature(wallet, "hello_1", signer)).resolves.toEqual(standaloneSession);
    await api.getGame();
    await api.logout();

    expect(http.loginWithSignature).toHaveBeenCalledWith(wallet, "hello_1", signer);
    expect(http.getGame).toHaveBeenCalledWith();
    expect(http.logout).toHaveBeenCalledOnce();
    expect(http.verifyAgentSignature).not.toHaveBeenCalled();
  });

  it("clears an embedded bearer on logout without calling cookie logout", async () => {
    const http = transport();
    const api = createRuntimeGameApi({ embedded: () => true, transport: http });
    await api.loginWithSignature(wallet, "hello_1", vi.fn().mockResolvedValue(new Uint8Array([1])));

    await api.logout();

    expect(http.logout).not.toHaveBeenCalled();
    await expect(api.getSession()).resolves.toBeNull();
    await expect(api.getGame()).rejects.toMatchObject({ status: 401, code: "GAME_AUTH_EXPIRED" });
    expect(http.getGame).not.toHaveBeenCalled();
  });

  it("clears and remaps a rejected embedded bearer without expiring the host wallet", async () => {
    const http = transport({
      getGame: vi.fn().mockRejectedValue(new GameApiError(401, "UNAUTHORIZED", "Invalid agent session")),
    });
    const api = createRuntimeGameApi({ embedded: () => true, transport: http });
    await api.loginWithSignature(wallet, "hello_1", vi.fn().mockResolvedValue(new Uint8Array([1])));

    await expect(api.getGame()).rejects.toMatchObject({
      status: 401,
      code: "GAME_AUTH_EXPIRED",
    });
    await expect(api.getSession()).resolves.toBeNull();
  });

  it("does not let a stale request clear a newer embedded authorization", async () => {
    const staleRequest = deferred<typeof account>();
    const http = transport({
      verifyAgentSignature: vi.fn()
        .mockResolvedValueOnce({ walletAddress: wallet, walletName: "hello_1", accessToken: "token-a", expiresIn: 900 })
        .mockResolvedValueOnce({ walletAddress: wallet, walletName: "hello_1", accessToken: "token-b", expiresIn: 900 }),
      getGame: vi.fn().mockReturnValue(staleRequest.promise),
    });
    const api = createRuntimeGameApi({ embedded: () => true, transport: http });
    const signer = vi.fn().mockResolvedValue(new Uint8Array([1]));
    await api.loginWithSignature(wallet, "hello_1", signer);
    const oldRequest = api.getGame();

    await api.loginWithSignature(wallet, "hello_1", signer);
    staleRequest.reject(new GameApiError(401, "UNAUTHORIZED", "token A expired"));

    await expect(oldRequest).rejects.toMatchObject({ status: 401, code: "GAME_AUTH_EXPIRED" });
    await expect(api.getSession()).resolves.toEqual({ walletAddress: wallet, walletName: "hello_1" });
    expect(http.getGame).toHaveBeenCalledWith("token-a");
  });

  it("rejects an Agent token bound to a different wallet", async () => {
    const http = transport({
      verifyAgentSignature: vi.fn().mockResolvedValue({
        walletAddress: "0x2222222222222222222222222222222222222222",
        walletName: "hello_2",
        accessToken: "wrong.jwt",
        expiresIn: 900,
      }),
    });
    const api = createRuntimeGameApi({ embedded: () => true, transport: http });

    await expect(api.loginWithSignature(
      wallet,
      "hello_1",
      vi.fn().mockResolvedValue(new Uint8Array([1])),
    )).rejects.toMatchObject({ status: 401, code: "GAME_AUTH_MISMATCH" });
    await expect(api.getSession()).resolves.toBeNull();
  });

  it("completes the production embed sequence with an Authorization header instead of a cookie session", async () => {
    const json = (value: unknown) => new Response(JSON.stringify(value), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ nonce: "nonce", message: "exact nonce message" }))
      .mockResolvedValueOnce(json({
        walletAddress: wallet,
        walletName: "hello_1",
        accessToken: "agent.jwt",
        expiresIn: 900,
      }))
      .mockResolvedValueOnce(json(account));
    vi.stubGlobal("fetch", fetchMock);
    const api = createRuntimeGameApi({ embedded: () => true, transport: realHttp });

    await api.loginWithSignature(wallet, "hello_1", vi.fn().mockResolvedValue(new Uint8Array([1])));
    await expect(api.getGame()).resolves.toEqual(account);

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/auth/nonce",
      "/api/auth/agent-verify",
      "/api/game",
    ]);
    expect(fetchMock.mock.calls[2][1]).toEqual(expect.objectContaining({
      headers: { Authorization: "Bearer agent.jwt" },
    }));
  });
});
