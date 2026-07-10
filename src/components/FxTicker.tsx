"use client";

import { useGame } from "@/state/GameProvider";
import { t } from "@/i18n";
import { FX_DISPLAY_ORDER, FALLBACK_FX } from "@/data/constants";
import { formatFxRate } from "@/game/format";

export function FxTicker() {
  const { state } = useGame();
  const line = FX_DISPLAY_ORDER.map(([currency, label]) => {
    const rate = state.fxRates[currency] || FALLBACK_FX[currency];
    const name = state.locale === "en" ? label.en : label.zh;
    return `${name} ${currency} ${formatFxRate(currency, rate)}`;
  }).join(" / ");

  return (
    <section className="fx-ticker" aria-live="polite">
      <span className="fx-ticker-label">{t(state.locale, "fxTicker")}</span>
      <div className="fx-ticker-window" aria-label={t(state.locale, "fxWindow")}>
        <div className="fx-ticker-track">
          <div className="fx-ticker-line">{line}</div>
          <div className="fx-ticker-line" aria-hidden="true">
            {line}
          </div>
        </div>
      </div>
    </section>
  );
}
