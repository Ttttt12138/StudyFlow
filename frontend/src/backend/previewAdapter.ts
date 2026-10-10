import { ApiError, type StudyFlowClient } from "./client";
import type {
  Application, BackendState, BudgetResult, Draft, ForecastResult,
  FundingResult, FundingSource, ImportRecord, LoanQuote, Run, Semester,
} from "./contracts";

// Fixed, synthetic B/C-shaped responses for visual inspection only.
// This adapter never calls Django or calculates financial results.
const draft: Draft = {
  profile: {
    school: "Example International University", campus: "City campus",
    program: "International Business", semester: "Spring 2027",
    start_date: "2026-11-01", end_date: "2027-02-28",
    evidence: [{ source_id: "preview-offer", field: "school", quote: "Example International University offers you a place in International Business.", locator: "Offer letter, page 1" }],
  },
  reserve: "15000.00", required_categories: ["tuition", "housing", "food"],
  costs: [
    { cost_id: "preview-tuition", category: "tuition", component: "Tuition", amount: "41000.00", currency: "THB", period: "semester", due_date: "2026-11-15", paid: false, confidence_type: "VERIFIED", source_refs: ["preview-import"], evidence: [{ source_id: "preview-fee", field: "amount", quote: "Tuition fee: THB 41,000. Due 15 November 2026.", locator: "Fee schedule, page 1" }] },
    { cost_id: "preview-housing", category: "housing", component: "Housing", amount: "9000.00", currency: "THB", period: "monthly", paid: false, confidence_type: "UNCONFIRMED", synthetic: true, evidence: [], source_refs: [] },
    { cost_id: "preview-food", category: "food", component: "Food", amount: null, currency: "THB", period: "monthly", paid: false, confidence_type: "UNCONFIRMED", synthetic: true, evidence: [], source_refs: [] },
  ],
};
const budgetResult: BudgetResult = {
  low: "86000.00", base: "92000.00", high: "101000.00", remaining_base: "92000.00", gap: "42000.00", currency: "THB",
  complete: false, sufficient: false, issues: ["MISSING:food"],
  assumptions: ["Synthetic scenario values supplied by the preview adapter."],
  state_version: 1, budget_version: 1, semester_id: "preview-semester",
};
const state: BackendState = {
  semester_id: "preview-semester", state_version: 1, budget_version: 1, analysis_version: 1,
  assets: { planning_balance: "50000.00", wallet_balance: null, currency: "THB", basis: "USER_DECLARED" },
  budget: budgetResult, estimated_expenses: draft.costs, expected_income: [],
};
const semester: Semester = { id: "preview-semester", version: 1, draft, template_key: "synthetic-preview", template_version: 1 };
const forecastResult: ForecastResult = {
  currency: "THB", end_date: "2027-01-29", status: "incomplete", complete: false, conditional: false,
  first_gap_date: "2026-11-15", maximum_reserve_gap: "15000.00", ending_balance: "0.00",
  missing_event_ids: ["cost:preview-food"], excluded_unconfirmed_income: [], budget_issues: ["MISSING:food"],
  assumptions: ["Synthetic forecast response for visual preview. No amounts are calculated in the frontend."],
  timeline: [
    { id: "cost:preview-tuition:2026-11-15", date: "2026-11-15", label: "Tuition", kind: "expense", amount: "41000.00", certainty: "confirmed", balance_after: "9000.00", reserve_gap: "6000.00" },
    { id: "cost:preview-housing:2026-12-01", date: "2026-12-01", label: "Housing", kind: "expense", amount: "9000.00", certainty: "estimated", balance_after: "0.00", reserve_gap: "15000.00" },
  ],
};
const fundingResult: FundingResult = {
  recommended_borrowing_net: "22000.00", quote_required: true,
  assumptions: ["Synthetic recommendation for visual preview."], is_recommendation_final: false,
  nonloan_plan: { validation: "CONDITIONAL", remaining_gap: "22000.00", conditions: ["Family support has not been received."], allocations: [{ source_id: "preview-family", amount: "20000.00" }], affordability: "UNKNOWN" },
};
const sources: FundingSource[] = [{ id: "preview-family", kind: "family", amount: "20000.00", currency: "THB", certainty: "estimated", available_on: "2026-11-10", received: false, already_in_opening: false }];
const quotes: LoanQuote[] = [
  { id: "preview-quote", inputs: { currency: "THB", principal: "40000.00", annual_rate: "0.12", fees: "1000.00", months: 12, first_due_date: "2027-03-01" }, result: { currency: "THB", net_proceeds: "39000.00", total_repayment: "43000.00", repayments: [{ due_date: "2027-03-01", amount: "3583.33" }] } },
  { id: "preview-quote-two", inputs: { currency: "THB", principal: "20000.00", annual_rate: "0.10", fees: "500.00", months: 12, first_due_date: "2027-03-01" }, result: { currency: "THB", net_proceeds: "19500.00", total_interest: "1100.00", total_repayment: "21100.00", repayments: [{ due_date: "2027-03-01", amount: "1758.33" }] } },
];
const application: Application = { id: "preview-application", status: "UNDER_REVIEW", version: 2, assessment: { status: "INSUFFICIENT_DATA" }, quote_id: "preview-quote" };
export const previewImport: ImportRecord = {
  id: "preview-import", status: "NEEDS_REVIEW", job_status: "DONE", error_code: null,
  result: { draft, proposed_draft: draft, merge_conflicts: { "profile.campus": ["City campus", "North campus"] }, issues: [{ code: "CAMPUS_CONFLICT" }], requires_review: true },
};
export const previewBudget: Run<BudgetResult> = { id: "preview-budget", state_version: 1, budget_version: 1, analysis_version: 1, result: budgetResult };
export const previewFunding: Run<FundingResult> = { id: "preview-funding", state_version: 1, budget_version: 1, analysis_version: 1, result: fundingResult };
// A fixed example expense for the guided UI walkthrough. It is never saved or
// used to calculate a budget; only Django/B can return an updated result.
export const previewAfterFoodExample = {
  expense: { label: "Food", amount: "3000.00", currency: "THB", period: "monthly", certainty: "estimated" },
};
const previewForecast: Run<ForecastResult> = { id: "preview-forecast", state_version: 1, budget_version: 1, analysis_version: 1, result: forecastResult };

