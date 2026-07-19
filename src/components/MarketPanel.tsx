"use client";
import { useCallback, useMemo, useState } from "react";
import type { Product, SortMode } from "@/types";
import type { TradeSide } from "@/game/engine";
import { useGame } from "@/state/GameProvider";
import { productById } from "@/data/expandedAssets";
import { t, labelFrom } from "@/i18n";
import { CATEGORY_LABELS, SUBCATEGORY_LABELS } from "@/data/categoryLabels";
import { ALL_SUBCATEGORY } from "@/data/categories";
import { ProductCard } from "./ProductCard";

const fallbackProduct = (asset: NonNullable<ReturnType<typeof useGame>["account"]>["assets"][number]): Product => {
  const visual = productById.get(asset.id);
  return { ...(visual ?? { id: asset.id, category: "金融", price: 0, unit: asset.unit, icon: "", accent: "#536078", description: asset.name, descriptionEn: asset.nameEn ?? asset.name }), id: asset.id, name: asset.name, nameEn: asset.nameEn ?? undefined, assetClass: asset.category, subCategory: asset.subCategory ?? undefined, ticker: asset.ticker, currency: asset.currency, unit: asset.unit, unitEn: asset.unitEn ?? undefined };
};

export function MarketPanel() {
  const { state, account, actions, focusedProductId } = useGame();
  const locale = state.locale;
  const held = useMemo(() => new Set((account?.positions ?? []).filter((p) => p.quantity !== "0").map((p) => p.assetId)), [account?.positions]);
  const products = useMemo(() => (account?.assets ?? []).filter((a) => a.enabled || held.has(a.id)).map((asset) => ({ asset, product: fallbackProduct(asset) })), [account?.assets, held]);
  const categories = ["全部", ...Array.from(new Set(products.map(({ asset }) => asset.category)))];
  const subcategories = [ALL_SUBCATEGORY, ...Array.from(new Set(products.filter(({ asset }) => state.selectedCategory !== "全部" && asset.category === state.selectedCategory).map(({ asset }) => asset.subCategory).filter((v): v is string => Boolean(v))))];
  const visible = useMemo(() => products.filter(({ asset, product }) => {
    const term = state.search.trim().toLowerCase();
    return (state.selectedCategory === "全部" || asset.category === state.selectedCategory) && (state.selectedSubcategory === ALL_SUBCATEGORY || asset.subCategory === state.selectedSubcategory) && (!term || `${asset.name} ${asset.nameEn ?? ""} ${asset.ticker} ${asset.category} ${asset.subCategory ?? ""} ${product.description} ${product.descriptionEn ?? ""}`.toLowerCase().includes(term));
  }).sort((a, b) => state.sort === "owned" ? Number(held.has(b.asset.id)) - Number(held.has(a.asset.id)) || a.asset.displayOrder - b.asset.displayOrder : state.sort === "price-desc" ? Number(b.asset.usdPrice ?? 0) - Number(a.asset.usdPrice ?? 0) : Number(a.asset.usdPrice ?? 0) - Number(b.asset.usdPrice ?? 0)), [products, state.search, state.selectedCategory, state.selectedSubcategory, state.sort, held]);
  const [activeTrade, setActiveTrade] = useState<{ id: string; side: TradeSide } | null>(null);
  const openTicket = useCallback((id: string, side: TradeSide) => setActiveTrade({ id, side }), []);
  return <section className="market-panel" aria-labelledby="marketTitle">
    <div className="market-toolbar"><div><p className="eyebrow">Market</p><h2 id="marketTitle">{t(locale, "market")}</h2></div><label className="search-box" htmlFor="searchInput"><span aria-hidden="true">⌕</span><input id="searchInput" type="search" placeholder={t(locale, "search")} value={state.search} onChange={(e) => actions.setSearch(e.target.value)} /></label></div>
    <div className="category-tabs" role="tablist" aria-label={t(locale, "assetCategories")}>{categories.map((category) => <button key={category} className="category-tab" type="button" role="tab" aria-selected={state.selectedCategory === category} onClick={() => actions.setCategory(category)}>{labelFrom(CATEGORY_LABELS, category, locale)}</button>)}</div>
    {subcategories.length > 1 && <div className="subcategory-tabs" role="tablist" aria-label={t(locale, "subcategories")}>{subcategories.map((subcategory) => <button key={subcategory} className="subcategory-tab" type="button" role="tab" aria-selected={state.selectedSubcategory === subcategory} onClick={() => actions.setSubcategory(subcategory)}>{labelFrom(SUBCATEGORY_LABELS, subcategory, locale)}</button>)}</div>}
    <div className="market-meta"><span>{visible.length} {t(locale, "items")}</span><label className="sort-control" htmlFor="sortSelect"><span>{t(locale, "sort")}</span><select id="sortSelect" value={state.sort} onChange={(e) => actions.setSort(e.target.value as SortMode)}><option value="price-asc">{t(locale, "priceAsc")}</option><option value="price-desc">{t(locale, "priceDesc")}</option><option value="owned">{t(locale, "owned")}</option></select></label></div>
    <div className="product-grid">{visible.map(({ asset, product }) => <ProductCard key={asset.id} product={product} price={0} owned={0} overdraft={false} currency={asset.currency} live={asset.quoteStatus === "ACTIVE"} selected={focusedProductId === asset.id} liquidated={false} locale={locale} activeSide={activeTrade?.id === asset.id ? activeTrade.side : null} onOpenTicket={openTicket} onCloseTicket={() => setActiveTrade(null)} />)}</div>
  </section>;
}
