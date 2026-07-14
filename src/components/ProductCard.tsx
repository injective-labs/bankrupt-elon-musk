"use client";

import { memo, useState } from "react";
import type { Product, Locale } from "@/types";
import { labelFrom } from "@/i18n";
import { t } from "@/i18n";
import { SUBCATEGORY_LABELS } from "@/data/categoryLabels";
import { getProductCategory } from "@/data/categories";
import { TRADE_FRACTIONS } from "@/data/constants";
import { useGame } from "@/state/GameProvider";
import {
  getAssetMark,
  getMarkFontSize,
  getProductName,
  getProductDescription,
  getProductPrice,
  getUnitLabel,
  getMaxTradeQuantity,
  clampTradeQuantity,
  getFractionTradeQuantity,
  getTradeEstimateText,
  type TradeSide,
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
  activeSide: TradeSide | null;
  onOpenTicket: (id: string, side: TradeSide) => void;
  onCloseTicket: () => void;
  onMax: (id: string) => void;
  onSellAll: (id: string) => void;
}

function TradeTicket({
  product,
  side,
  onClose,
}: {
  product: Product;
  side: TradeSide;
  onClose: () => void;
}) {
  const { state, actions } = useGame();
  const locale = state.locale;
  const maxQuantity = getMaxTradeQuantity(state, product, side);
  const [qty, setQty] = useState(() => (maxQuantity > 0 ? "1" : "0"));

  const price = getProductPrice(state, product);
  const unit = getUnitLabel(product, locale);
  const disabled = maxQuantity <= 0;
  const requested = Math.floor(Number(qty) || 0);
  const confirmDisabled = maxQuantity <= 0 || requested <= 0;

  const sideLabel = side === "buy" ? t(locale, "buyQuantity") : t(locale, "sellQuantity");
  const limitLabel = side === "buy" ? t(locale, "maxBuyable") : t(locale, "maxSellable");
  const fractionHint = side === "buy" ? t(locale, "fractionHintBuy") : t(locale, "fractionHintSell");
  const confirmLabel = side === "buy" ? t(locale, "confirmBuy") : t(locale, "confirmSell");

  const submit = () => {
    const q = clampTradeQuantity(state, product, side, qty);
    if (q <= 0) return;
    if (side === "buy") actions.buyQty(product.id, q);
    else actions.sellQty(product.id, q);
    onClose();
  };

  return (
    <div className="trade-ticket" data-side={side}>
      <div className="trade-ticket-header">
        <strong>{sideLabel}</strong>
        <span>
          {formatCurrency(price, price >= 1_000_000_000)} / {unit}
        </span>
      </div>
      <label className="trade-quantity-field">
        <span className="trade-quantity-row">
          <span>{sideLabel}</span>
          <input
            className="trade-quantity-input"
            type="number"
            min={1}
            max={maxQuantity}
            step={1}
            inputMode="numeric"
            value={qty}
            disabled={disabled}
            aria-label={sideLabel}
            onChange={(e) => setQty(e.target.value)}
            onBlur={() => setQty(String(clampTradeQuantity(state, product, side, qty)))}
          />
        </span>
        <span className="trade-limit">
          {limitLabel} {formatNumber(maxQuantity, locale)} {unit}
        </span>
      </label>
      <div className="trade-fractions" aria-label={fractionHint}>
        {TRADE_FRACTIONS.map((fraction) => {
          const label = `1/${Math.round(1 / fraction)}`;
          return (
            <button
              key={label}
              type="button"
              disabled={disabled}
              title={`${fractionHint} ${label}`}
              onClick={() => setQty(String(getFractionTradeQuantity(state, product, side, fraction)))}
            >
              {label}
            </button>
          );
        })}
      </div>
      <p className="trade-estimate">{getTradeEstimateText(state, product, side, qty)}</p>
      <div className="trade-ticket-actions">
        <button
          className={`trade-confirm-button ${side}`}
          type="button"
          disabled={confirmDisabled}
          onClick={submit}
        >
          {confirmLabel}
        </button>
        <button className="trade-cancel-button" type="button" onClick={onClose}>
          {t(locale, "cancel")}
        </button>
      </div>
    </div>
  );
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
      <text
        x="142"
        y="73"
        textAnchor="middle"
        dominantBaseline="middle"
        fontFamily="Inter, Arial, Helvetica, sans-serif"
        fontWeight="900"
        fontSize={fontSize}
        fill="#0f172a"
        opacity="0.18"
        letterSpacing="0"
      >
        {mark}
      </text>
      <text
        x="140"
        y="70"
        textAnchor="middle"
        dominantBaseline="middle"
        fontFamily="Inter, Arial, Helvetica, sans-serif"
        fontWeight="900"
        fontSize={fontSize}
        fill="#ffffff"
        stroke="#ffffff"
        strokeWidth="8"
        strokeLinejoin="round"
        letterSpacing="0"
      >
        {mark}
      </text>
      <text
        x="140"
        y="70"
        textAnchor="middle"
        dominantBaseline="middle"
        fontFamily="Inter, Arial, Helvetica, sans-serif"
        fontWeight="900"
        fontSize={fontSize}
        fill={accent}
        stroke="#182033"
        strokeWidth="0.9"
        strokeLinejoin="round"
        paintOrder="stroke fill"
        letterSpacing="0"
      >
        {mark}
      </text>
      <path d="M96 105 H184" stroke={accent} strokeWidth="4.5" strokeLinecap="round" opacity="0.5"></path>
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
  activeSide,
  onOpenTicket,
  onCloseTicket,
  onMax,
  onSellAll,
}: ProductCardProps) {
  const tagLabel = product.subCategory || getProductCategory(product);
  const sourceLabel = live ? t(locale, "livePrice") : t(locale, "stalePrice");

  return (
    <article
      className={`product-card${overdraft ? " overdraft" : ""}${owned ? " owned" : ""}${selected ? " selected" : ""}${activeSide ? " has-trade-ticket" : ""}`}
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
          onClick={() => onOpenTicket(product.id, "buy")}
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
          onClick={() => onOpenTicket(product.id, "sell")}
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
      {activeSide && (
        <TradeTicket product={product} side={activeSide} onClose={onCloseTicket} />
      )}
    </article>
  );
}

export const ProductCard = memo(ProductCardBase);
