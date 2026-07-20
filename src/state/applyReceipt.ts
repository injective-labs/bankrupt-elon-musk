import type { AccountProjection, MarketProjection, PositionView, TradeReceipt } from "@/types";

const SCALE = 12;
const UNIT = 10n ** BigInt(SCALE);

function fixed(value: string): bigint {
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = (negative ? value.slice(1) : value).split(".");
  const result = BigInt(whole) * UNIT + BigInt((fraction + "0".repeat(SCALE)).slice(0, SCALE));
  return negative ? -result : result;
}

function decimal(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / UNIT;
  const fraction = (absolute % UNIT).toString().padStart(SCALE, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

const multiply = (left: string, right: string) => fixed(left) * fixed(right) / UNIT;

export function applyTradeReceipt(
  account: AccountProjection,
  market: MarketProjection,
  receipt: TradeReceipt,
): AccountProjection {
  const existing = new Map(account.positions.map((position) => [position.assetId, position]));
  if (fixed(receipt.quantityAfter) === 0n) existing.delete(receipt.assetId);
  else existing.set(receipt.assetId, {
    assetId: receipt.assetId,
    quantity: receipt.quantityAfter,
    costBasis: receipt.costBasisAfter,
    marketValue: null,
    unrealizedPnl: null,
  });

  let holdings = 0n;
  const positions: PositionView[] = [...existing.values()].map((position) => {
    const price = market.assets.find((asset) => asset.id === position.assetId)?.usdPrice;
    if (price === null || price === undefined) return position;
    const marketValue = multiply(position.quantity, price);
    holdings += marketValue;
    return {
      ...position,
      marketValue: decimal(marketValue),
      unrealizedPnl: decimal(marketValue - fixed(position.costBasis)),
    };
  });
  const netWorth = fixed(receipt.cashAfter) + holdings;
  return {
    ...account,
    cash: receipt.cashAfter,
    holdingsValue: decimal(holdings),
    netWorth: decimal(netWorth),
    pnl: decimal(netWorth - fixed("50000000000")),
    positions,
    recentTransactions: [{
      id: receipt.id, type: receipt.side, assetId: receipt.assetId, quantity: receipt.quantity,
      usdUnitPrice: receipt.usdUnitPrice, usdAmount: receipt.usdAmount, createdAt: receipt.createdAt,
    }, ...account.recentTransactions.filter((transaction) => transaction.id !== receipt.id)].slice(0, 50),
    updatedAt: receipt.createdAt,
  };
}
