import type { Locale, Product } from "@/types";
import { isInvestmentProduct } from "@/data/categories";
import { t } from "@/i18n";
import { formatDecimalCurrency, formatDecimalNumber, multiplyDecimalByInteger } from "./format";

export type TradeSide = "buy" | "sell";

export const getProductName = (product: Product, locale: Locale) => locale === "en" ? product.nameEn || product.ticker || product.name : product.name;
export const getProductDescription = (product: Product, locale: Locale) => locale === "en" ? product.descriptionEn || product.description : product.description;
export const getUnitLabel = (product: Product, locale: Locale) => locale === "en" ? product.unitEn || "unit" : product.unit;

export function getAssetMark(product: Product): string {
  if (!isInvestmentProduct(product)) return product.icon;
  if (product.subCategory === "加密货币") return product.ticker || product.icon;
  if (product.ticker) return product.ticker.replace(/[-.].*$/, "");
  if (product.nameEn) return product.nameEn.replace(/[^A-Za-z0-9]/g, "").slice(0, 6).toUpperCase();
  return product.name.slice(0, 4);
}

export function getMarkFontSize(mark: string): number {
  if (mark.length <= 1) return 48;
  if (mark.length <= 3) return 36;
  if (mark.length <= 5) return 28;
  return 22;
}

export function getTradeEstimateText(locale: Locale, price: string, side: TradeSide, quantity: string, maximum: string): string {
  if (!/^[1-9]\d*$/.test(quantity) || BigInt(quantity) > BigInt(maximum || "0")) return side === "buy" ? t(locale, "insufficientCash") : t(locale, "noPosition");
  const total = multiplyDecimalByInteger(price, quantity);
  if (side === "buy") return `${t(locale, "estimatedCost")} ${formatDecimalCurrency(total)}`;
  const remaining = BigInt(maximum || "0") - BigInt(quantity);
  return `${t(locale, "estimatedProceeds")} ${formatDecimalCurrency(total)} · ${t(locale, "remainingAfterSell")} ${formatDecimalNumber(remaining.toString(), locale, 0)}`;
}
