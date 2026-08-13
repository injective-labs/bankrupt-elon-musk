// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccountProjection } from "@/types";
import { GameProvider, useGame, type GameApi } from "@/state/GameProvider";
import { GameApiError } from "@/client/gameApi";
import { InjPassProvider } from "@/wallet/InjPassProvider";
import { GameShell } from "./GameApp";

vi.mock("@/wallet/ConnectButton", () => ({
  ConnectButton: () => <button type="button">连接 INJ Pass</button>,
}));

const asset = { id: "preview", name: "预览资产", nameEn: "Preview Asset", category: "美股", subCategory: null, ticker: "PRV", currency: "USD", unit: "股", enabled: true, displayOrder: 1, usdPrice: "12.25", marketDate: "2026-07-20T00:00:00.000Z", quoteStatus: "ACTIVE" as const };
const account: AccountProjection = { walletAddress: "0x1", walletName: "player", cash: "100", holdingsValue: "0", netWorth: "100", pnl: "-49999999900", positions: [], assets: [asset], recentTransactions: [], marketAsOf: asset.marketDate, settlementLocked: false, resetEnabled: false, updatedAt: "2026-07-20T00:00:00.000Z" };

describe("GameShell guest-to-account flow", () => {
  afterEach(cleanup);

  it("keeps the real market visible and replaces guest guidance after login", async () => {
    const api: GameApi = {
      getSession: vi.fn().mockResolvedValue(null),
      getMarket: vi.fn().mockResolvedValue({ assets: [asset], marketAsOf: asset.marketDate }),
      loginWithSignature: vi.fn().mockResolvedValue({ walletAddress: "0x1", walletName: "player" }),
      getGame: vi.fn().mockResolvedValue(account),
      logout: vi.fn(), submitTrade: vi.fn(), resetGame: vi.fn(), getTransactions: vi.fn(),
      getLeaderboard: vi.fn().mockResolvedValue({ top: [], total: 0, you: null }),
    };
    function LoginHarness() {
      const { actions } = useGame();
      return <button type="button" onClick={() => void actions.login("0x1", "player", async () => new Uint8Array([1]))}>test login</button>;
    }

    render(<InjPassProvider><GameProvider api={api}><GameShell /><LoginHarness /></GameProvider></InjPassProvider>);
    expect(await screen.findByRole("heading", { name: "预览资产" })).toBeInTheDocument();
    expect(screen.getByText("$12.25")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "登录后开始游戏" })).toBeInTheDocument();

    await act(async () => screen.getByRole("button", { name: "test login" }).click());

    await waitFor(() => expect(screen.getAllByText("$100.00")).toHaveLength(2));
    expect(screen.queryByRole("heading", { name: "登录后开始游戏" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "预览资产" })).toBeInTheDocument();
  });

  it("expires the game UI when a leaderboard bearer is rejected without claiming the INJ Pass session expired", async () => {
    const api: GameApi = {
      getSession: vi.fn().mockResolvedValue({ walletAddress: "0x1", walletName: "hello_1" }),
      getMarket: vi.fn().mockResolvedValue({ assets: [asset], marketAsOf: asset.marketDate }),
      getGame: vi.fn().mockResolvedValue(account),
      loginWithSignature: vi.fn(), logout: vi.fn(), submitTrade: vi.fn(), resetGame: vi.fn(), getTransactions: vi.fn(),
      getLeaderboard: vi.fn().mockRejectedValue(new GameApiError(401, "GAME_AUTH_EXPIRED", "expired")),
    };

    render(<InjPassProvider><GameProvider api={api}><GameShell /></GameProvider></InjPassProvider>);

    expect(await screen.findByRole("alert")).toHaveTextContent("游戏授权已失效，请重新授权");
    expect(screen.queryByText("会话已过期，请重新登录")).not.toBeInTheDocument();
  });
});
