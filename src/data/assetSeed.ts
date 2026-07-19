import { getInvestmentProducts, getProductCategory } from "./categories";
import { getQuoteSymbol } from "../game/pricing";

export interface AssetSeedRow {
  id: string;
  ticker: string;
  quoteSymbol: string;
  nameZh: string;
  nameEn: string | null;
  assetClass: string;
  subCategory: string | null;
  currency: string;
  unit: string;
  quoteMultiplier: number;
  enabled: boolean;
  displayOrder: number;
}

export function buildAssetSeed(): AssetSeedRow[] {
  const products = getInvestmentProducts();
  const ids = new Set<string>();

  return products.map((product, displayOrder) => {
    const id = product.id?.trim();
    const ticker = product.ticker?.trim();
    const currency = (product.currency ?? "USD").trim();
    const quoteSymbol = getQuoteSymbol(product)?.trim();

    if (!id || ids.has(id)) {
      throw new Error(`Asset catalogue contains a missing or duplicate ID: ${id || "<empty>"}`);
    }
    if (!ticker) throw new Error(`Asset ${id} is missing a ticker`);
    if (!currency) throw new Error(`Asset ${id} is missing a currency`);
    if (!quoteSymbol) throw new Error(`Asset ${id} is missing a Yahoo quote symbol`);
    ids.add(id);

    return {
      id,
      ticker,
      quoteSymbol,
      nameZh: product.name,
      nameEn: product.nameEn ?? null,
      assetClass: getProductCategory(product),
      subCategory: product.subCategory ?? null,
      currency,
      unit: product.unit,
      quoteMultiplier: product.quoteMultiplier ?? 1,
      enabled: true,
      displayOrder,
    };
  });
}
