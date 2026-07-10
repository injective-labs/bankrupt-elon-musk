import type { Locale } from "@/types";
import {
  NEW_YORK_TZ,
  HONG_KONG_TZ,
  MARKET_CLOSE_HOUR_NY,
  MARKET_CLOSE_MINUTE_NY,
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

function getCalendarWeekday(dateParts: { year: number; month: number; day: number }): number {
  return new Date(Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day)).getUTCDay();
}

function isWeekday(dateParts: { year: number; month: number; day: number }): boolean {
  const weekday = getCalendarWeekday(dateParts);
  return weekday >= 1 && weekday <= 5;
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
      hour: MARKET_CLOSE_HOUR_NY,
      minute: MARKET_CLOSE_MINUTE_NY,
      second: 0,
    },
    NEW_YORK_TZ,
  );
}

export function getNextMarketClose(now: Date = new Date()): Date {
  const nyToday = getZonedParts(now, NEW_YORK_TZ);
  for (let offset = 0; offset <= 10; offset += 1) {
    const dateParts = getCalendarDateOffset(nyToday, offset);
    if (!isWeekday(dateParts)) continue;
    const close = getMarketCloseForDate(dateParts);
    if (close > now) return close;
  }
  return getMarketCloseForDate(getCalendarDateOffset(nyToday, 1));
}

export function getPreviousMarketClose(now: Date = new Date()): Date | null {
  const nyToday = getZonedParts(now, NEW_YORK_TZ);
  for (let offset = 0; offset >= -10; offset -= 1) {
    const dateParts = getCalendarDateOffset(nyToday, offset);
    if (!isWeekday(dateParts)) continue;
    const close = getMarketCloseForDate(dateParts);
    if (close <= now) return close;
  }
  return null;
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
