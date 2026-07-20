// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccountProjection } from "@/types";
import { GameProvider, useGame, type GameApi } from "@/state/GameProvider";
import { PortfolioPanel } from "./PortfolioPanel";

const base: AccountProjection = { walletAddress: "0x1", cash: "9007199254740993.12", holdingsValue: "0.88", netWorth: "9007199254740994.00", pnl: "-49999999999.125", positions: [], assets: [], recentTransactions: [], marketAsOf: null, settlementLocked: false, resetEnabled: false, updatedAt: "2026-07-19T00:00:00.000Z" };
const api = (overrides: Partial<GameApi> = {}): GameApi => ({ getSession: vi.fn().mockResolvedValue({ walletAddress: "0x1", walletName: null }), getMarket: vi.fn().mockResolvedValue({ assets: [], marketAsOf: null }), loginWithSignature: vi.fn(), logout: vi.fn(), getGame: vi.fn().mockResolvedValue(base), submitTrade: vi.fn(), resetGame: vi.fn(), getTransactions: vi.fn(), getLeaderboard: vi.fn().mockResolvedValue({ top: [], total: 0, you: null }), ...overrides });

describe("PortfolioPanel authoritative projection", () => {
  afterEach(cleanup);

  it("renders exact server totals without Number precision loss and no invented ranking", async () => {
    render(<GameProvider api={api()}><PortfolioPanel /></GameProvider>);
    expect(await screen.findByText("$9,007,199,254,740,994.00")).toBeInTheDocument();
    expect(screen.getByText("$9,007,199,254,740,993.12")).toBeInTheDocument();
    expect(screen.queryByText(/Elon|马斯克.*#/)).not.toBeInTheDocument();
  });

  it("re-renders returned cash and positions after a successful command", async () => {
    const next: AccountProjection = { ...base, cash: "75.50", holdingsValue: "24.50", netWorth: "100.00", positions: [{ assetId: "asset", quantity: "2", costBasis: "20", marketValue: "24.50", unrealizedPnl: "4.50" }], assets: [{ id: "asset", name: "资产", nameEn: "Asset", category: "美股", ticker: "AST", currency: "USD", unit: "股", unitEn: "share", enabled: true, displayOrder: 1, usdPrice: "12.25", marketDate: "2026-07-18T00:00:00.000Z", quoteStatus: "ACTIVE" }] };
    function Harness() { const { actions } = useGame(); return <><button onClick={() => void actions.buyQty("asset", "2")}>trade</button><PortfolioPanel /></>; }
    render(<GameProvider api={api({ submitTrade: vi.fn().mockResolvedValue(next) })}><Harness /></GameProvider>);
    await screen.findByText("$9,007,199,254,740,993.12");
    await act(async () => screen.getByRole("button", { name: "trade" }).click());
    expect(screen.getByText("$75.50")).toBeInTheDocument();
    expect(screen.getByText("资产")).toBeInTheDocument();
    expect(screen.getAllByText("$24.50")).toHaveLength(2);
  });

  it("marks the portfolio panel after a successful reset", async () => {
    function Harness() { const { actions } = useGame(); return <><button onClick={() => void actions.reset()}>reset</button><PortfolioPanel /></>; }
    render(<GameProvider api={api({ resetGame: vi.fn().mockResolvedValue(base) })}><Harness /></GameProvider>);
    await screen.findByText("$9,007,199,254,740,993.12");

    await act(async () => screen.getByRole("button", { name: "reset" }).click());

    expect(screen.getByRole("complementary")).toHaveClass("reset-success");
  });

  it("shows an explicit unavailable state when leaderboard loading fails", async () => {
    render(<GameProvider api={api({ getLeaderboard: vi.fn().mockRejectedValue(new Error("down")) })}><PortfolioPanel /></GameProvider>);
    await waitFor(() => expect(screen.getByText(/排行榜暂不可用|Leaderboard unavailable/)).toBeInTheDocument());
  });

  it("shows empty success rather than a perpetual loading state", async () => {
    render(<GameProvider api={api()}><PortfolioPanel /></GameProvider>);
    await waitFor(() => expect(screen.getByText(/暂无排行榜记录|No leaderboard entries/)).toBeInTheDocument());
    expect(screen.queryByText(/排行榜同步中|Loading leaderboard/)).not.toBeInTheDocument();
  });
});
