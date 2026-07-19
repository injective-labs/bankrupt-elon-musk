"use client";

import { useGame } from "@/state/GameProvider";
import { t } from "@/i18n";
import { productById } from "@/data/expandedAssets";
import { formatDecimalCurrency, formatDecimalNumber } from "@/game/format";

const numericTone = (value: string) => Number(value) > 0 ? "positive" : Number(value) < 0 ? "negative" : "neutral";

export function PortfolioPanel() {
  const { account, state, actions, focusedProductId, leaderboard, leaderboardError } = useGame();
  const locale = state.locale;
  const positions = account?.positions ?? [];
  const assets = new Map((account?.assets ?? []).map((asset) => [asset.id, asset]));
  const rank = leaderboard?.you;

  return <aside className="panel inventory-panel" aria-labelledby="inventoryTitle">
    <div className="panel-heading"><div><p className="eyebrow">Portfolio</p><h2 id="inventoryTitle">{t(locale, "portfolio")}</h2></div><span className="pill">{positions.length} {t(locale, "typesUnit")}</span></div>
    <div className="money-stack">
      <div className="metric primary"><span className="net-worth-label"><b>{t(locale, "netWorth")}</b><em>{t(locale, "netWorthFormula")}</em></span><strong>{formatDecimalCurrency(account?.netWorth ?? "0")}</strong></div>
      <div className="metric-grid metric-led-list">
        <div className="metric metric-led"><span>{t(locale, "cashBalance")}</span><strong>{formatDecimalCurrency(account?.cash ?? "0")}</strong></div>
        <div className="metric metric-led"><span>{t(locale, "assetBalance")}</span><strong>{formatDecimalCurrency(account?.holdingsValue ?? "0")}</strong></div>
        <div className={`metric metric-led pnl-metric ${numericTone(account?.pnl ?? "0")}`}><span>{t(locale, "totalPnl")}</span><strong>{formatDecimalCurrency(account?.pnl ?? "0")}</strong></div>
      </div>
    </div>
    <div className="status-card"><span className="status-dot" aria-hidden="true" />
      <div><strong>{t(locale, "lossRankTitle")}</strong><p>{leaderboardError ? t(locale, "leaderboardUnavailable") : rank ? `#${rank.rank} / ${rank.total} · ${formatDecimalCurrency(rank.pnl)}` : t(locale, "leaderboardLoading")}</p></div>
    </div>
    <div className="inventory-list" aria-live="polite">
      {positions.length === 0 ? <div className="empty-state"><div className="empty-icon" aria-hidden="true">⌁</div><strong>{t(locale, "emptyTitle")}</strong><p>{t(locale, "emptyText")}</p></div> :
        <div className="inventory-table">
          <div className="inventory-table-head" aria-hidden="true"><span>{t(locale, "positionAsset")}</span><span>{t(locale, "positionQty")}</span><span>{t(locale, "positionValue")}</span><span>{t(locale, "positionPnl")}</span><span>{t(locale, "positionReturn")}</span></div>
          {positions.map((position) => { const asset = assets.get(position.assetId); const visual = productById.get(position.assetId); const pnl = position.unrealizedPnl; return <button key={position.assetId} className={`inventory-item${focusedProductId === position.assetId ? " is-focused" : ""}`} type="button" style={{ ["--accent" as string]: visual?.accent ?? "#536078" }} onClick={() => actions.focusProduct(position.assetId)}>
            <span className="position-asset"><span className="inventory-name"><strong>{locale === "en" ? asset?.nameEn || asset?.name : asset?.name}</strong><span>{asset?.ticker || position.assetId}</span></span></span>
            <span className="position-cell strong">{formatDecimalNumber(position.quantity, locale)}</span>
            <span className="position-cell strong">{position.marketValue ? formatDecimalCurrency(position.marketValue) : t(locale, "priceUnavailable")}</span>
            <span className={`position-cell ${pnl ? numericTone(pnl) : ""}`}>{pnl ? formatDecimalCurrency(pnl) : t(locale, "priceUnavailable")}</span>
            <span className="position-cell">—</span>
          </button>; })}
        </div>}
    </div>
  </aside>;
}
