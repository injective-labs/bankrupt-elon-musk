import type { Product } from "@/types";
import { products } from "./expandedAssets";
import { ALL_SUBCATEGORY } from "./categoryLabels";

export { ALL_SUBCATEGORY } from "./categoryLabels";
export { CATEGORY_LABELS, SUBCATEGORY_LABELS } from "./categoryLabels";

export function isInvestmentProduct(product: Product): boolean {
  return product.category === "金融" || product.investment === true;
}

export function getInvestmentProducts(): Product[] {
  return products.filter(isInvestmentProduct);
}

export function getProductCategory(product: Product): string {
  if (product.assetClass) return product.assetClass;
  if (product.subCategory === "加密货币") return "加密货币";
  if (["美国国债", "公司债", "可转债"].includes(product.subCategory || "")) return "债券";
  if (["指数 ETF"].includes(product.subCategory || "")) return "ETF";
  if (product.ticker === "SPACE") return "私募";
  return "美股";
}

export const categories: string[] = [
  "全部",
  ...Array.from(new Set(getInvestmentProducts().map((product) => getProductCategory(product)))),
];

export function getSubcategoriesForCategory(category: string): string[] {
  const subcategories = getInvestmentProducts()
    .filter(
      (product) =>
        category !== "全部" && getProductCategory(product) === category && product.subCategory,
    )
    .map((product) => product.subCategory as string);
  return [ALL_SUBCATEGORY, ...Array.from(new Set(subcategories))];
}