// Two authored response sets keep the demo coherent without browser calculations.
const estimatedDraft: Draft = { ...draft, costs: draft.costs.map(cost => cost.cost_id === "preview-food" ? { ...cost, amount: previewAfterFoodExample.expense.amount } : cost) };
const estimatedBudget: BudgetResult = {
  ...budgetResult, low: "98000.00", base: "104000.00", high: "113000.00", remaining_base: "104000.00", gap: "54000.00",
  complete: true, issues: [], state_version: 2, budget_version: 2,
  assumptions: ["Fixed demo response. This example assumes all other backend requirements, including consumption coverage, were met."],
};
const estimatedState: BackendState = { ...state, state_version: 2, budget_version: 2, analysis_version: 2, budget: estimatedBudget, estimated_expenses: estimatedDraft.costs };
const estimatedSemester: Semester = { ...semester, version: 2, draft: estimatedDraft };
const estimatedForecast: ForecastResult = {
  ...forecastResult, status: "complete", complete: true, missing_event_ids: [], budget_issues: [], maximum_reserve_gap: "42000.00", ending_balance: "-27000.00",
  assumptions: ["Fixed demo calendar for the sample Food estimate. No browser calculation is performed."],
  timeline: [
    { id: "cost:preview-housing:2026-11-01", date: "2026-11-01", label: "Housing", kind: "expense", amount: "9000.00", certainty: "estimated", balance_after: "41000.00", reserve_gap: "0.00" },
    { id: "cost:preview-food:2026-11-01", date: "2026-11-01", label: "Food", kind: "expense", amount: "3000.00", certainty: "estimated", balance_after: "38000.00", reserve_gap: "0.00" },
    { id: "cost:preview-tuition:2026-11-15", date: "2026-11-15", label: "Tuition", kind: "expense", amount: "41000.00", certainty: "confirmed", balance_after: "-3000.00", reserve_gap: "18000.00" },
    { id: "cost:preview-housing:2026-12-01", date: "2026-12-01", label: "Housing", kind: "expense", amount: "9000.00", certainty: "estimated", balance_after: "-12000.00", reserve_gap: "27000.00" },
    { id: "cost:preview-food:2026-12-01", date: "2026-12-01", label: "Food", kind: "expense", amount: "3000.00", certainty: "estimated", balance_after: "-15000.00", reserve_gap: "30000.00" },
    { id: "cost:preview-housing:2027-01-01", date: "2027-01-01", label: "Housing", kind: "expense", amount: "9000.00", certainty: "estimated", balance_after: "-24000.00", reserve_gap: "39000.00" },
    { id: "cost:preview-food:2027-01-01", date: "2027-01-01", label: "Food", kind: "expense", amount: "3000.00", certainty: "estimated", balance_after: "-27000.00", reserve_gap: "42000.00" },
  ],
};
const estimatedFunding: FundingResult = { ...fundingResult, recommended_borrowing_net: "34000.00", assumptions: ["Fixed demo recommendation for the sample Food estimate."], nonloan_plan: { ...fundingResult.nonloan_plan, remaining_gap: "34000.00" } };
const estimatedBudgetRun: Run<BudgetResult> = { id: "preview-budget-estimated", state_version: 2, budget_version: 2, analysis_version: 2, result: estimatedBudget };
const estimatedForecastRun: Run<ForecastResult> = { id: "preview-forecast-estimated", state_version: 2, budget_version: 2, analysis_version: 2, result: estimatedForecast };
const estimatedFundingRun: Run<FundingResult> = { id: "preview-funding-estimated", state_version: 2, budget_version: 2, analysis_version: 2, result: estimatedFunding };

export type PreviewScenario = "missing" | "estimated";
export function createPreviewClient(scenario: PreviewScenario = "missing"): StudyFlowClient {
  return {
    async get<T>(path: string): Promise<T> {
      const estimated = scenario === "estimated";
      const responses: Record<string, unknown> = {
        "readiness/state/": estimated ? estimatedState : state,
        "readiness/semesters/preview-semester/": estimated ? estimatedSemester : semester,
        "readiness/budgets/": [estimated ? estimatedBudgetRun : previewBudget],
        "readiness/forecasts/": [estimated ? estimatedForecastRun : previewForecast],
        "readiness/funding-plans/recommend/": [estimated ? estimatedFundingRun : previewFunding],
        "readiness/funding-plans/": [],
        "funding-sources/": { results: sources },
        "loans/": { results: quotes },
        "applications/": { results: [application] },
        "affordability-profile/": { version: 1, months: [] },
        "readiness/imports/preview-import/": previewImport,
      };
      if (!(path in responses)) throw new ApiError(404, "This preview route is unavailable.");
      return structuredClone(responses[path]) as T;
    },
    async post<T>(): Promise<T> {
      throw new ApiError(403, "This is a read-only preview. Connect to Django to save changes or request new results.");
    },
  };
}
