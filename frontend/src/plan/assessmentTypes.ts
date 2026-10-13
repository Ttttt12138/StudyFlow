import type { Estimate, Plan } from "./types";
import type { LoanProduct } from "../loans/products";
import type { Assessment as LoanAssessment, LoanAccount, LoanApplication, LoanQuote, Disbursement } from "../loans/types";

export type Support = { id: string; amount: string; currency: string; available_on: string | null; confirmed: boolean; included_in_funds?: boolean };
export type RepaymentValues = { income: string | null; living_expenses: string | null; existing_repayments: string | null };
export type AssessmentInputs = {
  available_funds: string | null; funds_currency: string; reserve: string | null; as_of: string;
  horizon: 30 | 60 | 90; payment_date: string | null; supports: Support[];
  costs: { cost_id: string; amount?: string | null; due_date?: string | null; paid?: boolean }[];
  repayment: RepaymentValues & { from_month: string; to_month: string; changes: ({ month: string } & Partial<RepaymentValues>)[] };
  loan: { product?: LoanProduct; principal: string | null; annual_rate: string; fees: string; first_due_date: string; periods: number[] };
};
export type PlanningQuote = LoanQuote & { assessment: LoanAssessment };
export type Projection = { horizon: number; as_of: string; end_date: string; complete: boolean; issues: string[];
  maximum_reserve_gap: string; first_gap_date: string | null; ending_balance: string; conditional: boolean;
  timeline: { id: string; date: string; amount: string; kind: string; balance_after: string }[] };
export type PlanningAssessment = { version: number; plan_version: number; plan: Plan | null; inputs: AssessmentInputs | null;
  quotes: PlanningQuote[]; stale?: boolean; draft?: boolean; estimate?: Estimate; suggested_principal?: string | null;
  forecast?: Projection; conditional_forecast?: Projection;
  lifecycle?: { applications: LoanApplication[]; accounts: LoanAccount[]; disbursements: Disbursement[] } };
