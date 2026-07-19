// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccountProjection } from "@/types";
import { GameProvider, type GameApi } from "@/state/GameProvider";
import { productById } from "@/data/expandedAssets";
import { ProductCard } from "./ProductCard";

const product = [...productById.values()][0];
const asset = { id: product.id, name: product.name, nameEn: product.nameEn, category: product.assetClass || "美股", subCategory: product.subCategory, ticker: product.ticker || product.id, currency: "USD", unit: product.unit, unitEn: product.unitEn, enabled: true, displayOrder: 1, usdPrice: "12.3456789", marketDate: "2026-07-18T00:00:00.000Z", quoteStatus: "ACTIVE" as const };
const account = (overrides: Partial<AccountProjection> = {}): AccountProjection => ({ walletAddress: "0x1", cash: "100", holdingsValue: "0", netWorth: "100", pnl: "0", positions: [], assets: [asset], recentTransactions: [], marketAsOf: asset.marketDate, settlementLocked: false, updatedAt: "2026-07-19T00:00:00.000Z", ...overrides });
const api = (overrides: Partial<GameApi> = {}): GameApi => ({ getSession: vi.fn().mockResolvedValue({ walletAddress: "0x1", walletName: null }), loginWithSignature: vi.fn(), logout: vi.fn(), getGame: vi.fn().mockResolvedValue(account()), submitTrade: vi.fn().mockResolvedValue(account()), resetGame: vi.fn(), getTransactions: vi.fn(), getLeaderboard: vi.fn().mockResolvedValue({ top: [], total: 0, you: null }), ...overrides });
const props = { product, price: Number(asset.usdPrice), owned: 0, overdraft: false, currency: "USD", live: true, selected: false, liquidated: false, locale: "en" as const, activeSide: null, onOpenTicket: vi.fn(), onCloseTicket: vi.fn() };

describe("ProductCard authoritative trading states", () => {
  afterEach(cleanup);

  it("disables every trade control while signed out", async () => {
    render(<GameProvider api={api({ getSession: vi.fn().mockResolvedValue(null) })}><ProductCard {...props} /></GameProvider>);
    await waitFor(() => expect(screen.getByRole("button", { name: "Buy" })).toBeDisabled());
    expect(screen.getByRole("button", { name: "All-in" })).toBeDisabled();
  });

  it("shows quote date and stale status and prevents trading", async () => {
    const stale = { ...asset, quoteStatus: "STALE" as const };
    render(<GameProvider api={api({ getGame: vi.fn().mockResolvedValue(account({ assets: [stale] })) })}><ProductCard {...props} /></GameProvider>);
    await screen.findByText(/价格过期|Stale price/);
    expect(screen.getByText(/2026-07-18/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Buy" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "All-in" })).toBeDisabled();
  });

  it("keeps the ticket open, disables duplicate submission, and leaves API errors visible", async () => {
    let reject!: (error: unknown) => void;
    const request = new Promise<AccountProjection>((_, no) => { reject = no; });
    const client = api({ submitTrade: vi.fn().mockReturnValue(request) });
    const onOpenTicket = vi.fn();
    const view = render(<GameProvider api={client}><ProductCard {...props} activeSide="buy" onOpenTicket={onOpenTicket} /></GameProvider>);
    const confirm = await screen.findByRole("button", { name: /确认买入|Confirm buy/ });
    await waitFor(() => expect(confirm).toBeEnabled());
    fireEvent.click(confirm);
    expect(confirm).toBeDisabled();
    await act(async () => reject(Object.assign(new Error("no funds"), { code: "INSUFFICIENT_BALANCE" })));
    expect(screen.getByRole("alert")).toHaveTextContent(/余额不足|Insufficient balance/);
    expect(view.getByRole("button", { name: /确认买入|Confirm buy/ })).toBeInTheDocument();
  });

  it("sends MAX for all-in without deriving a quantity from client cash", async () => {
    const client = api();
    render(<GameProvider api={client}><ProductCard {...props} /></GameProvider>);
    const allIn = await screen.findByRole("button", { name: "All-in" });
    await waitFor(() => expect(allIn).toBeEnabled());
    fireEvent.click(allIn);
    await waitFor(() => expect(client.submitTrade).toHaveBeenCalledWith(expect.objectContaining({ assetId: product.id, side: "BUY", quantity: "MAX" })));
  });
});
