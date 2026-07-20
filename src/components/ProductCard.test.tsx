// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccountProjection } from "@/types";
import { GameProvider, type GameApi } from "@/state/GameProvider";
import { productById } from "@/data/expandedAssets";
import { ProductCard } from "./ProductCard";

const beginLogin = vi.fn().mockResolvedValue(true);
vi.mock("@/wallet/useInjPassLogin", () => ({
  useInjPassLogin: () => ({ beginLogin, busy: false, error: null }),
}));

const product = [...productById.values()][0];
const asset = { id: product.id, name: product.name, nameEn: product.nameEn, category: product.assetClass || "美股", subCategory: product.subCategory, ticker: product.ticker || product.id, currency: "USD", unit: product.unit, unitEn: product.unitEn, enabled: true, displayOrder: 1, usdPrice: "12.3456789", marketDate: "2026-07-18T00:00:00.000Z", quoteStatus: "ACTIVE" as const };
const account = (overrides: Partial<AccountProjection> = {}): AccountProjection => ({ walletAddress: "0x1", cash: "100", holdingsValue: "0", netWorth: "100", pnl: "0", positions: [], assets: [asset], recentTransactions: [], marketAsOf: asset.marketDate, settlementLocked: false, resetEnabled: false, updatedAt: "2026-07-19T00:00:00.000Z", ...overrides });
const api = (overrides: Partial<GameApi> = {}): GameApi => ({ getSession: vi.fn().mockResolvedValue({ walletAddress: "0x1", walletName: null }), getMarket: vi.fn().mockResolvedValue({ assets: account().assets, marketAsOf: account().marketAsOf }), loginWithSignature: vi.fn(), logout: vi.fn(), getGame: vi.fn().mockResolvedValue(account()), submitTrade: vi.fn().mockResolvedValue(account()), resetGame: vi.fn(), getTransactions: vi.fn(), getLeaderboard: vi.fn().mockResolvedValue({ top: [], total: 0, you: null }), ...overrides });
const props = { product, price: Number(asset.usdPrice), owned: 0, overdraft: false, currency: "USD", live: true, selected: false, locale: "en" as const, activeSide: null, onOpenTicket: vi.fn(), onCloseTicket: vi.fn() };

describe("ProductCard authoritative trading states", () => {
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

  it("routes every signed-out trade intent to login without opening a ticket or trading", async () => {
    const client = api({ getSession: vi.fn().mockResolvedValue(null) });
    const onOpenTicket = vi.fn();
    render(<GameProvider api={client}><ProductCard {...props} onOpenTicket={onOpenTicket} /></GameProvider>);
    const buttons = await Promise.all(["Buy", "All-in", "Sell", "Close"].map(async (name) => screen.findByRole("button", { name })));
    buttons.forEach((button) => {
      expect(button).toBeEnabled();
      fireEvent.click(button);
    });
    expect(beginLogin).toHaveBeenCalledTimes(4);
    expect(onOpenTicket).not.toHaveBeenCalled();
    expect(client.submitTrade).not.toHaveBeenCalled();
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
    await act(async () => reject(Object.assign(new Error("no funds"), { code: "INSUFFICIENT_CASH" })));
    expect(screen.getByRole("alert")).toHaveTextContent(/余额不足|Insufficient cash/);
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

  it("submits an explicit integer beyond Number.MAX_SAFE_INTEGER unchanged", async () => {
    const hugeAsset = { ...asset, usdPrice: "1" };
    const client = api({ getGame: vi.fn().mockResolvedValue(account({ cash: "9007199254740994", assets: [hugeAsset] })) });
    render(<GameProvider api={client}><ProductCard {...props} activeSide="buy" /></GameProvider>);
    const input = await screen.findByRole("spinbutton", { name: /买入数量|Buy quantity/ });
    fireEvent.change(input, { target: { value: "9007199254740993" } });
    fireEvent.click(screen.getByRole("button", { name: /确认买入|Confirm buy/ }));
    await waitFor(() => expect(client.submitTrade).toHaveBeenCalledWith(expect.objectContaining({ quantity: "9007199254740993" })));
  });

  it("uses safe generic copy for an unknown backend code", async () => {
    const client = api({ submitTrade: vi.fn().mockRejectedValue(Object.assign(new Error("secret"), { code: "SECRET_RAW_CODE" })) });
    render(<GameProvider api={client}><ProductCard {...props} activeSide="buy" /></GameProvider>);
    const confirm = await screen.findByRole("button", { name: /确认买入|Confirm buy/ });
    await waitFor(() => expect(confirm).toBeEnabled());
    fireEvent.click(confirm);
    expect(await screen.findByRole("alert")).toHaveTextContent(/请求失败|Request failed/);
    expect(screen.getByRole("alert")).not.toHaveTextContent("SECRET_RAW_CODE");
  });

  it("uses exact BigInt fractions for a large buy limit", async () => {
    const hugeAsset = { ...asset, usdPrice: "1" };
    const client = api({ getGame: vi.fn().mockResolvedValue(account({ cash: "9007199254740994", assets: [hugeAsset] })) });
    render(<GameProvider api={client}><ProductCard {...props} activeSide="buy" /></GameProvider>);
    const fraction = await screen.findByRole("button", { name: "1/4" });
    fireEvent.click(fraction);
    fireEvent.click(screen.getByRole("button", { name: /确认买入|Confirm buy/ }));
    await waitFor(() => expect(client.submitTrade).toHaveBeenCalledWith(expect.objectContaining({ quantity: "2251799813685248" })));
  });

  it("disables trading when the live clock crosses into settlement after load", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-20T08:59:59.000Z"));
    const client = api();
    render(<GameProvider api={client}><ProductCard {...props} /></GameProvider>);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const buy = screen.getByRole("button", { name: "Buy" });
    expect(buy).toBeEnabled();
    act(() => vi.advanceTimersByTime(1000));
    expect(buy).toBeDisabled();
  });

  it("disables an ACTIVE quote when it crosses from seven to eight UTC calendar days", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-20T23:59:59.000Z"));
    const dated = { ...asset, marketDate: "2026-07-13T00:00:00.000Z" };
    const client = api({ getGame: vi.fn().mockResolvedValue(account({ assets: [dated] })) });
    render(<GameProvider api={client}><ProductCard {...props} /></GameProvider>);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const buy = screen.getByRole("button", { name: "Buy" });
    expect(buy).toBeEnabled();
    act(() => vi.advanceTimersByTime(1000));
    expect(buy).toBeDisabled();
    expect(screen.getByText(/价格过期|Stale price/)).toBeInTheDocument();
  });
});
