import { createContext, useContext } from "react";
import { intlLocale, type Lang } from "../i18n";

/** Currencies a family can read every price in; schools keep their own currency underneath. */
export const DISPLAY_CURRENCIES = ["THB", "CNY", "USD"] as const;
export type DisplayCurrency = typeof DISPLAY_CURRENCIES[number];
/** GET planning/rates/: THB per unit of each currency, one reference date for all of them. */
export type DisplayRates = { thb_per_unit: Record<string, string>; rate_date: string | null; source: string | null };

export function displayCurrency(value: string | null | undefined): DisplayCurrency {
  return DISPLAY_CURRENCIES.find(item => item === value) ?? "THB";
}

const SYMBOLS: Record<string, string> = { THB: "฿", CNY: "¥", USD: "$", GBP: "£", AUD: "A$", SGD: "S$", MYR: "RM", JPY: "JP¥", EUR: "€" };

/** "฿2,351,350": a symbol and whole units for large amounts; unknown currencies keep their code. */
export function cash(value: number | string | null | undefined, currency: string, lang: Lang): string {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  const digits = Math.abs(number) >= 100 || Number.isInteger(number) ? 0 : 2;
  const text = Math.abs(number).toLocaleString(intlLocale(lang), { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const symbol = SYMBOLS[currency];
  return `${number < 0 ? "−" : ""}${symbol ?? ""}${text}${symbol ? "" : ` ${currency}`}`;
}

/** An amount in `from` expressed in `to`, or null when either rate is missing. */
export function convertAmount(value: number | string, from: string, to: string, rates: DisplayRates | null): number | null {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  if (from === to) return number;
  const source = Number(rates?.thb_per_unit[from]), target = Number(rates?.thb_per_unit[to]);
  if (!source || !target) return null;
  return number * source / target;
}

export type DisplayState = { currency: DisplayCurrency; rates: DisplayRates | null };
export const DisplayContext = createContext<DisplayState>({ currency: "THB", rates: null });

/** Price shown in the chosen currency: `main` is what to print large, `original` the school's own figure when it differs. */
export type Shown = { main: string; original: string | null; approx: boolean; value: number | null };

export function useShow() {
  const state = useContext(DisplayContext);
  return (value: number | string | null | undefined, from: string, lang: Lang): Shown => {
    if (value === null || value === undefined || value === "") return { main: "—", original: null, approx: false, value: null };
    const converted = convertAmount(value, from, state.currency, state.rates);
    if (converted === null) return { main: cash(value, from, lang), original: null, approx: false, value: null };
    const approx = from !== state.currency;
    return { main: `${approx ? "≈ " : ""}${cash(converted, state.currency, lang)}`, original: approx ? cash(value, from, lang) : null, approx, value: converted };
  };
}

export const useDisplay = () => useContext(DisplayContext);

// Mid-rates from the backend fixture (finance/fx_rates.py), for the recorded preview that has no server.
export const PREVIEW_RATES: DisplayRates = {
  thb_per_unit: { THB: "1", USD: "33.00", EUR: "36.50", CNY: "4.60", GBP: "42.00", JPY: "0.2200", AUD: "21.50", SGD: "25.00", MYR: "7.40" },
  rate_date: null, source: "fixture",
};
