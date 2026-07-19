const MS_PER_DAY = 24 * 60 * 60 * 1000;

function utcCalendarDay(date: Date): number {
  return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / MS_PER_DAY);
}

export function isQuoteFresh(marketDate: Date, now: Date = new Date()): boolean {
  return utcCalendarDay(now) - utcCalendarDay(marketDate) <= 7;
}
