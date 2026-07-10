"use client";

import { useGame } from "@/state/GameProvider";
import { useCloudSync } from "@/state/CloudSyncProvider";
import { t } from "@/i18n";
import { STARTING_BALANCE } from "@/data/constants";
import { productById } from "@/data/expandedAssets";
import { formatCurrency, formatNumber, formatPercentValue } from "@/game/format";
import {
  getBalance,
  getNetWorth,
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
  const pnl = getPnl(state);
  const returnRatio = pnl / STARTING_BALANCE;

  // Real leaderboard rank when connected; otherwise the simulated ranking.
  const you = leaderboard?.you;
  const status = you
    ? {
        title: t(locale, "lossRankTitle"),
        text:
          locale === "en"
            ? `#${formatNumber(you.rank, locale)} / ${formatNumber(you.total, locale)} real players. ${
                you.pnl < 0
                  ? `Loss ${formatCurrency(Math.abs(you.pnl), true)}`
                  : you.pnl > 0
                    ? `Profit ${formatCurrency(you.pnl, true)}`
                    : "Flat book"
              }.`
            : `#${formatNumber(you.rank, locale)} / ${formatNumber(you.total, locale)} 真实玩家。${
                you.pnl < 0
                  ? `亏损 ${formatCurrency(Math.abs(you.pnl), true)}`
                  : you.pnl > 0
                    ? `盈利 ${formatCurrency(you.pnl, true)}`
                    : "账户打平"
              }。`,
        color: you.pnl < 0 ? "#c94d3f" : you.pnl > 0 ? "#2d7b46" : "#b88921",
      }
    : getLossRanking(state);

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
          <span>{t(locale, "netWorth")}</span>
          <strong>{formatCurrency(netWorth)}</strong>
        </div>
        <div className="metric-grid">
          <div className="metric">
            <span>{t(locale, "cashBalance")}</span>
            <strong>{formatCurrency(cash)}</strong>
          </div>
          <div className="metric">
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
