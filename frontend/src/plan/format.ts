import { intlLocale, type Lang } from "../i18n";
import type { Text } from "./types";

/** "1,234,567 THB": whole units for large amounts, cents only when they matter. */
export function money(value: string | number | null | undefined, currency = "", lang: Lang = "en"): string {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  const digits = Math.abs(number) >= 100 || Number.isInteger(number) ? 0 : 2;
  const text = number.toLocaleString(intlLocale(lang), { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return currency ? `${text} ${currency}` : text;
}

export function pick(text: Text | null | undefined, lang: Lang): string {
  if (!text) return "";
  return text[lang] || text.en || "";
}

export function day(value: string | null | undefined, lang: Lang): string {
  if (!value) return "—";
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? value
    : new Intl.DateTimeFormat(intlLocale(lang), { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(parsed);
}

export function percent(value: string | number, lang: Lang): string {
  return Number(value).toLocaleString(intlLocale(lang), { maximumFractionDigits: 0 });
}
