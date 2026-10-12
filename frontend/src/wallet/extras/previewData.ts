import type { Conversion, ExecQuote, FxCorridor, LedgerEntry } from "./logic";

// Fixed synthetic records for `?wallet=preview`; WalletExtras makes no requests in preview.
const route = (id: string, source: string, target: string, tier: string, min: string, max: string, days: [number, number]): FxCorridor => ({
  id, code: `${source.toLowerCase()}-${target.toLowerCase()}-${tier}`, provider: "Example route", tier, source_currency: source, target_currency: target,
  min_amount: min, max_amount: max, settlement_min_days: days[0], settlement_days: days[1], is_simulated: true, enabled: true });

export const previewHome = "THB";
export const previewHeld = ["THB", "USD", "CNY"];
export const previewCorridors: FxCorridor[] = [
  route("px-usd-express", "USD", "THB", "express", "10.00", "1500.00", [0, 0]),
  route("px-usd-standard", "USD", "THB", "standard", "10.00", "3000.00", [0, 0]),
  route("px-cny-standard", "CNY", "THB", "standard", "100.00", "20000.00", [0, 0]),
  route("px-thb-standard", "THB", "CNY", "standard", "500.00", "50000.00", [0, 0]),
];

export function previewQuotes(now = Date.now()): ExecQuote[] {
  const base = { source_currency: "USD", target_currency: "THB", send_amount: "200.00", quoted_amount: "200.00", settlement_min_days: 0, settlement_days: 0,
    rate_source: "fixture", rate_date: "2026-10-09", is_mock: true, receiver_fee: "0.00", consumed_at: null };
  return [
    { ...base, id: "px-quote-express", corridor_id: "px-usd-express", route_name: "Example route (express)", rate: "32.8000000000", sender_fee: "3.00", net_received: "6461.60", expires_at: new Date(now + 480_000).toISOString() },
    { ...base, id: "px-quote-standard", corridor_id: "px-usd-standard", route_name: "Example route (standard)", rate: "33.0500000000", sender_fee: "1.50", net_received: "6560.43", expires_at: new Date(now + 540_000).toISOString() },
  ];
}

export const previewConversions: Conversion[] = [
  { id: "px-conversion-1", created_at: "2026-10-08T03:12:00Z", quote: "px-quote-old", source_currency: "USD", source_amount: "150.00", target_currency: "THB",
    target_amount: "4893.00", rate: "33.0000000000", sender_fee: "1.50", receiver_fee: "0.00", effective_on: "2026-10-08", is_simulated: true, debit_sequence: 3, credit_sequence: 4 },
];

const row = (id: string, sequence: number, effective_on: string, currency: string, amount: string, origin: Partial<LedgerEntry>): LedgerEntry => ({
  id, created_at: `${effective_on}T03:00:00Z`, installment: null, sequence, funding_source: null, disbursement: null, payment: null, conversion: null,
  remittance_order: null, remittance_leg: null, currency, amount, effective_on, ...origin });

export const previewLedger: LedgerEntry[] = [
  row("px-l6", 6, "2026-10-10", "THB", "-12000.00", { payment: "px-payment" }),
  row("px-l5", 5, "2026-10-09", "THB", "20000.00", { disbursement: "px-disbursement" }),
  row("px-l4", 4, "2026-10-08", "THB", "4893.00", { conversion: "px-conversion-1" }),
  row("px-l3", 3, "2026-10-08", "USD", "-150.00", { conversion: "px-conversion-1" }),
  row("px-l2", 2, "2026-10-05", "USD", "-200.00", { remittance_order: "px-order", remittance_leg: "debit" }),
  row("px-l1", 1, "2026-10-01", "USD", "1100.00", { funding_source: "px-savings" }),
];
