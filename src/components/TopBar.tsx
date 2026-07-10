"use client";

import { useEffect, useState } from "react";
import { useGame } from "@/state/GameProvider";
import { t } from "@/i18n";
import {
  getNextMarketClose,
  formatRefreshDuration,
  formatMarketCloseTime,
} from "@/game/marketClock";
import { ConnectButton } from "@/wallet/ConnectButton";

function MarketClock() {
  const { state } = useGame();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const nextClose = getNextMarketClose(now);
  return (
    <div className="market-clock" aria-live="polite">
      <span>{t(state.locale, "nextRefresh")}</span>
      <strong>{formatRefreshDuration(nextClose.getTime() - now.getTime(), state.locale)}</strong>
      <span>
        {t(state.locale, "marketCloseAnchor")} · {formatMarketCloseTime(nextClose, state.locale)} HKT
      </span>
    </div>
  );
}

export function TopBar() {
  const { state, actions, resetArmed } = useGame();
  const locale = state.locale;

  return (
    <header className="topbar">
      <div className="brand-lockup">
        <div className="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 64 64" role="img">
            <rect x="8" y="8" width="48" height="48" rx="8"></rect>
            <path d="M20 42L31 18l13 24M25 34h14"></path>
          </svg>
        </div>
        <div>
          <h1>{t(locale, "brandTitle")}</h1>
          <p>{t(locale, "brandSubtitle")}</p>
        </div>
      </div>

      <div className="topbar-actions" aria-label={t(locale, "gameControls")}>
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
          title={t(locale, "randomInvest")}
          onClick={actions.randomSpend}
        >
          <span aria-hidden="true">🎲</span>
          <span>{t(locale, "randomInvest")}</span>
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
        <button
          className={`icon-button danger${resetArmed ? " armed" : ""}`}
          type="button"
          title={t(locale, "reset")}
          onClick={actions.reset}
        >
          <span aria-hidden="true">↺</span>
          <span>{resetArmed ? t(locale, "confirmReset") : t(locale, "reset")}</span>
        </button>
        <ConnectButton />
        <MarketClock />
      </div>
    </header>
  );
}
