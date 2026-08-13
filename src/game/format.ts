import type { Locale } from "@/types";

export function formatCurrency(value: number, compact = false): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: compact ? 2 : 0,
    notation: compact ? "compact" : "standard",
  }).format(value);
}

/** Formats an API decimal without first coercing it through IEEE-754. */
export function formatDecimalCurrency(value: string, fractionDigits = 2): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return "$--";
  const [, sign, rawInteger, rawFraction = ""] = match;
  const integer = rawInteger.replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = rawFraction.padEnd(fractionDigits, "0").slice(0, fractionDigits);
  return `${sign ? "-$" : "$"}${integer}${fractionDigits ? `.${fraction}` : ""}`;
}

export function formatDecimalNumber(value: string, locale: Locale, maximumFractionDigits = 8): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return "--";
  const [, sign, integer, rawFraction = ""] = match;
  const grouped = integer.replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, locale === "zh" ? "," : ",");
  const fraction = rawFraction.slice(0, maximumFractionDigits).replace(/0+$/, "");
  return `${sign}${grouped}${fraction ? `.${fraction}` : ""}`;
}

function decimalParts(value: string): { coefficient: bigint; scale: bigint } | null {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return null;
  const fraction = match[2] ?? "";
  return { coefficient: BigInt(`${match[1]}${fraction}`), scale: 10n ** BigInt(fraction.length) };
}

export function floorDecimalDivision(dividend: string, divisor: string): string {
  const left = decimalParts(dividend); const right = decimalParts(divisor);
  if (!left || !right || right.coefficient === 0n) return "0";
  return ((left.coefficient * right.scale) / (right.coefficient * left.scale)).toString();
}

export function multiplyDecimalByInteger(decimal: string, integer: string): string {
  const value = decimalParts(decimal);
  if (!value || !/^(?:0|[1-9]\d*)$/.test(integer)) return "0";
  const product = value.coefficient * BigInt(integer);
  if (value.scale === 1n) return product.toString();
  const scaleDigits = value.scale.toString().length - 1;
  const digits = product.toString().padStart(scaleDigits + 1, "0");
  const whole = digits.slice(0, -scaleDigits);
  const fraction = digits.slice(-scaleDigits).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

export function integerFraction(value: string, numerator: bigint, denominator: bigint): string {
  if (!/^(?:0|[1-9]\d*)$/.test(value) || denominator <= 0n) return "0";
  return (BigInt(value) * numerator / denominator).toString();
}

export function isPositiveDecimal(value: string): boolean {
  const parts = decimalParts(value);
  return Boolean(parts && parts.coefficient > 0n);
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

export function formatAddress(address: string): string {
  if (!address || address.length <= 8) return address || "";
  return `${address.slice(0, 3)}...${address.slice(-4)}`;
}
