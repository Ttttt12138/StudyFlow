import { WalletApiError, type WalletClient } from "../wallet/client";
import type { Briefing, CheckJob, PreviewRow, ReadinessState, RecurringExpense, RiskCard, Transaction, TransactionImport } from "./types";

// Fixed synthetic records for the signed-out preview; no Django request is made.
const versions = { state_version: 9, budget_version: 6, analysis_version: 4 };
const account = "00000000-0000-4000-8000-0000000000a1";

const state: ReadinessState = {
  ...versions, semester_id: "00000000-0000-4000-8000-00000000c001",
  assets: { currency: "THB", balance_as_of: "2026-10-11", wallet_balance: "61250.00" },
  estimated_expenses: [
    { cost_id: "tuition", category: "tuition", amount: "30000.00", period: "semester" },
    { cost_id: "housing", category: "housing", amount: "9000.00", period: "monthly" },
    { cost_id: "food", category: "food", amount: "3000.00", period: "monthly" },
    { cost_id: "transport", category: "transport", amount: "1500.00", period: "monthly" },
    { cost_id: "communications", category: "communications", amount: "500.00", period: "monthly" },
  ],
};

const classify = (category: PreviewRow["classification"]["category"], basis: string, confidence = 0.85) =>
  ({ category, basis, confidence, rule_version: "spending-1.0", source_type: "inferred" });
const row = (n: number, date: string, amount: string, counterparty: string, description: string, category: PreviewRow["classification"]["category"], extra: Partial<PreviewRow> = {}): PreviewRow => ({
  locator: `row:${n}`, transaction_id: `10-${n}`, account_id: "demo-main", date, amount, currency: "THB", counterparty, description,
  status: "READY", duplicate: false, suspected_duplicate: false, classification: classify(category, category === "Other" ? "No matching rule; review required" : category.toLowerCase(), category === "Other" ? 0.2 : 0.85), ...extra,
});

const pending: TransactionImport = {
  id: "00000000-0000-4000-8000-0000000001b2", created_at: "2026-10-11T03:10:00Z", sha256: "preview-october", source_type: "user_uploaded", status: "NEEDS_REVIEW",
  preview: {
    rows: [
      row(2, "2026-10-01", "-9000.00", "Demo Condo", "Monthly rent", "Rent", { transaction_id: "7-rent", duplicate: true }),
      row(3, "2026-10-02", "-142.00", "Demo Cafe", "Food and groceries", "Food"),
      row(4, "2026-10-03", "-300.00", "Demo AIS", "Mobile plan", "Mobile"),
      row(5, "2026-10-03", "-118.00", "Demo Cafe", "Food and groceries", "Food", { transaction_id: null, suspected_duplicate: true }),
      row(6, "2026-10-05", "-1200.00", "Demo Bus", "Transport pass", "Transport"),
      row(7, "2026-10-06", "-199.00", "Demo Music", "Music subscription", "Subscription"),
      row(8, "2026-10-08", "-450.00", "Night Market", "Weekend stall", "Other"),
    ],
    issues: [{ code: "INVALID_CSV_ROW", locator: "row:9", message: "Check required fields, ISO date, THB currency and monetary precision." }],
  },
  confirmation: {},
};
const committed: TransactionImport = {
  id: "00000000-0000-4000-8000-0000000001b1", created_at: "2026-10-02T08:30:00Z", sha256: "preview-history", source_type: "synthetic", status: "COMMITTED",
  preview: { rows: [], issues: [] },
  confirmation: { selected_rows: Array.from({ length: 99 }, (_, n) => `row:${n + 2}`), keep_similar_rows: [], coverage: [{ account_id: "demo-main", start: "2026-07-01", end: "2026-09-30", complete: true }] },
};

const briefing: Briefing = {
  status: "AT_RISK", as_of: "2026-10-11", ...versions, earliest_risk_date: "2026-12-05",
  risks: { spending_increased: { cost_ids: ["food"] } },
  forecast_changes: {
    as_of: "2026-10-11", complete_months: ["2026-07", "2026-08", "2026-09"], unresolved_transactions: true,
    costs: [
      { cost_id: "food", category: "food", original_amount: "3000.00", actual_amount: "1420.00", suggested_monthly: "4310.00", forecast_amount: "4310.00", applied: true, reason: "MONTHLY_MEDIAN", sample_months: 3, synthetic: true },
      { cost_id: "transport", category: "transport", original_amount: "1500.00", actual_amount: "1200.00", suggested_monthly: "1200.00", forecast_amount: "1200.00", applied: true, reason: "MONTHLY_MEDIAN", sample_months: 3, synthetic: true },
      { cost_id: "communications", category: "communications", original_amount: "500.00", actual_amount: "300.00", suggested_monthly: "300.00", forecast_amount: "300.00", applied: true, reason: "MONTHLY_MEDIAN", sample_months: 3, synthetic: true },
      { cost_id: "housing", category: "housing", original_amount: "9000.00", actual_amount: "9000.00", suggested_monthly: "9000.00", forecast_amount: "9000.00", applied: false, reason: "LOCKED_OR_CONTRACTUAL", sample_months: 3, synthetic: true },
      { cost_id: "tuition", category: "tuition", original_amount: "30000.00", actual_amount: "0.00", suggested_monthly: "0.00", forecast_amount: "30000.00", applied: false, reason: "LOCKED_OR_CONTRACTUAL", sample_months: 3, synthetic: true },
    ],
  },
};

