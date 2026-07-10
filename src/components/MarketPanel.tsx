"use client";

import { useMemo } from "react";
import type { GameState, Product, SortMode } from "@/types";
import { useGame } from "@/state/GameProvider";
import { t, labelFrom } from "@/i18n";
import { CATEGORY_LABELS, SUBCATEGORY_LABELS } from "@/data/categoryLabels";
import {
  categories,
  getInvestmentProducts,
  getProductCategory,
  getSubcategoriesForCategory,
  ALL_SUBCATEGORY,
} from "@/data/categories";
import {
  getBalance,
  getProductPrice,
  getProductCurrency,
  getPositionQuantity,
} from "@/game/engine";
import { ProductCard } from "./ProductCard";

function getVisibleProducts(state: GameState): Product[] {
  const term = state.search.trim().toLowerCase();
  let visible = getInvestmentProducts().filter((product) => {
    const matchesCategory =
      state.selectedCategory === "全部" || getProductCategory(product) === state.selectedCategory;
    const matchesSubcategory =
      state.selectedSubcategory === ALL_SUBCATEGORY ||
      product.subCategory === state.selectedSubcategory;
    const searchText =
      `${product.name} ${product.nameEn || ""} ${product.category} ${product.subCategory || ""} ${product.ticker || ""} ${product.description} ${product.descriptionEn || ""}`.toLowerCase();
    return matchesCategory && matchesSubcategory && (!term || searchText.includes(term));
  });

  if (state.sort === "price-asc") {
    visible = [...visible].sort((a, b) => getProductPrice(state, a) - getProductPrice(state, b));
  }
  if (state.sort === "price-desc") {
    visible = [...visible].sort((a, b) => getProductPrice(state, b) - getProductPrice(state, a));
  }
  if (state.sort === "owned") {
    visible = [...visible].sort((a, b) => {
      const ownedDiff =
        getPositionQuantity(state.inventory[b.id]) - getPositionQuantity(state.inventory[a.id]);
      return ownedDiff || getProductPrice(state, a) - getProductPrice(state, b);
    });
  }

  return visible;
}

export function MarketPanel() {
  const { state, actions, focusedProductId } = useGame();
  const locale = state.locale;

  const visible = useMemo(() => getVisibleProducts(state), [state]);
  const subcategories = getSubcategoriesForCategory(state.selectedCategory);
  const balance = getBalance(state);

  return (
    <section className="market-panel" aria-labelledby="marketTitle">
      <div className="market-toolbar">
        <div>
          <p className="eyebrow">Market</p>
          <h2 id="marketTitle">{t(locale, "market")}</h2>
        </div>
        <label className="search-box" htmlFor="searchInput">
          <span aria-hidden="true">⌕</span>
          <input
            id="searchInput"
            type="search"
            placeholder={t(locale, "search")}
            autoComplete="off"
            value={state.search}
            onChange={(e) => actions.setSearch(e.target.value)}
          />
        </label>
      </div>

      <div className="category-tabs" role="tablist" aria-label={t(locale, "assetCategories")}>
        {categories.map((category) => (
          <button
            key={category}
            className="category-tab"
            type="button"
            role="tab"
            aria-selected={state.selectedCategory === category}
            onClick={() => actions.setCategory(category)}
          >
            {labelFrom(CATEGORY_LABELS, category, locale)}
          </button>
        ))}
      </div>

      {subcategories.length > 1 && (
        <div className="subcategory-tabs" role="tablist" aria-label={t(locale, "subcategories")}>
          {subcategories.map((subcategory) => (
            <button
              key={subcategory}
              className="subcategory-tab"
              type="button"
              role="tab"
              aria-selected={state.selectedSubcategory === subcategory}
              onClick={() => actions.setSubcategory(subcategory)}
            >
              {labelFrom(SUBCATEGORY_LABELS, subcategory, locale)}
            </button>
          ))}
        </div>
      )}

      <div className="market-meta">
        <span>
          {visible.length} {t(locale, "items")}
        </span>
        <label className="sort-control" htmlFor="sortSelect">
          <span>{t(locale, "sort")}</span>
          <select
            id="sortSelect"
            value={state.sort}
            onChange={(e) => actions.setSort(e.target.value as SortMode)}
          >
            <option value="featured">{t(locale, "featured")}</option>
            <option value="price-asc">{t(locale, "priceAsc")}</option>
            <option value="price-desc">{t(locale, "priceDesc")}</option>
            <option value="owned">{t(locale, "owned")}</option>
          </select>
        </label>
      </div>

      <div className="product-grid">
        {visible.map((product) => {
          const price = getProductPrice(state, product);
          const owned = getPositionQuantity(state.inventory[product.id]);
          const margin = price / state.leverage;
          return (
            <ProductCard
              key={product.id}
              product={product}
              price={price}
              owned={owned}
              overdraft={margin > balance}
              currency={getProductCurrency(state, product)}
              live={Boolean(state.prices?.[product.id])}
              selected={focusedProductId === product.id}
              liquidated={state.liquidated}
              locale={locale}
              onBuy={actions.buy}
              onMax={actions.buyMax}
              onSell={actions.sell}
              onSellAll={actions.sellAll}
            />
          );
        })}
      </div>
    </section>
  );
}
