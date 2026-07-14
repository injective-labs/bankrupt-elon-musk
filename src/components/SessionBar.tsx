"use client";

import { useEffect, useState } from "react";
import { useGame } from "@/state/GameProvider";
import { t } from "@/i18n";
import {
  getTradingSessionState,
  formatMarketCloseTime,
  formatRefreshDuration,
  type SessionSegment,
} from "@/game/marketClock";
import type { Locale } from "@/types";

type SegmentType = "before" | "settlement" | "after";

function segmentRangeLabel(locale: Locale, type: SegmentType, range: SessionSegment): string {
  const label =
    type === "settlement"
      ? t(locale, "sessionRangeSettle")
      : type === "after"
        ? t(locale, "sessionRangeAfter")
        : t(locale, "sessionRangeTrade");
  return `${label} · ${formatMarketCloseTime(range.start, locale)} - ${formatMarketCloseTime(range.end, locale)} HKT`;
}

export function SessionBar() {
  const { state } = useGame();
  const locale = state.locale;
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const session = getTradingSessionState(now);
  const segmentTypes: SegmentType[] = ["before", "settlement", "after"];

  return (
    <section
      className={`session-bar${session.locked ? " is-locked" : ""}`}
      aria-live="polite"
      style={{ ["--session-progress" as string]: `${session.markerPercent.toFixed(2)}%` }}
    >
      <div className="session-bar-main">
        <div className="session-title-row">
          <div className="session-title-copy">
            <span className="session-pill">
              {session.locked ? t(locale, "settlementMode") : t(locale, "tradingOpen")}
            </span>
            <strong>{t(locale, "tradingSession")}</strong>
            {session.locked && (
              <span className="session-warning" aria-hidden="true">
                !
              </span>
            )}
            {session.locked && (
              <span
                className="session-help"
                tabIndex={0}
                data-tooltip={t(locale, "settlementTooltip")}
                aria-label={t(locale, "settlementTooltip")}
              >
                ?
              </span>
            )}
          </div>
          <div className="session-meta">
            <span>
              {t(locale, "nextCloseTime")} {formatMarketCloseTime(session.nextClose, locale)} HKT
            </span>
            <strong>
              {session.locked
                ? t(locale, "clearingNow")
                : formatRefreshDuration(session.countdownTarget.getTime() - now.getTime(), locale)}
            </strong>
            <span>{t(locale, "settlementWindow")}</span>
          </div>
        </div>
        <div className="session-timeline" aria-label={t(locale, "tradingSession")}>
          {segmentTypes.map((type) => {
            const range = session.segments[type];
            const label = segmentRangeLabel(locale, type, range);
            return (
              <span
                key={type}
                className={`session-segment ${type === "settlement" ? "settle" : "trade"}`}
                data-session-segment={type}
                tabIndex={0}
                title={label}
                aria-label={label}
              />
            );
          })}
          <i id="sessionMarker" />
        </div>
      </div>
    </section>
  );
}
