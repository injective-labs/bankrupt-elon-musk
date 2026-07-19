// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccountProjection } from "@/types";
import { GameProvider, type GameApi } from "@/state/GameProvider";

const disconnect = vi.fn();
let connector = { status: "idle", wallet: null as null | { address: string; walletName: string | null }, error: null };
vi.mock("./InjPassProvider", () => ({
  useInjPass: () => ({ ...connector, connect: vi.fn(), disconnect, signMessage: vi.fn() }),
}));

import { ConnectButton } from "./ConnectButton";

const account: AccountProjection = {
  walletAddress: "0x1111111111111111111111111111111111111111", walletName: "restored", cash: "1", holdingsValue: "0", netWorth: "1", pnl: "0", positions: [], assets: [], recentTransactions: [], marketAsOf: null, settlementLocked: false, updatedAt: "2026-07-19T00:00:00.000Z",
};

describe("ConnectButton", () => {
  afterEach(() => { cleanup(); vi.clearAllMocks(); connector = { status: "idle", wallet: null, error: null }; });

  it("shows restored server identity and can log out without a connector wallet", async () => {
    const logout = vi.fn().mockResolvedValue(undefined);
    const api: GameApi = {
      getSession: vi.fn().mockResolvedValue({ walletAddress: account.walletAddress, walletName: account.walletName }), loginWithSignature: vi.fn(), logout,
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
    connector = { status: "connected", wallet: { address: account.walletAddress, walletName: "connector" }, error: null };
    const api: GameApi = {
      getSession: vi.fn().mockResolvedValue({ walletAddress: account.walletAddress, walletName: account.walletName }), loginWithSignature: vi.fn(), logout: vi.fn().mockRejectedValue(new Error("LOGOUT_FAILED")),
      getGame: vi.fn().mockResolvedValue(account), submitTrade: vi.fn(), resetGame: vi.fn(), getTransactions: vi.fn(), getLeaderboard: vi.fn(),
    };
    render(<GameProvider api={api}><ConnectButton /></GameProvider>);
    fireEvent.click(await screen.findByRole("button", { name: /restored/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /断开|Disconnect/ }));
    await waitFor(() => expect(api.logout).toHaveBeenCalledOnce());
    expect(disconnect).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /restored/ })).toBeInTheDocument();
  });
});
