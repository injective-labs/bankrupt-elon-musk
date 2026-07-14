"use client";

import { Fragment, type ReactNode } from "react";
import { useGame } from "@/state/GameProvider";
import { t } from "@/i18n";
import { MOCK_PLAYER_ADDRESSES, MOCK_ACTIVITY_TICKERS } from "@/data/constants";
import { getInvestmentProducts } from "@/data/categories";
import { getProductName } from "@/game/engine";
import { formatAddress } from "@/game/format";

// The top ticker mirrors the prototype's "全服动态 / Server Moves" feed: a scrolling
// list of mock wallet addresses buying/selling assets. Clicking an asset focuses it.
export function FxTicker() {
  const { state, actions } = useGame();
  const locale = state.locale;

  const investment = getInvestmentProducts();
  const byTicker = new Map(investment.map((product) => [product.ticker, product]));
  const fallback = investment.slice(0, 24);

  const items = MOCK_PLAYER_ADDRESSES.map((address, index) => {
    const ticker = MOCK_ACTIVITY_TICKERS[index % MOCK_ACTIVITY_TICKERS.length];
    const product = byTicker.get(ticker) || fallback[index % fallback.length];
    const action: "buy" | "sell" = index % 3 === 1 ? "sell" : "buy";
    const actionText =
      locale === "en"
        ? action === "buy"
          ? "just bought"
          : "just sold"
        : action === "buy"
          ? "刚刚买入"
          : "刚刚卖出";
    const assetLabel = product ? product.ticker || getProductName(product, locale) : ticker;
    return { address, product, action, actionText, assetLabel };
  });

  const renderLine = (prefix: string): ReactNode =>
    items.map((item, index) => (
      <Fragment key={`${prefix}-${index}`}>
        <span className="activity-item">
          <span className="activity-address">{formatAddress(item.address)}</span>
          <span className={`activity-action ${item.action}`}>{item.actionText}</span>
          {item.product ? (
            <button
              className="activity-asset"
              type="button"
              onClick={() => actions.focusProduct(item.product!.id)}
            >
              {item.assetLabel}
            </button>
          ) : (
            <span className="activity-asset">{item.assetLabel}</span>
          )}
        </span>
        {index < items.length - 1 && <span className="activity-separator">/</span>}
      </Fragment>
    ));

  return (
    <section className="fx-ticker" aria-live="polite">
      <span className="fx-ticker-label">{t(locale, "fxTicker")}</span>
      <div className="fx-ticker-window" aria-label={t(locale, "fxTicker")}>
        <div className="fx-ticker-track">
          <div className="fx-ticker-line">{renderLine("a")}</div>
          <div className="fx-ticker-line" aria-hidden="true">
            {renderLine("b")}
          </div>
        </div>
      </div>
    </section>
  );
}
