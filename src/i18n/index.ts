import type { Locale, BilingualLabel } from "@/types";
import { I18N } from "./strings";

export { I18N } from "./strings";

export function t(locale: Locale, key: string): string {
  return I18N[locale]?.[key] || I18N.zh[key] || key;
}

export function labelFrom(
  map: Record<string, BilingualLabel>,
  key: string,
  locale: Locale,
): string {
  const label = map[key];
  if (!label) return key;
  return label[locale] || label.zh || key;
}
