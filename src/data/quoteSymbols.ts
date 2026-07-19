import type { Product } from "@/types";

export function getQuoteSymbol(product: Product): string | null {
  if (Object.prototype.hasOwnProperty.call(product, "quoteSymbol") && product.quoteSymbol === null) return null;
  if (product.quoteSymbol) return product.quoteSymbol;
  const ticker = product.ticker;
  if (!ticker || ticker === "SPACE") return null;
  if (product.subCategory === "加密货币" || product.assetClass === "加密货币") return `${ticker}-USD`;
  return ticker;
}