const tx = (n: number, date: string, amount: string, counterparty: string, description: string, category: Transaction["category"], extra: Partial<Transaction> = {}): Transaction => ({
  id: `00000000-0000-4000-8000-00000000f${String(n).padStart(3, "0")}`, created_at: "2026-10-02T08:30:00Z", account, batch: committed.id, external_id: `9-${n}`,
  locator: `row:${n}`, date, amount, currency: "THB", counterparty, description, category,
  classification: { category, basis: category.toLowerCase(), confidence: 0.85, source_type: "inferred" }, needs_review: false, cost_id: "", refund_of: null, ...extra,
});
const transactions: Transaction[] = [
  tx(101, "2026-09-30", "-164.00", "Demo Cafe", "Food and groceries", "Food"),
  tx(100, "2026-09-28", "-640.00", "Campus Print", "Poster printing", "Other", { needs_review: true, classification: { category: "Other", basis: "No matching rule; review required", confidence: 0.2, source_type: "inferred" } }),
  tx(99, "2026-09-25", "50.00", "Demo Cafe", "Food refund", "Refund", { needs_review: true }),
  tx(98, "2026-09-05", "-9000.00", "Demo Condo", "Monthly rent", "Rent", { cost_id: "housing" }),
  tx(97, "2026-09-05", "-300.00", "Demo AIS", "Mobile plan", "Mobile", { cost_id: "communications" }),
  tx(96, "2026-09-05", "-1200.00", "Demo Bus", "Transport pass", "Transport"),
  tx(95, "2026-09-05", "-199.00", "Demo Music", "Music subscription", "Subscription"),
  tx(94, "2026-09-01", "15000.00", "Family transfer", "Monthly support", "Income"),
];

const recurring: RecurringExpense[] = [
  { id: "00000000-0000-4000-8000-0000000002r1", created_at: "2026-10-02T08:31:00Z", account, merchant_key: "demo condo", decision: "inferred", cost_id: "", active: true,
    result: { category: "rent", counterparty: "Demo Condo", amount: "9000.00", currency: "THB", frequency: "monthly", expected_next_date: "2026-11-05", confidence_type: "INFERRED", basis: "3 monthly payments within 3 days", supporting_transaction_ids: [] } },
  { id: "00000000-0000-4000-8000-0000000002r2", created_at: "2026-10-02T08:31:00Z", account, merchant_key: "demo ais", decision: "accepted", cost_id: "communications", active: true,
    result: { category: "mobile", counterparty: "Demo AIS", amount: "300.00", currency: "THB", frequency: "monthly", expected_next_date: "2026-11-05", confidence_type: "INFERRED", basis: "3 monthly payments within 3 days", supporting_transaction_ids: [] } },
  { id: "00000000-0000-4000-8000-0000000002r3", created_at: "2026-10-02T08:31:00Z", account, merchant_key: "demo music", decision: "inferred", cost_id: "", active: true,
    result: { category: "subscription", counterparty: "Demo Music", amount: "199.00", currency: "THB", frequency: "monthly", expected_next_date: "2026-11-05", confidence_type: "INFERRED", basis: "3 monthly payments within 3 days", supporting_transaction_ids: [] } },
];

const risks: RiskCard[] = [
  { id: "r1", created_at: "2026-10-02T08:32:00Z", updated_at: "2026-10-02T08:32:00Z", kind: "spending_increased", active: true, details: { cost_ids: ["food"] } },
  { id: "r2", created_at: "2026-10-02T08:32:00Z", updated_at: "2026-10-11T01:00:00Z", kind: "cashflow_gap", active: true, details: { date: "2026-12-05", amount: "2400.00" } },
  { id: "r3", created_at: "2026-10-01T09:00:00Z", updated_at: "2026-10-02T08:32:00Z", kind: "data_stale", active: false, details: {} },
];

const checks: CheckJob[] = [
  { id: "c3", created_at: "2026-10-11T01:00:00Z", kind: "check", status: "DONE", attempts: 1, error_code: "", payload: { trigger: "manual", ...versions } },
  { id: "c2", created_at: "2026-10-02T08:31:00Z", kind: "check", status: "DONE", attempts: 1, error_code: "", payload: { trigger: "consumption_changed", ...versions, analysis_version: 3 } },
  { id: "c1", created_at: "2026-10-01T09:00:00Z", kind: "check", status: "RETRY", attempts: 2, error_code: "VERSION_CONFLICT", payload: { trigger: "daily", ...versions, analysis_version: 2 } },
];

export function createInsightsPreview(): WalletClient {
  const page = <T,>(results: T[]) => ({ count: results.length, next: null, previous: null, results });
  const routes: Record<string, unknown> = {
    "readiness/state/": state, "demo/wallets/": page([{ clock: "2026-10-11" }]), "readiness/transaction-imports/": page([pending, committed]),
    "readiness/recurring-expenses/": page(recurring), "readiness/risks/": page(risks), "readiness/checks/": page(checks), "readiness/briefing/": briefing,
  };
  return {
    async get<T>(path: string): Promise<T> {
      if (path in routes) return routes[path] as T;
      if (path.startsWith("readiness/transactions/")) {
        const category = new URLSearchParams(path.split("?")[1] ?? "").get("category");
        return page(transactions.filter((item) => !category || item.category === category)) as T;
      }
      throw new WalletApiError(404, { detail: "Not available in the preview." });
    },
    async post<T>(): Promise<T> {
      throw new WalletApiError(0, { detail: "The preview is read-only." });
    },
  };
}
