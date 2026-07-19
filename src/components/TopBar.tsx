"use client";

import { useEffect, useState } from "react";
import { useGame } from "@/state/GameProvider";
import { t } from "@/i18n";
import {
  getNextMarketClose,
  getTradingSessionState,
  formatRefreshDuration,
  formatMarketCloseTime,
} from "@/game/marketClock";
import { ConnectButton } from "@/wallet/ConnectButton";
import { ResetDialog } from "./ResetDialog";

function MarketClock() {
  const { state } = useGame();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const nextClose = getNextMarketClose(now);
  const locked = getTradingSessionState(now).locked;
  return (
    <div className="market-clock" aria-live="polite">
      <span>{t(state.locale, "nextRefresh")}</span>
      <strong>
        {locked
          ? t(state.locale, "clearingNow")
          : formatRefreshDuration(nextClose.getTime() - now.getTime(), state.locale)}
      </strong>
      <span>
        {t(state.locale, "marketCloseAnchor")} · {formatMarketCloseTime(nextClose, state.locale)} HKT
      </span>
    </div>
  );
}

export function TopBar() {
  const { state, account, tradingLocked, actions, pendingCommand } = useGame();
  const locale = state.locale;
  const [resetOpen, setResetOpen] = useState(false);

  return (
    <header className="topbar">
      <div className="brand-lockup">
        <div className="brand-mark" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/musk-money-logo.png" alt="" width={60} height={60} decoding="async" />
        </div>
        <div>
          <h1>{t(locale, "brandTitle")}</h1>
          <p>{t(locale, "brandSubtitle")}</p>
        </div>
      </div>

      <div className="topbar-actions" aria-label={t(locale, "gameControls")}>
        <button
          className="icon-button danger"
          type="button"
          title={t(locale, "reset")}
          disabled={!account || !account.resetEnabled || tradingLocked || pendingCommand !== null}
          onClick={() => setResetOpen(true)}
        >
          <span aria-hidden="true">↺</span>
          <span>{t(locale, "reset")}</span>
        </button>
        <button
          className="icon-button"
          id="languageButton"
          type="button"
          title="Switch language"
          onClick={actions.toggleLocale}
        >
          <span aria-hidden="true">文/A</span>
          <span>{t(locale, "language")}</span>
        </button>
        <button
          className="icon-button"
          type="button"
          title={state.sound ? t(locale, "soundOn") : t(locale, "soundOff")}
          onClick={actions.toggleSound}
        >
          <span aria-hidden="true">{state.sound ? "🔊" : "🔇"}</span>
          <span>{state.sound ? t(locale, "soundOn") : t(locale, "soundOff")}</span>
        </button>
        <ConnectButton />
        <MarketClock />
      </div>

      <ResetDialog
        open={resetOpen}
        locale={locale}
        disabled={!account || !account.resetEnabled || tradingLocked || pendingCommand !== null}
        onCancel={() => setResetOpen(false)}
        onConfirm={() => {
          actions.reset();
          setResetOpen(false);
        }}
      />
    </header>
  );
}
