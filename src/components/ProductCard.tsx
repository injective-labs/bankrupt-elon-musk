"use client";

import { memo, useEffect, useState } from "react";
import type { Product, Locale } from "@/types";
import { labelFrom } from "@/i18n";
import { errorText, t } from "@/i18n";
import { SUBCATEGORY_LABELS } from "@/data/categoryLabels";
import { getProductCategory } from "@/data/categories";
import { useGame } from "@/state/GameProvider";
import { useInjPassLogin } from "@/wallet/useInjPassLogin";
import {
  getAssetMark,
  getMarkFontSize,
  getProductName,
  getProductDescription,
  getUnitLabel,
  getTradeEstimateText,
  type TradeSide,
} from "@/game/productPresentation";
import { floorDecimalDivision, formatDecimalCurrency, formatDecimalNumber, integerFraction, isPositiveDecimal } from "@/game/format";
import { isQuoteFresh } from "@/game/quoteFreshness";

interface ProductCardProps {
  product: Product;
  price: number;
  owned: number;
  overdraft: boolean;
  currency: string;
  live: boolean;
  selected: boolean;
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
  const { state, account, clockNow, authStatus, tradingLocked, actions, pendingCommand, pendingOperation, feedback, lastError } = useGame();
  const locale = state.locale;
  const asset = account?.assets.find((item) => item.id === product.id);
  const position = account?.positions.find((item) => item.assetId === product.id);
  const maxQuantity = side === "sell" ? (position?.quantity ?? "0").split(".")[0] : floorDecimalDivision(account?.cash ?? "0", asset?.usdPrice ?? "0");
  const [qty, setQty] = useState("1");

  const unit = getUnitLabel(product, locale);
  const quoteFresh = Boolean(asset?.marketDate && isQuoteFresh(asset.marketDate, clockNow));
  const unavailable = authStatus !== "authenticated" || !asset?.enabled || asset.quoteStatus !== "ACTIVE" || !quoteFresh || asset.usdPrice === null || tradingLocked;
  const disabled = unavailable || maxQuantity === "0" || pendingCommand !== null;
  const validQuantity = /^[1-9]\d*$/.test(qty) && BigInt(qty) <= BigInt(maxQuantity || "0");
  const confirmDisabled = disabled || !validQuantity;

  const sideLabel = side === "buy" ? t(locale, "buyQuantity") : t(locale, "sellQuantity");
  const limitLabel = side === "buy" ? t(locale, "maxBuyable") : t(locale, "maxSellable");
  const fractionHint = side === "buy" ? t(locale, "fractionHintBuy") : t(locale, "fractionHintSell");
  const confirmLabel = side === "buy" ? t(locale, "confirmBuy") : t(locale, "confirmSell");
  const operationSide = side === "buy" ? "BUY" : "SELL";
  const operationPending = pendingOperation?.kind === "trade" && pendingOperation.assetId === product.id && pendingOperation.side === operationSide;

  const submit = () => {
    if (!validQuantity) return;
    if (side === "buy") actions.buyQty(product.id, qty);
    else actions.sellQty(product.id, qty);
  };

