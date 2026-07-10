import type { Product } from "@/types";
import { baseProducts } from "./products";
import {
  MARKET_ACCENTS,
  ASSET_CLASS_SLUGS,
  US_EQUITY_GROUPS,
  HK_EQUITY_GROUPS,
  A_SHARE_GROUPS,
  KOREA_EQUITY_GROUPS,
  TAIWAN_EQUITY_GROUPS,
  JAPAN_EQUITY_GROUPS,
  EUROPE_EQUITY_GROUPS,
  MARKET_NAME_OVERRIDES,
  CRYPTO_ASSETS,
  PRECIOUS_METAL_ASSETS,
  COMMODITY_ASSETS,
} from "./marketGroups";
import { CATEGORY_LABELS, SUBCATEGORY_LABELS } from "./categoryLabels";
import { ASSET_NAMES } from "./assetNames";

// English equivalents for the (Chinese) asset-class / subcategory names, so the
// English fallbacks for generated assets never leak Chinese.
const assetClassEn = (zh: string): string => CATEGORY_LABELS[zh]?.en || zh;
const subCategoryEn = (zh: string): string => SUBCATEGORY_LABELS[zh]?.en || zh;

// --- Helpers (ported verbatim from script.js) ---

function splitTickers(tickers: string): string[] {
  return tickers.trim().split(/\s+/).filter(Boolean);
}

function normalizeAssetId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function getAssetClassSlug(assetClass: string): string {
  return ASSET_CLASS_SLUGS[assetClass] || normalizeAssetId(assetClass) || "asset";
}

function getMarketNameOverride(ticker: string): { zh: string; en: string } | null {
  const strippedTicker = ticker.replace(/[-.].*$/, "");
  const candidates = [ticker, strippedTicker];
  if (/^\d+$/.test(strippedTicker)) {
    candidates.push(strippedTicker.padStart(4, "0"));
    candidates.push(`${strippedTicker.padStart(4, "0")}.HK`);
  }
  const match = candidates.map((candidate) => MARKET_NAME_OVERRIDES[candidate]).find(Boolean);
  return match ? { zh: match[0], en: match[1] } : null;
}

function inferAssetClass(product: Partial<Product>): string {
  if (product.assetClass) return product.assetClass;
  if (product.subCategory === "加密货币") return "加密货币";
  if (["美国国债", "公司债", "可转债"].includes(product.subCategory || "")) return "债券";
  if (["指数 ETF"].includes(product.subCategory || "")) return "ETF";
  if (product.ticker === "SPACE") return "私募";
  return product.category === "金融" ? "美股" : product.category || "美股";
}

export function getAssetDedupeKey(product: Partial<Product>): string {
  return `${inferAssetClass(product)}:${product.ticker || product.id}`;
}

function inferCurrencyFromTicker(ticker: string, fallbackCurrency?: string): string {
  if (fallbackCurrency) return fallbackCurrency;
  if (ticker.endsWith(".HK")) return "HKD";
  if (ticker.endsWith(".SS") || ticker.endsWith(".SZ")) return "CNY";
  if (ticker.endsWith(".KS")) return "KRW";
  if (ticker.endsWith(".TW")) return "TWD";
  if (ticker.endsWith(".T")) return "JPY";
  if (ticker.endsWith(".CO")) return "DKK";
  if (ticker.endsWith(".SW")) return "CHF";
  if (ticker.endsWith(".L")) return "GBp";
  if (
    ticker.endsWith(".DE") ||
    ticker.endsWith(".PA") ||
    ticker.endsWith(".MI") ||
    ticker.endsWith(".MC") ||
    ticker.endsWith(".AS")
  ) {
    return "EUR";
  }
  return "USD";
}

interface CreateMarketAssetArgs {
  ticker: string;
  name?: string;
  nameEn?: string;
  assetClass: string;
  subCategory: string;
  currency?: string;
  price?: number;
  unit?: string;
  unitEn?: string;
  prefix?: string;
  mark?: string;
  quoteSymbol?: string | null;
  description?: string;
  descriptionEn?: string;
  index?: number;
}

function createMarketAsset({
  ticker,
  name,
  nameEn,
  assetClass,
  subCategory,
  currency,
  price = 100,
  unit = "股",
  unitEn = "share",
  prefix,
  mark,
  quoteSymbol,
  description,
  descriptionEn,
  index = 0,
}: CreateMarketAssetArgs): Product {
  const shortTicker = ticker.replace(/[-.].*$/, "");
  const label = name || `${shortTicker} ${prefix || assetClass}`;
  return {
    id: `${getAssetClassSlug(assetClass)}-${normalizeAssetId(ticker)}`,
    name: label,
    nameEn: nameEn || `${shortTicker} · ${assetClassEn(assetClass)}`,
    category: "金融",
    subCategory,
    assetClass,
    ticker,
    quoteSymbol,
    mark: mark || shortTicker,
    currency: inferCurrencyFromTicker(ticker, currency),
    price,
    unit,
    unitEn,
    icon: mark || shortTicker,
    accent: MARKET_ACCENTS[index % MARKET_ACCENTS.length],
    description: description || `${assetClass} · ${subCategory} · ${ticker}`,
    descriptionEn:
      descriptionEn || `${assetClassEn(assetClass)} ${subCategoryEn(subCategory)} exposure: ${ticker}.`,
  };
}

