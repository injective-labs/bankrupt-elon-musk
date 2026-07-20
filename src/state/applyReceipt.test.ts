import { describe, expect, it } from "vitest";
import { applyTradeReceipt } from "./applyReceipt";

describe("applyTradeReceipt", () => {
  it("updates only the traded position and exact account totals", () => {
    const account = {
      walletAddress: "0x1", cash: "100", holdingsValue: "0", netWorth: "100", pnl: "-49999999900",
      positions: [], assets: [], recentTransactions: [], marketAsOf: null,
      settlementLocked: false, resetEnabled: false, updatedAt: "2026-07-20T00:00:00.000Z",
    };
    const market = { assets: [{ id: "a", usdPrice: "2.5" }], marketAsOf: null };
    const receipt = {
      id: "1", idempotencyKey: "k", side: "BUY" as const, assetId: "a", requestedQuantity: "2",
      quantity: "2", usdUnitPrice: "2.5", usdAmount: "5", cashBefore: "100", cashAfter: "95",
      quantityBefore: "0", quantityAfter: "2", costBasisBefore: "0", costBasisAfter: "5",
      marketDate: "2026-07-20T00:00:00.000Z", createdAt: "2026-07-20T00:00:01.000Z",
    };
    expect(applyTradeReceipt(account, market as never, receipt)).toMatchObject({
      cash: "95", holdingsValue: "5", netWorth: "100", pnl: "-49999999900",
      positions: [{ assetId: "a", quantity: "2", costBasis: "5", marketValue: "5", unrealizedPnl: "0" }],
    });
  });
});
