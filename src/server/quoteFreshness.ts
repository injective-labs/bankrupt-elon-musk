const MS_PER_DAY = 24 * 60 * 60 * 1000;

function utcCalendarDay(date: Date): number {
  return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / MS_PER_DAY);
}

export function isQuoteFresh(marketDate: Date, now: Date = new Date()): boolean {
  const age = utcCalendarDay(now) - utcCalendarDay(marketDate);
  return age >= 0 && age <= 7;
}
