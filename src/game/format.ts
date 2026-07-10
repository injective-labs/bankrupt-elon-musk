import type { Locale } from "@/types";

export function formatCurrency(value: number, compact = false): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: compact ? 2 : 0,
    notation: compact ? "compact" : "standard",
  }).format(value);
}

export function formatNumber(value: number, locale: Locale): string {
  return new Intl.NumberFormat(locale === "en" ? "en-US" : "zh-CN", {
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatPercentValue(value: number): string {
  if (!Number.isFinite(value)) return "0.00%";
  return `${(value * 100).toFixed(2)}%`;
}

export function formatFxRate(currency: string, rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) return "--";
  if (currency === "KRW" || currency === "JPY" || currency === "GBp") return `$${rate.toFixed(5)}`;
  if (rate < 0.1) return `$${rate.toFixed(4)}`;
  return `$${rate.toFixed(3)}`;
}
