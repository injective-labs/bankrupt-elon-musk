// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccountProjection } from "@/types";
import { GameProvider, type GameApi } from "@/state/GameProvider";
import { MarketPanel } from "./MarketPanel";

const dbOnly = { id: "database-only", name: "数据库资产", nameEn: "Database Asset", category: "另类", subCategory: "测试类", ticker: "DBX", currency: "USD", unit: "份", unitEn: "unit", enabled: true, displayOrder: 1, usdPrice: "3.5", marketDate: "2026-07-20T00:00:00.000Z", quoteStatus: "ACTIVE" as const };
const disabled = { ...dbOnly, id: "disabled-held", name: "已下架持仓", nameEn: "Disabled Holding", ticker: "OFF", enabled: false, displayOrder: 2 };
const account: AccountProjection = { walletAddress: "0x1", cash: "100", holdingsValue: "7", netWorth: "107", pnl: "0", positions: [{ assetId: disabled.id, quantity: "2", costBasis: "7", marketValue: "7", unrealizedPnl: "0" }], assets: [dbOnly, disabled], recentTransactions: [], marketAsOf: dbOnly.marketDate, settlementLocked: false, resetEnabled: false, updatedAt: "2026-07-20T00:00:00.000Z" };
const api: GameApi = { getSession: vi.fn().mockResolvedValue({ walletAddress: "0x1", walletName: null }), getMarket: vi.fn().mockResolvedValue({ assets: account.assets, marketAsOf: account.marketAsOf }), loginWithSignature: vi.fn(), logout: vi.fn(), getGame: vi.fn().mockResolvedValue(account), submitTrade: vi.fn(), resetGame: vi.fn(), getTransactions: vi.fn(), getLeaderboard: vi.fn().mockResolvedValue({ top: [], total: 0, you: null }) };

describe("MarketPanel server asset catalog", () => {
  afterEach(cleanup);
  it("renders and searches a DB-only asset and keeps a disabled held asset visible but locked", async () => {
    render(<GameProvider api={api}><MarketPanel /></GameProvider>);
    expect(await screen.findByRole("heading", { name: "数据库资产" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "已下架持仓" })).toBeInTheDocument();
    expect(screen.getByText(/已下架，仅展示持仓/)).toBeInTheDocument();
    const disabledCard = screen.getByRole("heading", { name: "已下架持仓" }).closest("article")!;
    expect(disabledCard.querySelector(".buy-button")).toBeDisabled();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "DBX" } });
    await waitFor(() => expect(screen.getByRole("heading", { name: "数据库资产" })).toBeInTheDocument());
    expect(screen.queryByRole("heading", { name: "已下架持仓" })).not.toBeInTheDocument();
  });

  it("renders real public quotes without creating or loading an account", async () => {
    const getGame = vi.fn();
    const guestApi: GameApi = {
      ...api,
      getSession: vi.fn().mockResolvedValue(null),
      getMarket: vi.fn().mockResolvedValue({ assets: [dbOnly], marketAsOf: dbOnly.marketDate }),
      getGame,
    };

    render(<GameProvider api={guestApi}><MarketPanel /></GameProvider>);

    expect(await screen.findByRole("heading", { name: "数据库资产" })).toBeInTheDocument();
    expect(screen.getByText("$3.50")).toBeInTheDocument();
    expect(screen.getByRole("searchbox")).toBeInTheDocument();
    expect(getGame).not.toHaveBeenCalled();
  });
});
