import { WalletApiError, type WalletClient } from "../wallet/client";
import type { AuditEvent, Beneficiary, FundingRun, LedgerEntry, Payment, PaymentStatus, ReadinessState } from "./types";

// Fixed synthetic records for the signed-out preview; no Django request is made.
export const previewStatuses = ["draft", "authorized", "pending", "unknown", "settled", "reconciled", "reconciliation_exception", "failed"] as const;
export type PaymentPreviewScenario = (typeof previewStatuses)[number];

const university: Beneficiary = { id: "00000000-0000-4000-8000-00000000b001", name: "Synthetic University", destination_label: "MOCK-ONLY", verified: true };
const versions = { state_version: 7, budget_version: 3, analysis_version: 2 };
const term = "cost:tuition:2026-10-15";

const state: ReadinessState = {
  ...versions, semester_id: "00000000-0000-4000-8000-00000000c001",
  assets: { wallet_balance: "80000.00", currency: "THB", balance_as_of: "2026-10-11" },
  confirmed_obligations: [
    { id: term, label: "Tuition · term 1", kind: "expense", amount: "48000.00", date: "2026-10-15", certainty: "confirmed", beneficiary_id: university.id },
    { id: "cost:tuition:2027-01-15", label: "Tuition · term 2", kind: "expense", amount: "48000.00", date: "2027-01-15", certainty: "confirmed", beneficiary_id: university.id },
    { id: "cost:rent:2026-10-20", label: "Rent", kind: "expense", amount: "9000.00", date: "2026-10-20", certainty: "confirmed" },
  ],
  estimated_expenses: [
    { cost_id: "tuition", category: "tuition", label: "Tuition", amount: "48000.00", currency: "THB", invoice_id: "DEMO-2026-1", issuer: "Synthetic University", confidence_type: "VERIFIED", beneficiary_id: university.id },
    { cost_id: "rent", category: "housing", label: "Rent", amount: "9000.00", currency: "THB", confidence_type: "USER_ENTERED" },
  ],
};

const plan: FundingRun = { id: "00000000-0000-4000-8000-00000000d001", created_at: "2026-10-11T02:00:00Z", kind: "funding", ...versions, result: { validation: "VALID" } };

function payment(status: PaymentStatus): Payment {
  const id = "00000000-0000-4000-8000-00000000e001";
  const submitted = !["draft", "authorized"].includes(status);
  const settled = ["settled", "reconciled", "reconciliation_exception"].includes(status);
  return {
    id, created_at: "2026-10-11T02:05:00Z", plan: null, readiness_plan: plan.id, beneficiary: university.id,
    event_id: term, amount: "48000.00", due_on: "2026-10-15", status,
    // An authorized preview stays inside its 15-minute window so it shows the submit step.
    authorized_until: status === "draft" ? null : status === "authorized" ? new Date(Date.now() + 15 * 60_000).toISOString() : "2026-10-11T02:21:00Z",
    submitted_at: submitted ? "2026-10-11T02:08:00Z" : null,
    receipt: settled ? { reference: `mock:${id}`, operation_key: id, event_id: term, amount: "48000.00", currency: "THB",
      beneficiary_id: university.id, is_simulated: true, settled_on: "2026-10-11", invoice_id: "DEMO-2026-1", issuer: "Synthetic University" } : null,
    invoice_snapshot: { invoice_id: "DEMO-2026-1", issuer: "Synthetic University", currency: "THB", amount: "48000.00", due_date: "2026-10-15" },
    is_simulated: true,
  };
}

function audit(item: Payment): AuditEvent[] {
  const steps: [string, string][] = [["payment.created", "02:05"]];
  if (item.authorized_until) steps.push(["payment.authorized", "02:06"]);
  if (item.submitted_at) steps.push(["auth.step_up_granted", "02:07"], ["payment.mock_submitted", "02:08"]);
  if (item.status === "unknown") steps.push(["payment.mock_unknown", "02:20"]);
  if (item.status === "failed") steps.push(["payment.mock_failed", "02:20"]);
  if (item.receipt) steps.push(["payment.mock_settled", "02:30"]);
  if (item.status === "reconciled") steps.push(["payment.reconciled", "02:31"]);
  if (item.status === "reconciliation_exception") steps.push(["payment.invoice_mismatch", "02:31"]);
  return steps.reverse().map(([action, time], n) => ({
    id: `pa${n}`, action, entity_id: action.startsWith("auth.") ? "00000000-0000-4000-8000-00000000f001" : item.id,
    created_at: `2026-10-11T${time}:00Z`,
    details: { actor_id: action.startsWith("payment.mock_") && action !== "payment.mock_submitted" ? 2 : 1,
      ...(action.startsWith("auth.") ? { action: "payment.submit", target_id: item.id, amount: item.amount, currency: "THB" } : {}) },
  }));
}

export function createPaymentsPreview(scenario: PaymentPreviewScenario): WalletClient {
  const item = payment(scenario);
  const ledger: LedgerEntry[] = item.receipt ? [{ id: "l1", sequence: 4, payment: item.id, amount: "-48000.00", currency: "THB", created_at: "2026-10-11T02:30:00Z" }] : [];
  const page = <T,>(results: T[]) => ({ count: results.length, next: null, previous: null, results });
  const routes: Record<string, unknown> = {
    "readiness/state/": state, "readiness/funding-plans/": [plan], "beneficiaries/": page([university]),
    "payments/": page([item]), "approvals/": page([]), "ledger/": page(ledger), "audit/": page(audit(item)),
  };
  return {
    async get<T>(path: string): Promise<T> {
      if (path in routes) return routes[path] as T;
      throw new WalletApiError(404, { detail: "Not available in the preview." });
    },
    async post<T>(): Promise<T> {
      throw new WalletApiError(0, { detail: "The preview is read-only." });
    },
  };
}
