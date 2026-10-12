import type { Corridor, Quote } from "../types";

/** Corridor as listed by `GET corridors/` (only enabled rows are returned). */
export type FxCorridor = Corridor & { enabled?: boolean; fee_fixed?: string; fee_percent?: string; fx_margin_bps?: number };
export type ExecQuote = Quote & { quoted_amount?: string; corridor?: string | null; mid_rate?: string | null };
export type Direction = { source: string; target: string };
export type Conversion = {
  id: string; created_at: string; quote?: string; quote_id?: string; source_currency: string; source_amount: string;
  target_currency: string; target_amount: string; rate: string; sender_fee: string; receiver_fee: string;
  effective_on: string; is_simulated: boolean; debit_sequence?: number; credit_sequence?: number;
};
export type LedgerEntry = {
  id: string; created_at: string; installment: string | null; sequence: number; funding_source: string | null;
  disbursement: string | null; payment: string | null; conversion: string | null; remittance_order: string | null;
  remittance_leg: "debit" | "refund" | "credit" | null; currency: string; amount: string; effective_on: string;
};
export type LedgerOrigin = "funding" | "disbursement" | "payment" | "conversion" | "transfer_debit" | "transfer_refund" | "transfer_credit" | "installment" | "unknown";
export type AmountProblem = "" | "format" | "precision" | "below" | "above";

const TIER_ORDER = ["express", "standard", "economy"];

/** Distinct seeded corridor directions, in first-seen order. */
export function directions(corridors: FxCorridor[]): Direction[] {
  const seen = new Map<string, Direction>();
  for (const row of corridors) {
    if (row.enabled === false || row.source_currency === row.target_currency) continue;
    const key = `${row.source_currency}>${row.target_currency}`;
    if (!seen.has(key)) seen.set(key, { source: row.source_currency, target: row.target_currency });
  }
  return [...seen.values()];
}

/** Source currencies that have a corridor and, when balances are known, a balance to debit. */
export function sourceCurrencies(list: Direction[], held: string[] | null): string[] {
  const sources = [...new Set(list.map((item) => item.source))];
  return held ? sources.filter((currency) => held.includes(currency)) : sources;
}

export function targetCurrencies(list: Direction[], source: string): string[] {
  return list.filter((item) => item.source === source).map((item) => item.target);
}

/** Every tier of one direction, express first. */
export function tiersFor(corridors: FxCorridor[], source: string, target: string): FxCorridor[] {
  return corridors.filter((row) => row.enabled !== false && row.source_currency === source && row.target_currency === target)
    .sort((a, b) => rank(a.tier) - rank(b.tier));
}
const rank = (tier: string) => { const index = TIER_ORDER.indexOf(tier); return index < 0 ? TIER_ORDER.length : index; };

/** The widest amount any tier accepts; each tier still checks its own range when quoting. */
export function amountRange(tiers: FxCorridor[]): { min: string; max: string } | null {
  if (!tiers.length) return null;
  const min = tiers.reduce((low, row) => Number(row.min_amount) < Number(low) ? row.min_amount : low, tiers[0].min_amount);
  const max = tiers.reduce((high, row) => Number(row.max_amount) > Number(high) ? row.max_amount : high, tiers[0].max_amount);
  return { min, max };
}

/** Mirrors the backend checks: a positive decimal with at most two places inside the corridor range. */
export function amountProblem(value: string, range: { min: string; max: string } | null): AmountProblem {
  const raw = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(raw) || !(Number(raw) > 0)) return "format";
  if (/\.\d{3,}$/.test(raw)) return "precision";
  if (range && Number(raw) < Number(range.min)) return "below";
  if (range && Number(raw) > Number(range.max)) return "above";
  return "";
}

/** Exactly one origin foreign key is set on a ledger entry; transfers also carry their leg. */
export function ledgerOrigin(entry: LedgerEntry): LedgerOrigin {
  if (entry.funding_source) return "funding";
  if (entry.disbursement) return "disbursement";
  if (entry.payment) return "payment";
  if (entry.conversion) return "conversion";
  if (entry.installment) return "installment";
  if (entry.remittance_order) return entry.remittance_leg ? `transfer_${entry.remittance_leg}` as LedgerOrigin : "unknown";
  return "unknown";
}

export function quoteSecondsLeft(quote: Pick<Quote, "expires_at">, now: number): number {
  const at = Date.parse(quote.expires_at);
  return Number.isNaN(at) ? 0 : Math.max(0, Math.floor((at - now) / 1000));
}
export const quoteExpired = (quote: Pick<Quote, "expires_at">, now: number) => quoteSecondsLeft(quote, now) <= 0;
export const countdown = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/** The amount a quote debits; only this exact amount can be converted. */
export const quotedAmount = (quote: ExecQuote) => quote.quoted_amount ?? quote.send_amount ?? "";

/** Same-origin `/api/v2/` pagination only, as in getAll(); returns the client path or null. */
export function nextPagePath(next: string | null, origin: string): string | null {
  if (!next) return null;
  const url = new URL(next, origin);
  if (url.origin !== new URL(origin).origin || !url.pathname.startsWith("/api/v2/")) return null;
  return url.pathname.slice("/api/v2/".length) + url.search;
}

export const ledgerCurrencies = (rows: LedgerEntry[]) => [...new Set(rows.map((row) => row.currency))].sort();
/** Splits a signed decimal string so credits read "+" and debits "−" next to a formatted amount. */
export function signedParts(amount: string): { sign: "+" | "−"; abs: string } {
  const raw = amount.trim();
  return raw.startsWith("-") ? { sign: "−", abs: raw.slice(1) } : { sign: "+", abs: raw.replace(/^\+/, "") };
}
