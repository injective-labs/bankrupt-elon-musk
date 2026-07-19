// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountProjection } from "@/types";
import { GameProvider, useGame, type GameApi } from "./GameProvider";

const projection = (cash: string): AccountProjection => ({
  walletAddress: "0x1111111111111111111111111111111111111111",
  walletName: "tester",
  cash,
  holdingsValue: "0",
  netWorth: cash,
  pnl: "0",
  positions: [],
  assets: [],
  recentTransactions: [],
  marketAsOf: null,
  settlementLocked: false,
  resetEnabled: false,
  updatedAt: "2026-07-19T00:00:00.000Z",
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function api(overrides: Partial<GameApi> = {}): GameApi {
  return {
    getSession: vi.fn().mockResolvedValue(null),
    loginWithSignature: vi.fn(),
    logout: vi.fn().mockResolvedValue(undefined),
    getGame: vi.fn(),
    submitTrade: vi.fn(),
    resetGame: vi.fn(),
    getTransactions: vi.fn(),
    getLeaderboard: vi.fn(),
    ...overrides,
  };
}

function Probe() {
  const game = useGame();
  return <>
    <output data-testid="status">{game.authStatus}</output>
    <output data-testid="cash">{game.account?.cash ?? "none"}</output>
    <output data-testid="pending">{game.pendingCommand ?? "none"}</output>
    <output data-testid="error">{game.lastError ?? "none"}</output>
    <button onClick={() => void game.actions.login("0x1111111111111111111111111111111111111111", "tester", async () => new Uint8Array([1, 2]))}>login</button>
    <button onClick={() => void game.actions.buyQty("asset", "2")}>buy</button>
    <button onClick={() => void game.actions.buyQty("asset", "9007199254740993125")}>buy-exact</button>
    <button onClick={() => { void game.actions.buyQty("asset", "2"); void game.actions.buyQty("asset", "2"); }}>double-buy</button>
    <button onClick={() => void game.actions.buyMax("asset")}>buy-max</button>
    <button onClick={() => void game.actions.sellAll("asset")}>sell-all</button>
    <button onClick={() => void game.actions.logout()}>logout</button>
  </>;
}

describe("GameProvider", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(cleanup);

  it("starts without a client-created USD 50 billion account and remains locked without a session", async () => {
    const client = api();
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    render(<GameProvider api={client}><Probe /></GameProvider>);
    expect(screen.getByTestId("cash")).toHaveTextContent("none");
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("locked"));
    expect(client.getGame).not.toHaveBeenCalled();
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });

  it("loads the account for a valid cookie session", async () => {
    const client = api({ getSession: vi.fn().mockResolvedValue({ walletAddress: "0x1", walletName: null }), getGame: vi.fn().mockResolvedValue(projection("12")) });
    render(<GameProvider api={client}><Probe /></GameProvider>);
    await waitFor(() => expect(screen.getByTestId("cash")).toHaveTextContent("12"));
    expect(screen.getByTestId("status")).toHaveTextContent("authenticated");
  });

  it("signs the exact nonce message and loads the returned account", async () => {
    const signer = vi.fn().mockResolvedValue(new Uint8Array([10, 11]));
    const client = api({
      loginWithSignature: vi.fn(async (_address, _name, sign) => {
        expect(await sign("exact server nonce message")).toEqual(new Uint8Array([10, 11]));
        return { walletAddress: "0x1", walletName: "tester" };
      }),
      getGame: vi.fn().mockResolvedValue(projection("22")),
    });
    function LoginProbe() {
      const game = useGame();
      return <><output>{game.account?.cash ?? "none"}</output><button onClick={() => void game.actions.login("0x1", "tester", signer)}>login</button></>;
    }
    render(<GameProvider api={client}><LoginProbe /></GameProvider>);
    await waitFor(() => expect(client.getSession).toHaveBeenCalled());
    await act(async () => screen.getByRole("button").click());
    await waitFor(() => expect(screen.getByText("22")).toBeInTheDocument());
    expect(signer).toHaveBeenCalledWith("exact server nonce message");
  });

  it("replaces projection after a successful trade and preserves it after failure", async () => {
    const submitTrade = vi.fn().mockResolvedValueOnce(projection("8")).mockRejectedValueOnce(new Error("TRADE_REJECTED"));
    const client = api({ getSession: vi.fn().mockResolvedValue({ walletAddress: "0x1", walletName: null }), getGame: vi.fn().mockResolvedValue(projection("10")), submitTrade });
    render(<GameProvider api={client}><Probe /></GameProvider>);
    await waitFor(() => expect(screen.getByTestId("cash")).toHaveTextContent("10"));
    await act(async () => screen.getByText("buy").click());
    expect(screen.getByTestId("cash")).toHaveTextContent("8");
    expect(submitTrade.mock.calls[0][0].idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    await act(async () => screen.getByText("buy").click());
    expect(screen.getByTestId("cash")).toHaveTextContent("8");
    expect(screen.getByTestId("error")).toHaveTextContent("TRADE_REJECTED");
  });

  it("clears the account on logout and expires it on a 401 action", async () => {
    const unauthorized = Object.assign(new Error("UNAUTHORIZED"), { status: 401, code: "UNAUTHORIZED" });
    const client = api({ getSession: vi.fn().mockResolvedValue({ walletAddress: "0x1", walletName: null }), getGame: vi.fn().mockResolvedValue(projection("10")), submitTrade: vi.fn().mockRejectedValue(unauthorized) });
    render(<GameProvider api={client}><Probe /></GameProvider>);
    await waitFor(() => expect(screen.getByTestId("cash")).toHaveTextContent("10"));
    await act(async () => screen.getByText("buy").click());
    expect(screen.getByTestId("cash")).toHaveTextContent("none");
    expect(screen.getByTestId("status")).toHaveTextContent("expired");
    await act(async () => screen.getByText("logout").click());
    expect(screen.getByTestId("status")).toHaveTextContent("locked");
  });

  it("does not let a deferred session restore overwrite a newer login", async () => {
    const restored = deferred<AccountProjection>();
    const getGame = vi.fn().mockReturnValueOnce(restored.promise).mockResolvedValueOnce(projection("login"));
    const client = api({ getSession: vi.fn().mockResolvedValue({ walletAddress: "0x1", walletName: null }), loginWithSignature: vi.fn().mockResolvedValue({ walletAddress: "0x1", walletName: null }), getGame });
    render(<GameProvider api={client}><Probe /></GameProvider>);
    await waitFor(() => expect(getGame).toHaveBeenCalledOnce());
    await act(async () => screen.getByText("login").click());
    expect(screen.getByTestId("cash")).toHaveTextContent("login");
    await act(async () => restored.resolve(projection("restore")));
    expect(screen.getByTestId("cash")).toHaveTextContent("login");
  });

  it("does not let deferred restore or action results overwrite logout", async () => {
    const restored = deferred<AccountProjection>();
    const client = api({ getSession: vi.fn().mockResolvedValue({ walletAddress: "0x1", walletName: null }), getGame: vi.fn().mockReturnValue(restored.promise) });
    const view = render(<GameProvider api={client}><Probe /></GameProvider>);
    await waitFor(() => expect(client.getGame).toHaveBeenCalled());
    await act(async () => screen.getByText("logout").click());
    await act(async () => restored.resolve(projection("stale")));
    expect(screen.getByTestId("cash")).toHaveTextContent("none");
    view.unmount();

    const traded = deferred<AccountProjection>();
    const actionClient = api({ getSession: vi.fn().mockResolvedValue({ walletAddress: "0x1", walletName: null }), getGame: vi.fn().mockResolvedValue(projection("10")), submitTrade: vi.fn().mockReturnValue(traded.promise) });
    render(<GameProvider api={actionClient}><Probe /></GameProvider>);
    await waitFor(() => expect(screen.getByTestId("cash")).toHaveTextContent("10"));
    act(() => screen.getByText("buy").click());
    await act(async () => screen.getByText("logout").click());
    await act(async () => traded.resolve(projection("stale")));
    expect(screen.getByTestId("cash")).toHaveTextContent("none");
  });

  it("uses a synchronous mutex for same-tick commands and exposes pending", async () => {
    const traded = deferred<AccountProjection>();
    const submitTrade = vi.fn().mockReturnValue(traded.promise);
    const client = api({ getSession: vi.fn().mockResolvedValue({ walletAddress: "0x1", walletName: null }), getGame: vi.fn().mockResolvedValue(projection("10")), submitTrade });
    render(<GameProvider api={client}><Probe /></GameProvider>);
    await waitFor(() => expect(screen.getByTestId("cash")).toHaveTextContent("10"));
    act(() => screen.getByText("double-buy").click());
    expect(submitTrade).toHaveBeenCalledOnce();
    expect(screen.getByTestId("pending")).toHaveTextContent("trade");
    await act(async () => traded.resolve(projection("8")));
    expect(screen.getByTestId("pending")).toHaveTextContent("none");
  });

  it("invalidates older requests when an action expires the session", async () => {
    const restored = deferred<AccountProjection>();
    const unauthorized = Object.assign(new Error("UNAUTHORIZED"), { status: 401, code: "UNAUTHORIZED" });
    const getGame = vi.fn().mockReturnValueOnce(restored.promise).mockResolvedValueOnce(projection("login"));
    const client = api({ getSession: vi.fn().mockResolvedValue({ walletAddress: "0x1", walletName: null }), loginWithSignature: vi.fn().mockResolvedValue({ walletAddress: "0x1", walletName: null }), getGame, submitTrade: vi.fn().mockRejectedValue(unauthorized) });
    render(<GameProvider api={client}><Probe /></GameProvider>);
    await waitFor(() => expect(getGame).toHaveBeenCalledOnce());
    await act(async () => screen.getByText("login").click());
    await act(async () => screen.getByText("buy").click());
    expect(screen.getByTestId("status")).toHaveTextContent("expired");
    await act(async () => restored.resolve(projection("stale")));
    expect(screen.getByTestId("cash")).toHaveTextContent("none");
  });

  it("sends exact decimal quantities and MAX without client arithmetic", async () => {
    const submitTrade = vi.fn().mockResolvedValue(projection("9"));
    const held = { ...projection("10"), positions: [{ assetId: "asset", quantity: "9007199254740993.125", costBasis: "1", marketValue: "1", unrealizedPnl: "0" }] };
    const client = api({ getSession: vi.fn().mockResolvedValue({ walletAddress: "0x1", walletName: null }), getGame: vi.fn().mockResolvedValue(held), submitTrade });
    render(<GameProvider api={client}><Probe /></GameProvider>);
    await waitFor(() => expect(screen.getByTestId("cash")).toHaveTextContent("10"));
    await act(async () => screen.getByText("buy").click());
    await act(async () => screen.getByText("buy-exact").click());
    await act(async () => screen.getByText("buy-max").click());
    await act(async () => screen.getByText("sell-all").click());
    expect(submitTrade.mock.calls.map(([value]) => value.quantity)).toEqual(["2", "9007199254740993125", "MAX", "MAX"]);
  });

  it("rejects logout while login owns the auth transition, then allows it after login", async () => {
    const verified = deferred<{ walletAddress: string; walletName: null }>();
    const client = api({ loginWithSignature: vi.fn().mockReturnValue(verified.promise), getGame: vi.fn().mockResolvedValue(projection("login")) });
    let game!: ReturnType<typeof useGame>;
    function Capture() { game = useGame(); return null; }
    render(<GameProvider api={client}><Capture /></GameProvider>);
    await waitFor(() => expect(client.getSession).toHaveBeenCalled());
    let login!: Promise<boolean>;
    act(() => { login = game.actions.login("0x1", null, vi.fn()); });
    await expect(game.actions.logout()).rejects.toMatchObject({ code: "AUTH_TRANSITION_PENDING" });
    expect(client.logout).not.toHaveBeenCalled();
    await act(async () => { verified.resolve({ walletAddress: "0x1", walletName: null }); await expect(login).resolves.toBe(true); });
    expect(game.authStatus).toBe("authenticated");
    await act(async () => { await expect(game.actions.logout()).resolves.toBe(true); });
    expect(client.logout).toHaveBeenCalledOnce();
    expect(game.authStatus).toBe("locked");
  });

  it("rejects login while logout owns the auth transition, then allows it after logout", async () => {
    const loggedOut = deferred<void>();
    const client = api({ getSession: vi.fn().mockResolvedValue({ walletAddress: "0x1", walletName: null }), getGame: vi.fn().mockResolvedValue(projection("10")), logout: vi.fn().mockReturnValue(loggedOut.promise), loginWithSignature: vi.fn().mockResolvedValue({ walletAddress: "0x1", walletName: null }) });
    let game!: ReturnType<typeof useGame>;
    function Capture() { game = useGame(); return null; }
    render(<GameProvider api={client}><Capture /></GameProvider>);
    await waitFor(() => expect(game.authStatus).toBe("authenticated"));
    let logout!: Promise<boolean>;
    act(() => { logout = game.actions.logout(); });
    let logoutSettled = false;
    void logout.then(() => { logoutSettled = true; });
    await expect(game.actions.login("0x1", null, vi.fn())).rejects.toMatchObject({ code: "AUTH_TRANSITION_PENDING" });
    expect(client.loginWithSignature).not.toHaveBeenCalled();
    expect(logoutSettled).toBe(false);
    expect(game.authStatus).toBe("authenticated");
    expect(game.account?.cash).toBe("10");
    await act(async () => { loggedOut.resolve(); await expect(logout).resolves.toBe(true); });
    expect(game.authStatus).toBe("locked");
    await act(async () => { await expect(game.actions.login("0x1", null, vi.fn())).resolves.toBe(true); });
    expect(client.loginWithSignature).toHaveBeenCalledOnce();
    expect(game.authStatus).toBe("authenticated");
  });

  it("keeps the authenticated account retryable when server logout fails", async () => {
    const client = api({ getSession: vi.fn().mockResolvedValue({ walletAddress: "0x1", walletName: null }), getGame: vi.fn().mockResolvedValue(projection("10")), logout: vi.fn().mockRejectedValue(new Error("LOGOUT_FAILED")) });
    let game!: ReturnType<typeof useGame>;
    function Capture() { game = useGame(); return null; }
    render(<GameProvider api={client}><Capture /></GameProvider>);
    await waitFor(() => expect(game.authStatus).toBe("authenticated"));
    await act(async () => { await expect(game.actions.logout()).resolves.toBe(false); });
    expect(game.authStatus).toBe("authenticated");
    expect(game.account?.cash).toBe("10");
    expect(game.lastError).toBe("LOGOUT_FAILED");
  });

  it("ticks into the live settlement window after the projection has loaded", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-20T08:59:59.000Z"));
    const client = api({ getSession: vi.fn().mockResolvedValue({ walletAddress: "0x1", walletName: null }), getGame: vi.fn().mockResolvedValue(projection("10")), getLeaderboard: vi.fn().mockResolvedValue({ top: [], total: 0, you: null }) });
    let game!: ReturnType<typeof useGame>;
    function Capture() { game = useGame(); return null; }
    render(<GameProvider api={client}><Capture /></GameProvider>);
    await act(async () => { await vi.runAllTicks(); await Promise.resolve(); await Promise.resolve(); });
    expect(game.tradingLocked).toBe(false);
    act(() => vi.advanceTimersByTime(1000));
    expect(game.tradingLocked).toBe(true);
    vi.useRealTimers();
  });
});
