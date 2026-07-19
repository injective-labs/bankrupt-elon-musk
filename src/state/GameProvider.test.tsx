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
  updatedAt: "2026-07-19T00:00:00.000Z",
});

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
    <button onClick={() => void game.actions.buyQty("asset", 2)}>buy</button>
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
});
