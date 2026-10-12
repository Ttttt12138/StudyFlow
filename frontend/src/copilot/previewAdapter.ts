import { WalletApiError, type WalletClient } from "../wallet/client";
import type { ApplyPreview, Cost, Explanation, Metrics, Notification, ReadinessState, ReviewHistory, ReviewItem, ScenarioResult, WhatIfRun } from "./types";

// Fixed synthetic records for the read-only preview; no Django request is made.
const id = (n: string) => `00000000-0000-4000-8000-0000000${n}`;

const tuition: Cost = { cost_id: "tuition", category: "tuition", amount: "45000.00", currency: "THB", period: "once", due_date: "2026-12-01", paid: false,
  applicability: "APPLICABLE", locked: true, confidence_type: "VERIFIED" };
const costs: Cost[] = [
  tuition,
  { cost_id: "housing", category: "housing", amount: "7000.00", currency: "THB", period: "monthly", paid: false, applicability: "APPLICABLE", confidence_type: "UNCONFIRMED" },
  { cost_id: "food", category: "food", amount: "4500.00", currency: "THB", period: "monthly", paid: false, applicability: "APPLICABLE", confidence_type: "UNCONFIRMED" },
];

export const previewState: ReadinessState = {
  state_version: 8, budget_version: 5, analysis_version: 0, semester_id: id("5e01"),
  assets: { balance_as_of: "2026-11-02", currency: "THB" }, estimated_expenses: costs, reserve: "2000.00",
  expected_income: [{ id: id("f001"), kind: "family", amount: "15000.00", currency: "THB", available_on: "2026-11-20", received: false, certainty: "estimated" }],
};

const metrics = (gap: string, min: string, below: string | null, negative: string | null, remaining: string, semesterGap: string, months: [string, string, string][]): Metrics => ({
  maximum_reserve_gap: gap, minimum_balance: min, first_below_reserve: below, first_negative_date: negative, remaining_expenses: remaining,
  semester_funding_gap: semesterGap, complete: true, issues: [], monthly: months.map(([month, ending_balance, minimum_balance]) => ({ month, ending_balance, minimum_balance })),
});

const baseline: ScenarioResult = {
  ...metrics("28500.00", "-26500.00", "2026-12-01", "2026-12-01", "74000.00", "24000.00", [["2026-11", "21500.00", "21500.00"], ["2026-12", "-26500.00", "-26500.00"]]),
  name: "Current plan", conditional: true, conditions: ["HYPOTHETICAL_FUNDING_NOT_SETTLED"],
  confirmed: metrics("43500.00", "-41500.00", "2026-12-01", "2026-12-01", "74000.00", "39000.00", []), loan: null, loan_needed: "28500.00", unmet_gap: "28500.00",
};

const family: ScenarioResult = {
  ...metrics("5500.00", "-3500.00", "2026-12-01", "2026-12-01", "71000.00", "1000.00", [["2026-11", "41500.00", "21500.00"], ["2026-12", "-3500.00", "-3500.00"]]),
  name: "Parents add THB 20,000; tuition instalment", conditional: true, conditions: ["CONTRACT_CHANGE_REQUIRES_REVIEW:tuition", "HYPOTHETICAL_FUNDING_NOT_SETTLED"],
  confirmed: metrics("40500.00", "-38500.00", "2026-12-01", "2026-12-01", "71000.00", "36000.00", []), loan: null, loan_needed: "5500.00", unmet_gap: "5500.00",
  delta: { maximum_reserve_gap: "-23000.00", minimum_balance: "23000.00", remaining_expenses: "-3000.00", loan_needed: "-23000.00" },
  assumptions: { name: "Parents add THB 20,000; tuition instalment", costs: [{ cost_id: "tuition", amount: "42000.00", effective_on: "2026-11-15" }],
    family_support: [{ source_id: null, amount: "20000.00", available_on: "2026-11-25" }], allow_new_loan: true, loan: null, loan_available_on: null },
};

