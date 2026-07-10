"use client";

import { memo } from "react";
import type { Product, Locale } from "@/types";
import { labelFrom } from "@/i18n";
import { t } from "@/i18n";
import { SUBCATEGORY_LABELS } from "@/data/categoryLabels";
import { getProductCategory } from "@/data/categories";
import {
  getAssetMark,
  getMarkFontSize,
  getProductName,
  getProductDescription,
} from "@/game/engine";
import { formatCurrency, formatNumber } from "@/game/format";

interface ProductCardProps {
  product: Product;
  price: number;
  owned: number;
  overdraft: boolean;
  currency: string;
  live: boolean;
  selected: boolean;
  liquidated: boolean;
  locale: Locale;
  onBuy: (id: string) => void;
  onMax: (id: string) => void;
  onSell: (id: string) => void;
  onSellAll: (id: string) => void;
}

function ArtMark({ product }: { product: Product }) {
  const mark = getAssetMark(product);
  const accent = product.accent;
  const fontSize = getMarkFontSize(mark);
  return (
    <svg viewBox="0 0 280 150" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width="280" height="150" fill="#ffffff"></rect>
      <path
        d="M0 116 C42 88 78 98 118 70 C164 38 212 54 280 22 L280 150 L0 150 Z"
        fill={accent}
        opacity="0.12"
      ></path>
      <path
        d="M0 126 C72 112 104 131 156 98 C198 72 228 78 280 52 L280 150 L0 150 Z"
        fill={accent}
        opacity="0.2"
      ></path>
      <rect x="57" y="38" width="166" height="66" rx="8" fill="#fff" opacity="0.9"></rect>
      <rect
        x="57"
        y="38"
        width="166"
        height="66"
        rx="8"
        fill="none"
        stroke={accent}
        strokeWidth="2"
        opacity="0.3"
      ></rect>
      <text
        x="140"
        y="70"
        textAnchor="middle"
        dominantBaseline="middle"
        fontFamily="Arial, Helvetica, sans-serif"
        fontWeight="900"
        fontSize={fontSize}
        fill={accent}
        letterSpacing="0"
      >
        {mark}
      </text>
      <path d="M58 126 H222" stroke={accent} strokeWidth="5" strokeLinecap="round" opacity="0.38"></path>
    </svg>
  );
}

function ProductCardBase({
  product,
  price,
  owned,
  overdraft,
  currency,
  live,
  selected,
  liquidated,
  locale,
  onBuy,
  onMax,
  onSell,
  onSellAll,
}: ProductCardProps) {
  const tagLabel = product.subCategory || getProductCategory(product);
  const sourceLabel = live ? t(locale, "livePrice") : t(locale, "stalePrice");

  return (
    <article
      className={`product-card${overdraft ? " overdraft" : ""}${owned ? " owned" : ""}${selected ? " selected" : ""}`}
      style={{ ["--accent" as string]: product.accent }}
      data-product-id={product.id}
    >
      <div className="product-visual">
        <ArtMark product={product} />
        {owned ? <span className="owned-badge">x{formatNumber(owned, locale)}</span> : null}
      </div>
      <div className="product-copy">
        <div className="product-title-row">
          <h3>{getProductName(product, locale)}</h3>
          <span className="tag">{labelFrom(SUBCATEGORY_LABELS, tagLabel, locale)}</span>
        </div>
        <p className="product-desc">{getProductDescription(product, locale)}</p>
        <div className="price-line">
          <strong>{formatCurrency(price, price >= 1_000_000_000)}</strong>
          <span>
            {sourceLabel} · {currency}
          </span>
        </div>
      </div>
      <div className="product-actions">
        <button
          className="buy-button"
          type="button"
          disabled={liquidated}
          onClick={() => onBuy(product.id)}
        >
          {t(locale, "buy")}
        </button>
        <button
          className="max-button"
          type="button"
          disabled={liquidated}
          onClick={() => onMax(product.id)}
        >
          {t(locale, "allIn")}
        </button>
        <button
          className="sell-button"
          type="button"
          disabled={liquidated || !owned}
          onClick={() => onSell(product.id)}
        >
          {t(locale, "sell")}
        </button>
        <button
          className="sell-all-button"
          type="button"
          disabled={liquidated || !owned}
          onClick={() => onSellAll(product.id)}
        >
          {t(locale, "sellAll")}
        </button>
      </div>
    </article>
  );
}

export const ProductCard = memo(ProductCardBase);
