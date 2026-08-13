// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AccountProjection } from "@/types";
import { GameProvider, useGame, type GameApi } from "@/state/GameProvider";

const host = vi.hoisted(() => ({
  environmentReady: true,
  embedded: true,
  sessionReady: false,
  wallet: null as null | { address: string; walletName?: string },
}));

vi.mock("./InjPassProvider", () => ({
  useInjPass: () => ({ ...host }),
}));

import { HostWalletSessionGuard } from "./HostWalletSessionGuard";

const oldAccount: AccountProjection = {
  walletAddress: "0x1111111111111111111111111111111111111111",
  walletName: "old-wallet",
  cash: "100",
  holdingsValue: "0",
  netWorth: "100",
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
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

function api(overrides: Partial<GameApi> = {}): GameApi {
  return {
    getSession: vi.fn().mockResolvedValue({ walletAddress: oldAccount.walletAddress, walletName: oldAccount.walletName }),
    getMarket: vi.fn().mockResolvedValue({ assets: [], marketAsOf: null }),
    loginWithSignature: vi.fn(),
    logout: vi.fn().mockResolvedValue(undefined),
    getGame: vi.fn().mockResolvedValue(oldAccount),
    submitTrade: vi.fn(),
    resetGame: vi.fn(),
    getTransactions: vi.fn(),
    getLeaderboard: vi.fn(),
    ...overrides,
  };
}

function StateProbe() {
  const game = useGame();
  return <output data-testid="game-state">{game.authStatus}:{game.account?.cash ?? "none"}</output>;
}

function GameSurfaceProbe() {
  const game = useGame();
  return game.authStatus === "authenticated"
    ? <div>protected portfolio</div>
    : <div>guest market</div>;
}

describe("HostWalletSessionGuard", () => {
  afterEach(() => {
    cleanup();
    host.environmentReady = true;
    host.embedded = true;
    host.sessionReady = false;
    host.wallet = null;
  });

  it("hides cookie-backed game UI until the first host session is known", async () => {
    const client = api();
    render(
      <GameProvider api={client}>
        <HostWalletSessionGuard><div>protected portfolio</div></HostWalletSessionGuard>
      </GameProvider>,
    );

    await waitFor(() => expect(client.getGame).toHaveBeenCalledOnce());
    expect(screen.getByRole("status")).toHaveTextContent("正在同步 INJ Pass 钱包");
    expect(screen.queryByText("protected portfolio")).not.toBeInTheDocument();
  });

  it("locks stale game state even when cookie deletion fails", async () => {
    host.sessionReady = true;
    host.wallet = {
      address: "0x2222222222222222222222222222222222222222",
      walletName: "hello_2",
    };
    const logout = vi.fn().mockRejectedValue(new Error("LOGOUT_FAILED"));
    const client = api({ logout });
    render(
      <GameProvider api={client}>
        <StateProbe />
        <HostWalletSessionGuard><GameSurfaceProbe /></HostWalletSessionGuard>
      </GameProvider>,
    );

    await waitFor(() => expect(logout).toHaveBeenCalledOnce());
    expect(screen.getByTestId("game-state")).toHaveTextContent("locked:none");
    expect(screen.queryByText("protected portfolio")).not.toBeInTheDocument();
    expect(screen.getByText("guest market")).toBeInTheDocument();
  });

  it("keeps the wallet sync guard up until stale-cookie deletion settles", async () => {
    host.sessionReady = true;
    host.wallet = {
      address: "0x2222222222222222222222222222222222222222",
      walletName: "hello_2",
    };
    const cleanupRequest = deferred<void>();
    const logout = vi.fn().mockReturnValue(cleanupRequest.promise);
    const client = api({ logout });
    render(
      <GameProvider api={client}>
        <HostWalletSessionGuard><GameSurfaceProbe /></HostWalletSessionGuard>
      </GameProvider>,
    );

    await waitFor(() => expect(logout).toHaveBeenCalledOnce());
    expect(screen.getByRole("status")).toHaveTextContent("正在同步 INJ Pass 钱包");
    expect(screen.queryByText("guest market")).not.toBeInTheDocument();

    cleanupRequest.resolve();
    await waitFor(() => expect(screen.getByText("guest market")).toBeInTheDocument());
  });
});