const repayments = Array.from({ length: 12 }, (_, n) => ({ number: n + 1, due_date: `2027-${String(n + 1).padStart(2, "0")}-15`, amount: "2568.22" }));
const loan: ScenarioResult = {
  ...metrics("0.00", "2900.00", null, null, "74000.00", "0.00", [["2026-11", "50900.00", "21500.00"], ["2026-12", "2900.00", "2900.00"]]),
  name: "Borrow THB 30,000 over 12 months", conditional: true, conditions: ["HYPOTHETICAL_FUNDING_NOT_SETTLED"],
  confirmed: metrics("14100.00", "-12100.00", "2026-12-01", "2026-12-01", "74000.00", "9600.00", []),
  loan: { principal: "30000.00", net_proceeds: "29400.00", fees: "600.00", total_interest: "818.64", total_repayment: "30818.64", repayments, maximum_installment: "2568.22",
    affordability: { status: "INSUFFICIENT_DATA", missing_inputs: ["2027-07.income", "2027-08.income"], shortfall_months: [] } },
  loan_needed: "28500.00", unmet_gap: "0.00",
  delta: { maximum_reserve_gap: "-28500.00", minimum_balance: "29400.00", remaining_expenses: "0.00", loan_needed: "0.00" },
  assumptions: { name: "Borrow THB 30,000 over 12 months", costs: [], family_support: [], allow_new_loan: true,
    loan: { currency: "THB", principal: "30000.00", annual_rate: "0.05", fees: "600.00", months: 12, first_due_date: "2027-01-15" }, loan_available_on: "2026-11-25" },
};

export const previewRun: WhatIfRun = { id: id("a1f0"), baseline, scenarios: [family, loan], stale: false, applied_index: null, application: {} };

export const previewApplyPreview: ApplyPreview = {
  scenario_index: 0, confirmation: null, expires_in_seconds: 900,
  diff: [
    { kind: "cost", id: "tuition", before: tuition, after: { ...tuition, planned_overrides: [{ amount: "42000.00", effective_on: "2026-11-15" }] } },
    { kind: "family_support", id: null, before: null, after: { amount: "20000.00", available_on: "2026-11-25", currency: "THB", certainty: "estimated", status: "PENDING" } },
  ],
  blockers: [{ code: "PROTECTED_COST_REVIEW", cost_id: "tuition", before: tuition, proposed: { cost_id: "tuition", amount: "42000.00", effective_on: "2026-11-15" } }],
};

export const previewReview: ReviewItem = {
  id: id("e001"), key: `scenario:${previewRun.id}:0`, kind: "protected_cost", entity_id: previewRun.id, status: "OPEN", version: 1, assignee: null,
  updated_at: "2026-11-02T04:10:00Z", created_at: "2026-11-02T04:10:00Z",
  details: { blockers: previewApplyPreview.blockers, scenario_index: 0, next_action: "Confirm replacement evidence through the original material workflow, then simulate again." },
};
const history: ReviewHistory[] = [];

const notifications: Notification[] = [
  { id: id("b002"), created_at: "2026-11-02T03:00:00Z", transition: "NEW", read_at: null, payload: { kind: "reserve_gap", details: { amount: "28500.00", date: "2026-12-01" } }, target: { kind: "risk", id: id("c001") } },
  { id: id("b001"), created_at: "2026-10-20T03:00:00Z", transition: "RESOLVED", read_at: "2026-10-21T08:00:00Z", payload: { kind: "payment_due", details: null }, target: { kind: "risk", id: id("c002") } },
];

export const previewTrace: Explanation = {
  trace_id: id("d0d1"), entity_id: id("d0d1"), created_at: "2026-11-02T04:12:00Z",
  layers: {
    jev: { status: "NOT_CALLED" }, llm: { status: "NOT_CALLED" }, deterministic: { status: "NOT_CALLED" },
    policy: { status: "EXECUTED", decision: "BLOCKED", route: `/api/v2/readiness/what-if/${previewRun.id}/apply/`, http_status: 400,
      rules: { code: "REVIEW_REQUIRED", message: "A protected cost needs review before this plan can be applied." },
      next_action: "Correct the rejected request or supply the required evidence; refresh on 409" },
  },
};

export function createCopilotPreview(): WalletClient {
  const routes: Record<string, unknown> = {
    "readiness/state/": previewState,
    "review-queue/": { count: 1, items: [previewReview], next: null, previous: null },
    [`review-queue/${previewReview.id}/`]: { ...previewReview, history },
    "readiness/notifications/": notifications,
    [`readiness/what-if/${previewRun.id}/`]: previewRun,
    [`readiness/explanations/${previewTrace.trace_id}/`]: previewTrace,
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
