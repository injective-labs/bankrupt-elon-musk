import type { Locale } from "@/types";
import {
  HONG_KONG_TZ,
  MARKET_CLOSE_HOUR_HKT,
  MARKET_CLOSE_MINUTE_HKT,
  SETTLEMENT_WINDOW_MS,
} from "@/data/constants";

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday?: string;
}

function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
    weekday: values.weekday,
  };
}

function getCalendarDateOffset(
  base: { year: number; month: number; day: number },
  offset: number,
): { year: number; month: number; day: number } {
  const date = new Date(Date.UTC(base.year, base.month - 1, base.day + offset));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function makeUtcFromZonedTime(
  dateParts: { year: number; month: number; day: number; hour: number; minute: number; second?: number },
  timeZone: string,
): Date {
  let utcTime = Date.UTC(
    dateParts.year,
    dateParts.month - 1,
    dateParts.day,
    dateParts.hour,
    dateParts.minute,
    dateParts.second || 0,
  );
  for (let index = 0; index < 4; index += 1) {
    const zoned = getZonedParts(new Date(utcTime), timeZone);
    const desired = Date.UTC(
      dateParts.year,
      dateParts.month - 1,
      dateParts.day,
      dateParts.hour,
      dateParts.minute,
      dateParts.second || 0,
    );
    const actual = Date.UTC(
      zoned.year,
      zoned.month - 1,
      zoned.day,
      zoned.hour,
      zoned.minute,
      zoned.second,
    );
    utcTime += desired - actual;
  }
  return new Date(utcTime);
}

function getMarketCloseForDate(dateParts: { year: number; month: number; day: number }): Date {
  return makeUtcFromZonedTime(
    {
      ...dateParts,
      hour: MARKET_CLOSE_HOUR_HKT,
      minute: MARKET_CLOSE_MINUTE_HKT,
      second: 0,
    },
    HONG_KONG_TZ,
  );
}

export function getNextMarketClose(now: Date = new Date()): Date {
  const hktToday = getZonedParts(now, HONG_KONG_TZ);
  for (let offset = 0; offset <= 2; offset += 1) {
    const dateParts = getCalendarDateOffset(hktToday, offset);
    const close = getMarketCloseForDate(dateParts);
    if (close > now) return close;
  }
  return getMarketCloseForDate(getCalendarDateOffset(hktToday, 1));
}

export function getPreviousMarketClose(now: Date = new Date()): Date | null {
  const hktToday = getZonedParts(now, HONG_KONG_TZ);
  for (let offset = 0; offset >= -2; offset -= 1) {
    const dateParts = getCalendarDateOffset(hktToday, offset);
    const close = getMarketCloseForDate(dateParts);
    if (close <= now) return close;
  }
  return null;
}

// --- Trading session / settlement window (ported from the prototype) ---

export interface SessionSegment {
  start: Date;
  end: Date;
}

export interface TradingSessionState {
  locked: boolean;
  nextClose: Date;
  anchorClose: Date;
  settlementStart: Date;
  settlementEnd: Date;
  segments: {
    before: SessionSegment;
    settlement: SessionSegment;
    after: SessionSegment;
  };
  countdownTarget: Date;
  markerPercent: number;
}

export function getTradingSessionState(now: Date = new Date()): TradingSessionState {
  const nextClose = getNextMarketClose(now);
  const previousClose = getPreviousMarketClose(now);
  const upcomingStart = new Date(nextClose.getTime() - SETTLEMENT_WINDOW_MS);
  const upcomingEnd = new Date(nextClose.getTime() + SETTLEMENT_WINDOW_MS);
  const previousStart = previousClose ? new Date(previousClose.getTime() - SETTLEMENT_WINDOW_MS) : null;
  const previousEnd = previousClose ? new Date(previousClose.getTime() + SETTLEMENT_WINDOW_MS) : null;
  const inUpcomingWindow = now >= upcomingStart && now <= upcomingEnd;
  const inPreviousWindow = Boolean(
    previousStart && previousEnd && now >= previousStart && now <= previousEnd,
  );
  const anchorClose = inPreviousWindow && previousClose ? previousClose : nextClose;
  const settlementStart = new Date(anchorClose.getTime() - SETTLEMENT_WINDOW_MS);
  const settlementEnd = new Date(anchorClose.getTime() + SETTLEMENT_WINDOW_MS);
  const closeBeforeAnchor = getPreviousMarketClose(new Date(anchorClose.getTime() - 1));
  const closeAfterAnchor = getNextMarketClose(new Date(anchorClose.getTime() + 1));
  const segmentBeforeStart = closeBeforeAnchor
    ? new Date(closeBeforeAnchor.getTime() + SETTLEMENT_WINDOW_MS)
    : new Date(settlementStart.getTime() - 1);
  const segmentAfterEnd = new Date(closeAfterAnchor.getTime() - SETTLEMENT_WINDOW_MS);
  const locked = Boolean(inUpcomingWindow || inPreviousWindow);
  const tradingStart = segmentBeforeStart;
  const tradingEnd = settlementStart;
  const tradingProgress =
    tradingEnd > tradingStart
      ? Math.min(
          1,
          Math.max(0, (now.getTime() - tradingStart.getTime()) / (tradingEnd.getTime() - tradingStart.getTime())),
        )
      : 0;
  const settlementProgress =
    settlementEnd > settlementStart
      ? Math.min(
          1,
          Math.max(
            0,
            (now.getTime() - settlementStart.getTime()) / (settlementEnd.getTime() - settlementStart.getTime()),
          ),
        )
      : 0;
  return {
    locked,
    nextClose,
    anchorClose,
    settlementStart,
    settlementEnd,
    segments: {
      before: { start: segmentBeforeStart, end: settlementStart },
      settlement: { start: settlementStart, end: settlementEnd },
      after: { start: settlementEnd, end: segmentAfterEnd },
    },
    countdownTarget: nextClose,
    markerPercent: locked ? 42 + settlementProgress * 16 : 4 + tradingProgress * 36,
  };
}

export function isSettlementLocked(now: Date = new Date()): boolean {
  return getTradingSessionState(now).locked;
}

export function shouldRefreshPrices(lastPriceRefresh: string | null): boolean {
  if (!lastPriceRefresh) return true;
  const previousClose = getPreviousMarketClose();
  const lastRefresh = new Date(lastPriceRefresh);
  if (Number.isNaN(lastRefresh.getTime())) return true;
  return Boolean(previousClose && lastRefresh < previousClose);
}

export function formatRefreshDuration(ms: number, locale: Locale): string {
  const secondsTotal = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(secondsTotal / 86400);
  const hours = Math.floor((secondsTotal % 86400) / 3600);
  const minutes = Math.floor((secondsTotal % 3600) / 60);
  const seconds = secondsTotal % 60;
  const clock = [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
  if (!days) return clock;
  return locale === "en" ? `${days}d ${clock}` : `${days}天 ${clock}`;
}

export function formatMarketCloseTime(date: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "zh-CN", {
    timeZone: HONG_KONG_TZ,
    hourCycle: "h23",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
