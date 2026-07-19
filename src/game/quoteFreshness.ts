const MS_PER_DAY = 24 * 60 * 60 * 1000;
function utcCalendarDay(date: Date): number { return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / MS_PER_DAY); }
export function isQuoteFresh(marketDate: Date | string, now: Date = new Date()): boolean {
  const parsed = typeof marketDate === "string" ? new Date(marketDate) : marketDate;
  if (!Number.isFinite(parsed.getTime()) || !Number.isFinite(now.getTime())) return false;
  const age = utcCalendarDay(now) - utcCalendarDay(parsed);
  return age >= 0 && age <= 7;
}
