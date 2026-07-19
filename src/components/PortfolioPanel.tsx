"use client";

import { useMemo } from "react";
import { useGame } from "@/state/GameProvider";
import { useCloudSync } from "@/state/CloudSyncProvider";
import { t } from "@/i18n";
import { STARTING_BALANCE, FX_DISPLAY_ORDER, FALLBACK_FX } from "@/data/constants";
import { productById } from "@/data/expandedAssets";
import { getInvestmentProducts } from "@/data/categories";
import { formatCurrency, formatNumber, formatPercentValue, formatFxRate } from "@/game/format";
import {
  getBalance,
  getNetWorth,
  getHoldingsValue,
  getPnl,
  getLossRanking,
  getProductPrice,
  getProductName,
  getPositionQuantity,
  getPositionCost,
} from "@/game/engine";
import type { Product, Position } from "@/types";

export function PortfolioPanel() {
  const { state, actions, focusedProductId } = useGame();
  const { leaderboard } = useCloudSync();
  const locale = state.locale;

  const cash = getBalance(state);
  const netWorth = getNetWorth(state);
  const assetBalance = getHoldingsValue(state);
  const pnl = getPnl(state);
  const returnRatio = pnl / STARTING_BALANCE;
  const pnlTone = pnl > 0 ? "positive" : pnl < 0 ? "negative" : "neutral";

  // Real leaderboard rank when connected; otherwise the simulated ranking.
  const you = leaderboard?.you;
  const leaderboardPnl = you ? Number(you.pnl) : 0;
  const status = you
    ? {
        title: t(locale, "lossRankTitle"),
        text:
          locale === "en"
            ? `#${formatNumber(you.rank, locale)} / ${formatNumber(you.total, locale)} real players. ${
                leaderboardPnl < 0
                  ? `Loss ${formatCurrency(Math.abs(leaderboardPnl), true)}`
                  : leaderboardPnl > 0
                    ? `Profit ${formatCurrency(leaderboardPnl, true)}`
                    : "Flat book"
              }.`
            : `#${formatNumber(you.rank, locale)} / ${formatNumber(you.total, locale)} 真实玩家。${
                leaderboardPnl < 0
                  ? `亏损 ${formatCurrency(Math.abs(leaderboardPnl), true)}`
                  : leaderboardPnl > 0
                    ? `盈利 ${formatCurrency(leaderboardPnl, true)}`
                    : "账户打平"
              }。`,
        color: leaderboardPnl < 0 ? "#c94d3f" : leaderboardPnl > 0 ? "#2d7b46" : "#b88921",
      }
    : getLossRanking(state);

  // FX rates for the currencies actually used by tradeable assets (non-USD).
  const displayedFx = useMemo(() => {
    const active = new Set<string>();
    getInvestmentProducts().forEach((product) => {
      const declared = product.currency || "USD";
      const quote = state.prices?.[product.id]?.currency;
      [declared, quote].forEach((currency) => {
        if (currency && currency !== "USD") active.add(currency);
      });
    });
    return FX_DISPLAY_ORDER.filter(([currency]) => active.has(currency));
  }, [state.prices]);

  const entries = Object.entries(state.inventory)
    .map(([id, position]) => ({ product: productById.get(id), position }))
    .filter((entry): entry is { product: Product; position: Position } => Boolean(entry.product))
    .sort(
      (a, b) =>
        getProductPrice(state, b.product) * getPositionQuantity(b.position) -
        getProductPrice(state, a.product) * getPositionQuantity(a.position),
    );

  return (
    <aside className="panel inventory-panel" aria-labelledby="inventoryTitle">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Portfolio</p>
          <h2 id="inventoryTitle">{t(locale, "portfolio")}</h2>
        </div>
        <span className="pill">
          {entries.length} {t(locale, "typesUnit")}
        </span>
      </div>

      <div className="money-stack">
        <div className="metric primary">
          <span className="net-worth-label">
            <b>{t(locale, "netWorth")}</b>
            <em>{t(locale, "netWorthFormula")}</em>
          </span>
          <strong>{formatCurrency(netWorth)}</strong>
        </div>
        <div className="metric-grid metric-led-list">
          <div className="metric metric-led">
            <span>{t(locale, "cashBalance")}</span>
            <strong>{formatCurrency(cash)}</strong>
          </div>
          <div className="metric metric-led">
            <span>{t(locale, "assetBalance")}</span>
            <strong>{formatCurrency(assetBalance, assetBalance >= 1_000_000_000)}</strong>
          </div>
          <div className={`metric metric-led pnl-metric ${pnlTone}`}>
            <span>{t(locale, "totalPnl")}</span>
            <strong>{formatCurrency(pnl, Math.abs(pnl) >= 1_000_000_000)}</strong>
          </div>
        </div>
      </div>

      <div className="progress-wrap" aria-label={t(locale, "returnProgress")}>
        <div className="progress-label">
          <span>{t(locale, "returnRate")}</span>
          <strong>{`${(returnRatio * 100).toFixed(2)}%`}</strong>
        </div>
        <div className="progress-track">
          <div
            className={`progress-fill${pnl < 0 ? " loss" : ""}`}
            style={{ width: `${Math.min(100, Math.max(0, 50 + returnRatio * 100))}%` }}
          />
        </div>
      </div>

      {displayedFx.length > 0 && (
        <div className="exchange-panel" aria-labelledby="exchangeTitle">
          <div className="exchange-heading">
            <strong id="exchangeTitle">{t(locale, "exchangeRates")}</strong>
            <span>{t(locale, "exchangeDaily")}</span>
          </div>
          <div className="exchange-list">
            {displayedFx.map(([currency, label]) => {
              const rate = state.fxRates[currency] || FALLBACK_FX[currency];
              return (
                <div className="exchange-row" key={currency}>
                  <span>
                    <b>{locale === "en" ? label.en : label.zh}</b>
                    <em>{currency}/USD</em>
                  </span>
                  <strong>{formatFxRate(currency, rate)}</strong>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="status-card">
        <span
          className="status-dot"
          aria-hidden="true"
          style={{ background: status.color, boxShadow: `0 0 0 4px ${status.color}22` }}
        />
        <div>
          <strong>{status.title}</strong>
          <p>{status.text}</p>
        </div>
      </div>

      <div className="inventory-list" aria-live="polite">
        {entries.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon" aria-hidden="true">
              ⌁
            </div>
            <strong>{t(locale, "emptyTitle")}</strong>
            <p>{t(locale, "emptyText")}</p>
          </div>
        ) : (
          <div className="inventory-table">
            <div className="inventory-table-head" aria-hidden="true">
              <span>{t(locale, "positionAsset")}</span>
              <span>{t(locale, "positionQty")}</span>
              <span>{t(locale, "positionValue")}</span>
              <span>{t(locale, "positionPnl")}</span>
              <span>{t(locale, "positionReturn")}</span>
            </div>
            {entries.map(({ product, position }) => {
              const quantity = getPositionQuantity(position);
              const cost = getPositionCost(state, position, product);
              const total = getProductPrice(state, product) * quantity;
              const rowPnl = total - cost;
              const pnlRatio = cost > 0 ? rowPnl / cost : 0;
              const tone = rowPnl > 0 ? "positive" : rowPnl < 0 ? "negative" : "";
              const selected = focusedProductId === product.id;
              return (
                <button
                  key={product.id}
                  className={`inventory-item${selected ? " is-focused" : ""}`}
                  type="button"
                  style={{ ["--accent" as string]: product.accent }}
                  onClick={() => actions.focusProduct(product.id)}
                >
                  <span className="position-asset">
                    <span className="inventory-name">
                      <strong>{getProductName(product, locale)}</strong>
                      <span>{product.ticker || product.id}</span>
                    </span>
                  </span>
                  <span className="position-cell strong">{formatNumber(quantity, locale)}</span>
                  <span className="position-cell strong">
                    {formatCurrency(total, total >= 1_000_000_000)}
                  </span>
                  <span className={`position-cell ${tone}`}>
                    {formatCurrency(rowPnl, Math.abs(rowPnl) >= 1_000_000_000)}
                  </span>
                  <span className={`position-cell ${tone}`}>{formatPercentValue(pnlRatio)}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