interface BuildTickerGroupArgs {
  groups: [string, string][];
  assetClass: string;
  currency?: string;
  prefix: string;
  price: number;
  unit?: string;
  unitEn?: string;
}

function buildTickerGroupAssets({
  groups,
  assetClass,
  currency,
  prefix,
  price,
  unit = "股",
  unitEn = "share",
}: BuildTickerGroupArgs): Product[] {
  const assets: Product[] = [];
  groups.forEach(([subCategory, tickers], groupIndex) => {
    splitTickers(tickers).forEach((ticker, tickerIndex) => {
      const shortTicker = ticker.replace(/[-.].*$/, "");
      const override = getMarketNameOverride(ticker);
      assets.push(
        createMarketAsset({
          ticker,
          name: override?.zh || `${shortTicker} ${prefix}`,
          // Let createMarketAsset apply the fully-English fallback when there's no override.
          nameEn: override?.en,
          assetClass,
          subCategory,
          currency,
          prefix,
          price,
          unit,
          unitEn,
          index: groupIndex * 37 + tickerIndex,
        }),
      );
    });
  });
  return assets;
}

const expandedMarketAssets: Product[] = [
  ...CRYPTO_ASSETS.map(([ticker, name, nameEn, price], index) =>
    createMarketAsset({
      ticker,
      name,
      nameEn,
      assetClass: "加密货币",
      subCategory: "加密货币",
      currency: "USD",
      price,
      unit: "枚",
      unitEn: "coin",
      mark: ticker,
      index,
      description: `${ticker} 加密货币仓位，按美元收盘价同步。`,
      descriptionEn: `${nameEn} crypto exposure synced from USD close data.`,
    }),
  ),
  ...buildTickerGroupAssets({
    groups: US_EQUITY_GROUPS,
    assetClass: "美股",
    currency: "USD",
    prefix: "美股",
    price: 120,
  }),
  ...buildTickerGroupAssets({
    groups: HK_EQUITY_GROUPS,
    assetClass: "港股",
    currency: "HKD",
    prefix: "港股",
    price: 50,
  }).map((asset) => ({
    ...asset,
    ticker: (asset.ticker || "").padStart(4, "0") + ".HK",
    mark: (asset.ticker || "").padStart(4, "0"),
  })),
  ...buildTickerGroupAssets({
    groups: A_SHARE_GROUPS,
    assetClass: "A股",
    currency: "CNY",
    prefix: "A 股",
    price: 35,
  }),
  ...buildTickerGroupAssets({
    groups: KOREA_EQUITY_GROUPS,
    assetClass: "韩股",
    currency: "KRW",
    prefix: "韩股",
    price: 80_000,
  }),
  ...buildTickerGroupAssets({
    groups: TAIWAN_EQUITY_GROUPS,
    assetClass: "台股",
    currency: "TWD",
    prefix: "台股",
    price: 300,
  }),
  ...buildTickerGroupAssets({
    groups: JAPAN_EQUITY_GROUPS,
    assetClass: "日股",
    currency: "JPY",
    prefix: "日股",
    price: 4_000,
  }),
  ...buildTickerGroupAssets({
    groups: EUROPE_EQUITY_GROUPS,
    assetClass: "欧股",
    prefix: "欧股",
    price: 120,
  }),
  ...PRECIOUS_METAL_ASSETS.map(([ticker, name, nameEn, subCategory, mark, price], index) =>
    createMarketAsset({
      ticker,
      name,
      nameEn,
      assetClass: "贵金属",
      subCategory,
      currency: "USD",
      price,
      unit: "份",
      unitEn: "share",
      mark,
      index,
      description: `${subCategory}价格代理资产，按收盘价同步。`,
      descriptionEn: `${subCategoryEn(subCategory)} price proxy synced from close data.`,
    }),
  ),
  ...COMMODITY_ASSETS.map(([ticker, name, nameEn, subCategory, mark, price], index) =>
    createMarketAsset({
      ticker,
      name,
      nameEn,
      assetClass: "大宗商品",
      subCategory,
      currency: "USD",
      price,
      unit: "份",
      unitEn: "share",
      mark,
      index,
      description: `${subCategory}大宗商品代理资产，按收盘价同步。`,
      descriptionEn: `${subCategoryEn(subCategory)} commodity proxy synced from close data.`,
    }),
  ),
];

// Enrich generated assets with real names fetched from Yahoo (keyed by final ticker).
// Falls back silently to the "TICKER · <class>" English name when absent.
expandedMarketAssets.forEach((asset) => {
  const real = asset.ticker ? ASSET_NAMES[asset.ticker] : undefined;
  if (real?.en) asset.nameEn = real.en;
  if (real?.zh) asset.name = real.zh;
});

// Merge: start from the base catalog, append unique expanded assets.
export const products: Product[] = [...baseProducts];
const existingAssetKeys = new Set(products.map(getAssetDedupeKey));
expandedMarketAssets.forEach((asset) => {
  const key = getAssetDedupeKey(asset);
  if (!existingAssetKeys.has(key)) {
    products.push(asset);
    existingAssetKeys.add(key);
  }
});

export const productById = new Map<string, Product>(
  products.map((product) => [product.id, product]),
);
