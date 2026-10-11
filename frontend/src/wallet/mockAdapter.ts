import { WalletApiError, type WalletClient } from "./client";
import type { Approval, Beneficiary, Corridor, Order, Page, Quote, WalletBalances } from "./types";

// Fixed, synthetic B-shaped responses. Preview actions never call Django or move money.
const balances: WalletBalances = { home_currency: "THB", is_simulated: true, balances: [
  { currency: "THB", balance: "52500.00", available_balance: "47500.00", is_home: true, indicative_home_value: "52500.00", valuation: null },
  { currency: "USD", balance: "750.00", available_balance: "750.00", is_home: false, indicative_home_value: "24750.00", valuation: { source: "fixture" } },
] };
const corridors: Corridor[] = [
  { id: "preview-standard", code: "usd-thb-standard", provider: "Example route", tier: "standard", source_currency: "USD", target_currency: "THB", min_amount: "10.00", max_amount: "1500.00", settlement_min_days: 2, settlement_days: 4, is_simulated: true },
  { id: "preview-express", code: "usd-thb-express", provider: "Example route", tier: "express", source_currency: "USD", target_currency: "THB", min_amount: "10.00", max_amount: "1500.00", settlement_min_days: 0, settlement_days: 1, is_simulated: true },
];
const beneficiaries: Beneficiary[] = [
  { id: "preview-school", name: "Example International University", destination_label: "Tuition office", verified: true },
  { id: "preview-pending", name: "Campus housing", destination_label: "Housing office", verified: false },
];
const quotes: Quote[] = [
  { id: "preview-quote-standard", corridor_id: "preview-standard", route_name: "Example route (standard)", source_currency: "USD", target_currency: "THB", send_amount: "200.00", net_received: "6520.00", rate: "33.0000000000", sender_fee: "2.00", receiver_fee: "14.00", settlement_min_days: 2, settlement_days: 4, expires_at: "", rate_source: "fixture", rate_date: "2026-10-08", is_mock: true },
  { id: "preview-quote-express", corridor_id: "preview-express", route_name: "Example route (express)", source_currency: "USD", target_currency: "THB", send_amount: "200.00", net_received: "6480.00", rate: "32.9000000000", sender_fee: "3.00", receiver_fee: "1.00", settlement_min_days: 0, settlement_days: 1, expires_at: "", rate_source: "fixture", rate_date: "2026-10-08", is_mock: true },
];
const baseOrder: Order = {
  id: "preview-order", version: 2, quote: quotes[0].id, status: "SUBMITTED", effective_status: "SUBMITTED", recipient: "BENEFICIARY", beneficiary: beneficiaries[0].id,
  purpose: "tuition", reference: "Autumn tuition", send_currency: "USD", send_amount: "200.00", sender_fee: "2.00", receive_currency: "THB", receive_amount: "6520.00", rate: "33.0000000000", total_cost: "3.00",
  expected_earliest: "2026-10-10", expected_latest: "2026-10-12", deadline: "2026-10-20", submitted_at: "2026-10-08T09:00:00Z", delivered_on: null, failure_reason: "",
  history: [{ from: "", to: "CREATED", version: 1, at: "2026-10-08T08:00:00Z", note: "" }, { from: "CREATED", to: "SUBMITTED", version: 2, at: "2026-10-08T09:00:00Z", note: "" }], is_simulated: true,
};
export type WalletPreviewScenario = "submitted" | "pending" | "refunded" | "unknown" | "expired" | "empty";
// Preview quotes stay current for an hour from when they are shown, whatever today's date is.
export function previewQuotes() {
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  return structuredClone(quotes).map((quote) => ({ ...quote, expires_at: expiresAt }));
}
export function createWalletPreview(scenario: WalletPreviewScenario): WalletClient {
  const order = structuredClone(baseOrder);
  if (scenario === "pending") { order.status = "CREATED"; order.effective_status = "CREATED"; order.version = 1; order.submitted_at = null; order.history = order.history.slice(0, 1); }
  if (scenario === "refunded") { order.status = "REFUNDED"; order.effective_status = "REFUNDED"; order.failure_reason = "Simulated route failed; sender amount refunded by B."; order.version = 3; order.history.push({ from: "SUBMITTED", to: "REFUNDED", version: 3, at: "2026-10-09T10:00:00Z", note: "Simulated route failure" }); }
  if (scenario === "unknown") { order.status = "UNKNOWN"; order.effective_status = "UNKNOWN"; order.version = 3; order.history.push({ from: "SUBMITTED", to: "UNKNOWN", version: 3, at: "2026-10-09T10:00:00Z", note: "Waiting for backend reconciliation" }); }
  if (scenario === "expired") { order.status = "EXPIRED"; order.effective_status = "EXPIRED"; order.version = 2; order.history = [order.history[0], { from: "CREATED", to: "EXPIRED", version: 2, at: "2026-10-09T10:00:00Z", note: "Quote expired" }]; }
  const approval: Approval = { id: "preview-approval", action: "remittance.submit", target_id: order.id, amount: order.send_amount, currency: order.send_currency, status: "PENDING", expires_at: "2026-10-09T09:00:00Z", version: 1 };
  const page = <T,>(results: T[]): Page<T> => ({ count: results.length, next: null, previous: null, results });
  const responses: Record<string, unknown> = {
    "demo/wallets/balances/": balances, "corridors/": corridors,
    "beneficiaries/": page(beneficiaries), "remittance-orders/": page(scenario === "empty" ? [] : [order]),
    "approvals/": page(scenario === "pending" ? [approval] : []),
    [`remittance-orders/${order.id}/`]: order,
  };
  return {
    async get<T>(path: string): Promise<T> {
      if (!(path in responses)) throw new WalletApiError(404, { detail: "Preview route unavailable." });
      return structuredClone(responses[path]) as T;
    },
    async post<T>(): Promise<T> { throw new WalletApiError(403, { detail: "This preview is read-only. Connect a Django student session for commands." }); },
  };
}
