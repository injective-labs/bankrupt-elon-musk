"use client";

import { memo, useEffect, useState } from "react";
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
  getUnitLabel,
  getMaxTradeQuantity,
  clampTradeQuantity,
  getFractionTradeQuantity,
  getTradeEstimateText,
  type TradeSide,
} from "@/game/engine";
import { formatDecimalCurrency, formatDecimalNumber } from "@/game/format";

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
  const { state, account, authStatus, actions, pendingCommand, lastError } = useGame();
  const locale = state.locale;
  const asset = account?.assets.find((item) => item.id === product.id);
  const position = account?.positions.find((item) => item.assetId === product.id);
  const maxQuantity = side === "sell" ? Number(position?.quantity ?? "0") : getMaxTradeQuantity(state, product, side);
  const [qty, setQty] = useState(() => (maxQuantity > 0 ? "1" : "0"));
  useEffect(() => { if (maxQuantity > 0 && qty === "0") setQty("1"); }, [maxQuantity, qty]);

  const unit = getUnitLabel(product, locale);
  const unavailable = authStatus !== "authenticated" || !asset?.enabled || asset.quoteStatus !== "ACTIVE" || asset.usdPrice === null || account?.settlementLocked;
  const disabled = unavailable || maxQuantity <= 0 || pendingCommand !== null;
  const requested = Math.floor(Number(qty) || 0);
  const confirmDisabled = disabled || requested <= 0;

  const sideLabel = side === "buy" ? t(locale, "buyQuantity") : t(locale, "sellQuantity");
  const limitLabel = side === "buy" ? t(locale, "maxBuyable") : t(locale, "maxSellable");
  const fractionHint = side === "buy" ? t(locale, "fractionHintBuy") : t(locale, "fractionHintSell");
  const confirmLabel = side === "buy" ? t(locale, "confirmBuy") : t(locale, "confirmSell");

  const submit = () => {
    const q = clampTradeQuantity(state, product, side, qty);
    if (q <= 0) return;
    if (side === "buy") actions.buyQty(product.id, q);
    else actions.sellQty(product.id, q);
  };

  return (
    <div className="trade-ticket" data-side={side}>
      <div className="trade-ticket-header">
        <strong>{sideLabel}</strong>
        <span>
          {asset?.usdPrice ? formatDecimalCurrency(asset.usdPrice) : "$--"} / {unit}
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
          {limitLabel} {formatDecimalNumber(String(maxQuantity), locale)} {unit}
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
      <p className="trade-estimate">{t(locale, "estimateOnly")}: {getTradeEstimateText(state, product, side, qty)}</p>
      {lastError && <p className="trade-error" role="alert">{t(locale, `error.${lastError}`)}</p>}
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
}: ProductCardProps) {
  const { account, authStatus, pendingCommand, actions } = useGame();
  const asset = account?.assets.find((item) => item.id === product.id);
  const authoritativeOwned = account?.positions.find((item) => item.assetId === product.id)?.quantity;
  const quoteStatus = asset?.quoteStatus ?? "MISSING";
  const tradeDisabled = authStatus !== "authenticated" || pendingCommand !== null || account?.settlementLocked || !asset?.enabled || quoteStatus !== "ACTIVE" || asset.usdPrice === null;
  const tagLabel = product.subCategory || getProductCategory(product);
  const sourceLabel = t(locale, `quote.${quoteStatus}`);
  const displayPrice = asset?.usdPrice ? formatDecimalCurrency(asset.usdPrice) : "$--";
  const displayOwned = authoritativeOwned ?? String(owned);

  return (
    <article
      className={`product-card${overdraft ? " overdraft" : ""}${owned ? " owned" : ""}${selected ? " selected" : ""}${activeSide ? " has-trade-ticket" : ""}`}
      style={{ ["--accent" as string]: product.accent }}
      data-product-id={product.id}
    >
      <div className="product-visual">
        <ArtMark product={product} />
        {Number(displayOwned) > 0 ? <span className="owned-badge">x{formatDecimalNumber(displayOwned, locale)}</span> : null}
      </div>
      <div className="product-copy">
        <div className="product-title-row">
          <h3>{getProductName(product, locale)}</h3>
          <span className="tag">{labelFrom(SUBCATEGORY_LABELS, tagLabel, locale)}</span>
        </div>
        <p className="product-desc">{getProductDescription(product, locale)}</p>
        <div className="price-line">
          <strong>{displayPrice}</strong>
          <span>
            {sourceLabel} · {asset?.currency ?? currency}{asset?.marketDate ? ` · ${asset.marketDate.slice(0, 10)}` : ""}
          </span>
        </div>
      </div>
      <div className="product-actions">
        <button
          className="buy-button"
          type="button"
          disabled={liquidated || tradeDisabled}
          onClick={() => onOpenTicket(product.id, "buy")}
        >
          {t(locale, "buy")}
        </button>
        <button
          className="max-button"
          type="button"
          disabled={liquidated || tradeDisabled}
          onClick={() => { void actions.buyMax(product.id); }}
        >
          {t(locale, "allIn")}
        </button>
        <button
          className="sell-button"
          type="button"
          disabled={liquidated || tradeDisabled || Number(displayOwned) <= 0}
          onClick={() => onOpenTicket(product.id, "sell")}
        >
          {t(locale, "sell")}
        </button>
        <button
          className="sell-all-button"
          type="button"
          disabled={liquidated || tradeDisabled || Number(displayOwned) <= 0}
          onClick={() => { void actions.sellAll(product.id); }}
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
