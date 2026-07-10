"use client";

import { useEffect, useRef, useState } from "react";
import { useGame } from "@/state/GameProvider";
import { t } from "@/i18n";
import { formatCurrency } from "@/game/format";
import {
  getHoldingsValue,
  getNetWorth,
  getLtv,
  getBorrowApr,
  getLoanCapacity,
  getLiquidationRoom,
  getPriceSourceSummary,
} from "@/game/engine";

const LEVERAGE_PRESETS = [1, 5, 10, 20, 50];

export function FinancePanel() {
  const { state, actions, flashTick } = useGame();
  const locale = state.locale;
  const [loan, setLoan] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);

  // Money flash (port of flashMoney's .spark animation).
  useEffect(() => {
    if (flashTick === 0) return;
    const el = panelRef.current;
    if (!el) return;
    el.classList.remove("spark");
    // force reflow so the animation restarts
    void el.offsetWidth;
    el.classList.add("spark");
  }, [flashTick]);

  const holdingsValue = getHoldingsValue(state);
  const netWorth = getNetWorth(state);
  const ltv = getLtv(state);
  const isBankrupt = state.liquidated || netWorth <= 0;

  const loanAmount = (): number | null => {
    const value = Number(loan);
    return Number.isFinite(value) && value > 0 ? value : null;
  };

  const bankruptSpan = state.liquidated
    ? t(locale, "bankruptLiquidated")
    : t(locale, "bankruptBelowZero").replace("%s", formatCurrency(Math.abs(netWorth), true));

  const affordRows: [string, string][] = [
    [t(locale, "holdings"), formatCurrency(holdingsValue, holdingsValue >= 1_000_000_000)],
    [t(locale, "debt"), formatCurrency(state.debt, state.debt >= 1_000_000_000)],
    [t(locale, "warningRoom"), formatCurrency(getLoanCapacity(state), Math.abs(getLoanCapacity(state)) >= 1_000_000_000)],
    [t(locale, "liquidationRoom"), formatCurrency(getLiquidationRoom(state), Math.abs(getLiquidationRoom(state)) >= 1_000_000_000)],
    [t(locale, "borrowApr"), `${(getBorrowApr(state) * 100).toFixed(2)}%`],
    [t(locale, "accruedInterest"), formatCurrency(state.accruedInterest, state.accruedInterest >= 1_000_000_000)],
    [t(locale, "dataSource"), getPriceSourceSummary(state)],
  ];

  return (
    <aside
      ref={panelRef}
      className={`panel finance-panel${isBankrupt ? " bankrupt" : ""}`}
      aria-labelledby="financeTitle"
    >
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Treasury</p>
          <h2 id="financeTitle">{t(locale, "treasury")}</h2>
        </div>
        <span className="pill live">LIVE</span>
      </div>

      {isBankrupt && (
        <div className="bankruptcy-alert" role="status" aria-live="polite">
          <strong>{t(locale, "bankruptcyTitle")}</strong>
          <span>{bankruptSpan}</span>
        </div>
      )}

      <div className="bank-panel">
        <div className="bank-heading">
          <h3>{t(locale, "bank")}</h3>
          <span>{state.liquidated ? t(locale, "liquidated") : `LTV ${(ltv * 100).toFixed(1)}%`}</span>
        </div>
        <label className="leverage-control" htmlFor="leverageRange">
          <span>{t(locale, "leverage")}</span>
          <strong>{state.leverage}x</strong>
          <input
            id="leverageRange"
            type="range"
            min="1"
            max="50"
            step="1"
            value={state.leverage}
            disabled={state.liquidated}
            onChange={(e) => actions.setLeverage(Number(e.target.value))}
          />
        </label>
        <div className="leverage-presets" aria-label={t(locale, "leveragePresets")}>
          {LEVERAGE_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className={state.leverage === preset ? "active" : ""}
              disabled={state.liquidated}
              onClick={() => actions.setLeverage(preset)}
            >
              {preset}x
            </button>
          ))}
        </div>
        <label className="loan-input" htmlFor="loanAmount">
          <span>{t(locale, "loan")}</span>
          <input
            id="loanAmount"
            type="number"
            min="0"
            step="1000000"
            placeholder="1000000000"
            value={loan}
            disabled={state.liquidated}
            onChange={(e) => setLoan(e.target.value)}
          />
        </label>
        <div className="bank-actions">
          <button type="button" disabled={state.liquidated} onClick={() => actions.borrow(loanAmount())}>
            {t(locale, "borrow")}
          </button>
          <button
            type="button"
            disabled={state.liquidated || state.debt <= 0}
            onClick={() => actions.repay(loanAmount())}
          >
            {t(locale, "repay")}
          </button>
          <button
            type="button"
            disabled={state.liquidated || state.debt <= 0}
            onClick={actions.settleInterest}
          >
            {t(locale, "settleInterest")}
          </button>
        </div>
        <p className="bank-note">{t(locale, "bankNote")}</p>
      </div>

      <div className="insight-list">
        <h3>{t(locale, "risk")}</h3>
        <div>
          {affordRows.map(([label, value]) => (
            <div className="afford-row" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      </div>

      <div className="deal-tape">
        <div className="deal-tape-heading">
          <h3>{t(locale, "logTitle")}</h3>
          <button type="button" onClick={actions.clearLog}>
            {t(locale, "clear")}
          </button>
        </div>
        <div className="log-list">
          {state.log.length === 0 ? (
            <div className="log-entry">{t(locale, "noLog")}</div>
          ) : (
            state.log.map((entry, index) => (
              <div className="log-entry" key={`${index}-${entry.title}`}>
                <strong>{entry.title}</strong>
                <br />
                {entry.detail}
              </div>
            ))
          )}
        </div>
      </div>
    </aside>
  );
}
