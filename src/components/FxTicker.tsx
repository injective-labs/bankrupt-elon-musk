"use client";
import { Fragment } from "react";
import { useGame } from "@/state/GameProvider";
import { t } from "@/i18n";
import { formatDecimalCurrency, formatDecimalNumber } from "@/game/format";

export function FxTicker() {
  const { account, state, actions } = useGame();
  const locale = state.locale;
  const assets = new Map((account?.assets ?? []).map((asset) => [asset.id, asset]));
  const items = (account?.recentTransactions ?? []).filter((row) => row.assetId && row.type !== "RESET");
  return <section className="fx-ticker" aria-live="polite"><span className="fx-ticker-label">{t(locale, "fxTicker")}</span><div className="fx-ticker-window" aria-label={t(locale, "fxTicker")}><div className="fx-ticker-track"><div className="fx-ticker-line">
    {items.length === 0 ? <span className="activity-item">{t(locale, "noServerActivity")}</span> : items.map((item, index) => { const asset = assets.get(item.assetId!); return <Fragment key={item.id}><span className="activity-item"><span className={`activity-action ${item.type === "BUY" ? "buy" : "sell"}`}>{item.type === "BUY" ? t(locale, "buy") : t(locale, "sell")}</span><button className="activity-asset" type="button" onClick={() => actions.focusProduct(item.assetId!)}>{asset?.ticker ?? item.assetId}</button><span>{item.quantity ? ` × ${formatDecimalNumber(item.quantity, locale)}` : ""} · {formatDecimalCurrency(item.usdAmount)}</span></span>{index < items.length - 1 && <span className="activity-separator">/</span>}</Fragment>; })}
  </div></div></div></section>;
}
