// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccountProjection } from "@/types";
import { GameProvider, type GameApi } from "@/state/GameProvider";

const disconnect = vi.fn();
let connector: {
  status: string;
  wallet: null | {
    address: string;
    walletName: string | null;
    signer?: { signMessage: ReturnType<typeof vi.fn> };
  };
  error: null;
  environmentReady: boolean;
  embedded: boolean;
  sessionReady: boolean;
} = { status: "idle", wallet: null, error: null, environmentReady: true, embedded: false, sessionReady: true };
vi.mock("./InjPassProvider", () => ({
  useInjPass: () => ({ ...connector, connect: vi.fn(), disconnect, signMessage: vi.fn() }),
}));

import { ConnectButton } from "./ConnectButton";

const account: AccountProjection = {
  walletAddress: "0x1111111111111111111111111111111111111111", walletName: "restored", cash: "1", holdingsValue: "0", netWorth: "1", pnl: "0", positions: [], assets: [], recentTransactions: [], marketAsOf: null, settlementLocked: false, resetEnabled: false, updatedAt: "2026-07-19T00:00:00.000Z",
};

describe("ConnectButton", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    connector = { status: "idle", wallet: null, error: null, environmentReady: true, embedded: false, sessionReady: true };
  });

  it("shows restored server identity and can log out without a connector wallet", async () => {
    const logout = vi.fn().mockResolvedValue(undefined);
    const api: GameApi = {
      getSession: vi.fn().mockResolvedValue({ walletAddress: account.walletAddress, walletName: account.walletName }), getMarket: vi.fn().mockResolvedValue({ assets: [], marketAsOf: null }), loginWithSignature: vi.fn(), logout,
      getGame: vi.fn().mockResolvedValue(account), submitTrade: vi.fn(), resetGame: vi.fn(), getTransactions: vi.fn(), getLeaderboard: vi.fn(),
    };
    render(<GameProvider api={api}><ConnectButton /></GameProvider>);
    const identity = await screen.findByRole("button", { name: /restored/ });
    fireEvent.click(identity);
    fireEvent.click(screen.getByRole("menuitem", { name: /断开|Disconnect/ }));
    await waitFor(() => expect(logout).toHaveBeenCalledOnce());
    expect(disconnect).not.toHaveBeenCalled();
  });

  it("keeps the connector attached when server logout fails", async () => {
    connector = { status: "connected", wallet: { address: account.walletAddress, walletName: "connector" }, error: null, environmentReady: true, embedded: false, sessionReady: true };
    const api: GameApi = {
      getSession: vi.fn().mockResolvedValue({ walletAddress: account.walletAddress, walletName: account.walletName }), getMarket: vi.fn().mockResolvedValue({ assets: [], marketAsOf: null }), loginWithSignature: vi.fn(), logout: vi.fn().mockRejectedValue(new Error("LOGOUT_FAILED")),
      getGame: vi.fn().mockResolvedValue(account), submitTrade: vi.fn(), resetGame: vi.fn(), getTransactions: vi.fn(), getLeaderboard: vi.fn(),
    };
    render(<GameProvider api={api}><ConnectButton /></GameProvider>);
    fireEvent.click(await screen.findByRole("button", { name: /restored/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /断开|Disconnect/ }));
    await waitFor(() => expect(api.logout).toHaveBeenCalledOnce());
    expect(disconnect).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /restored/ })).toBeInTheDocument();
  });

  it("shows explicit game authorization when the host wallet is connected", async () => {
    connector = {
      status: "connected",
      wallet: {
        address: account.walletAddress,
        walletName: "hello_1",
        signer: { signMessage: vi.fn() },
      },
      error: null,
      environmentReady: true,
      embedded: true,
      sessionReady: true,
    };
    const api: GameApi = {
      getSession: vi.fn().mockResolvedValue(null),
      getMarket: vi.fn().mockResolvedValue({ assets: [], marketAsOf: null }),
      loginWithSignature: vi.fn(), logout: vi.fn(), getGame: vi.fn(), submitTrade: vi.fn(),
      resetGame: vi.fn(), getTransactions: vi.fn(), getLeaderboard: vi.fn(),
    };

    render(<GameProvider api={api}><ConnectButton /></GameProvider>);

    expect(await screen.findByRole("button", { name: /hello_1.*授权游戏/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^连接 INJ Pass$/ })).not.toBeInTheDocument();
  });

});
