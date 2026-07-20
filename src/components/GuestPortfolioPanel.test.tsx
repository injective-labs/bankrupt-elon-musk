// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GameProvider, type GameApi } from "@/state/GameProvider";
import { GuestPortfolioPanel } from "./GuestPortfolioPanel";

vi.mock("@/wallet/ConnectButton", () => ({
  ConnectButton: () => <button type="button">连接 INJ Pass</button>,
}));

const api: GameApi = {
  getSession: vi.fn().mockResolvedValue(null),
  getMarket: vi.fn().mockResolvedValue({ assets: [], marketAsOf: null }),
  loginWithSignature: vi.fn(), logout: vi.fn(), getGame: vi.fn(), submitTrade: vi.fn(),
  resetGame: vi.fn(), getTransactions: vi.fn(), getLeaderboard: vi.fn(),
};

describe("GuestPortfolioPanel", () => {
  afterEach(cleanup);

  it("explains the real starting grant without fabricating an account", async () => {
    render(<GameProvider api={api}><GuestPortfolioPanel /></GameProvider>);

    expect(await screen.findByRole("button", { name: "连接 INJ Pass" })).toBeInTheDocument();
    expect(screen.getByText(/500 亿/)).toBeInTheDocument();
    expect(screen.queryByText("$50,000,000,000.00")).not.toBeInTheDocument();
    expect(screen.queryByText("现金余额")).not.toBeInTheDocument();
    expect(screen.queryByText("总盈亏")).not.toBeInTheDocument();
    expect(screen.queryByText("全服亏钱排名")).not.toBeInTheDocument();
  });
});
