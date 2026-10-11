import { intlLocale, translate, type Lang } from "../i18n";

/** Presentation only: preserve B's decimal strings and status codes unchanged. */
export function formatAmount(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const raw = value.trim();
  const match = /^(-?)(\d+)(\.\d+)?$/.exec(raw);
  if (!match) return raw;
  return `${match[1]}${match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${match[3] ?? ""}`;
}

// `lang` defaults to English so pure callers (and the unit tests) keep the original wording;
// components pass the interface language from useI18n().
export function formatMoney(value: unknown, currency = "THB", lang: Lang = "en"): string {
  const amount = formatAmount(value);
  return amount == null ? translate(lang, "fmt.noAmount") : `${currency} ${amount}`;
}

export function formatDate(value: unknown, lang: Lang = "en"): string {
  if (typeof value !== "string" || !value) return translate(lang, "fmt.noDate");
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat(intlLocale(lang), { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(parsed);
}

/** Day of a timestamp in the viewer's time zone; slicing the UTC string can show the previous day. */
export function formatTimestampDate(value: unknown, lang: Lang = "en"): string {
  if (typeof value !== "string" || !value) return translate(lang, "fmt.noDate");
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat(intlLocale(lang), { day: "numeric", month: "short", year: "numeric" }).format(parsed);
}

const label = (value: string) => value.replaceAll("_", " ").replaceAll("-", " ").toLowerCase();
const explained = ["MISSING", "MISSING_PROFILE", "CONFLICT", "RESERVE_NOT_CONFIRMED", "RECEIPT_UNCONFIRMED", "INSUFFICIENT_DATA", "CONDITIONAL", "INVALID", "VALID", "AFFORDABLE", "UNAFFORDABLE", "UNDER_REVIEW", "DRAFT", "APPROVED", "REJECTED"] as const;

export function explainCode(code: string, lang: Lang = "en"): string {
  const [kind, detail] = code.split(":", 2);
  const item = detail ? label(detail) : translate(lang, "code.thisItem");
  const known = explained.find((value) => value === kind);
  return known ? translate(lang, `code.${known}`, { item }) : label(code).replace(/^\w/, (letter) => letter.toUpperCase());
}