  useEffect(() => {
    if (feedback?.kind === "trade" && feedback.status === "success" && feedback.assetId === product.id && feedback.side === operationSide) {
      onClose();
    }
  }, [feedback?.id, feedback?.kind, feedback?.status, feedback?.assetId, feedback?.side, onClose, operationSide, product.id]);

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
            type="text"
            pattern="[1-9][0-9]*"
            inputMode="numeric"
            value={qty}
            disabled={disabled}
            aria-label={sideLabel}
            onChange={(e) => setQty(e.target.value)}
            onBlur={() => { if (!/^[1-9]\d*$/.test(qty)) setQty("1"); }}
          />
        </span>
        <span className="trade-limit">
          {limitLabel} {formatDecimalNumber(String(maxQuantity), locale)} {unit}
        </span>
      </label>
      <div className="trade-fractions" aria-label={fractionHint}>
        {[4n, 8n, 16n, 32n].map((denominator) => {
          const label = `1/${denominator}`;
          return (
            <button
              key={label}
              type="button"
              disabled={disabled}
              title={`${fractionHint} ${label}`}
              onClick={() => setQty(integerFraction(maxQuantity, 1n, denominator))}
            >
              {label}
            </button>
          );
        })}
      </div>
      <p className="trade-estimate">{t(locale, "estimateOnly")}: {getTradeEstimateText(locale, asset?.usdPrice ?? "0", side, qty, maxQuantity)}</p>
      {lastError && <p className="trade-error" role="alert">{errorText(locale, lastError)}</p>}
      <div className="trade-ticket-actions">
        <button
          className={`trade-confirm-button ${side}`}
          type="button"
          disabled={confirmDisabled}
          onClick={submit}
        >
          {operationPending ? <><span className="operation-spinner" aria-hidden="true" />{t(locale, side === "buy" ? "processingBuy" : "processingSell")}</> : confirmLabel}
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
  locale,
  activeSide,
  onOpenTicket,
  onCloseTicket,
}: ProductCardProps) {
  const { account, market, clockNow, authStatus, tradingLocked, pendingCommand, pendingOperation, feedback, actions } = useGame();
  const { beginLogin, busy: loginBusy } = useInjPassLogin();
  const asset = (account?.assets ?? market?.assets)?.find((item) => item.id === product.id);
  const authoritativeOwned = account?.positions.find((item) => item.assetId === product.id)?.quantity;
  const quoteStatus = asset?.quoteStatus === "ACTIVE" && asset.marketDate && !isQuoteFresh(asset.marketDate, clockNow) ? "STALE" : asset?.quoteStatus ?? "MISSING";
  const quoteDisabled = !asset?.enabled || quoteStatus !== "ACTIVE" || asset.usdPrice === null;
  const authenticated = authStatus === "authenticated";
  const tradeDisabled = quoteDisabled || (authenticated ? pendingCommand !== null || tradingLocked : loginBusy);
  const tagLabel = product.subCategory || getProductCategory(product);
  const sourceLabel = t(locale, `quote.${quoteStatus}`);
  const displayPrice = asset?.usdPrice ? formatDecimalCurrency(asset.usdPrice) : "$--";
  const displayOwned = authoritativeOwned ?? String(owned);
  const targetedPending = pendingOperation?.kind === "trade" && pendingOperation.assetId === product.id;
  const targetedFeedback = feedback?.kind === "trade" && feedback.assetId === product.id ? feedback : null;
  const feedbackClass = targetedFeedback ? ` trade-${targetedFeedback.status}` : "";
  const buyingMax = targetedPending && pendingOperation.side === "BUY" && activeSide === null;
  const sellingAll = targetedPending && pendingOperation.side === "SELL" && activeSide === null;

  return (
    <article
      className={`product-card${overdraft ? " overdraft" : ""}${owned ? " owned" : ""}${selected ? " selected" : ""}${activeSide ? " has-trade-ticket" : ""}${targetedPending ? " trade-pending" : ""}${feedbackClass}`}
      style={{ ["--accent" as string]: product.accent }}
      data-product-id={product.id}
    >
      <div className="product-visual">
        <ArtMark product={product} />
        {isPositiveDecimal(displayOwned) ? <span className="owned-badge">x{formatDecimalNumber(displayOwned, locale)}</span> : null}
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
          {asset && !asset.enabled && <span className="asset-disabled">{t(locale, "assetDisabled")}</span>}
        </div>
      </div>
      <div className="product-actions">
        <button
          className="buy-button"
          type="button"
          disabled={tradeDisabled}
          onClick={() => { if (authenticated) onOpenTicket(product.id, "buy"); else void beginLogin(); }}
        >
          {t(locale, "buy")}
        </button>
        <button
          className="max-button"
          type="button"
          disabled={tradeDisabled}
          onClick={() => { if (authenticated) void actions.buyMax(product.id); else void beginLogin(); }}
        >
          {buyingMax ? <><span className="operation-spinner" aria-hidden="true" />{t(locale, "processingBuy")}</> : t(locale, "allIn")}
        </button>
        <button
          className="sell-button"
          type="button"
          disabled={tradeDisabled || (authenticated && !isPositiveDecimal(displayOwned))}
          onClick={() => { if (authenticated) onOpenTicket(product.id, "sell"); else void beginLogin(); }}
        >
          {t(locale, "sell")}
        </button>
        <button
          className="sell-all-button"
          type="button"
          disabled={tradeDisabled || (authenticated && !isPositiveDecimal(displayOwned))}
          onClick={() => { if (authenticated) void actions.sellAll(product.id); else void beginLogin(); }}
        >
          {sellingAll ? <><span className="operation-spinner" aria-hidden="true" />{t(locale, "processingSell")}</> : t(locale, "sellAll")}
        </button>
      </div>
      {activeSide && (
        <TradeTicket product={product} side={activeSide} onClose={onCloseTicket} />
      )}
    </article>
  );
}

export const ProductCard = memo(ProductCardBase);
