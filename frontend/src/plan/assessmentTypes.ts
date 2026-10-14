import type { Estimate, Plan, Text } from "./types";
import type { LoanProduct } from "../loans/products";
import type { Assessment as LoanAssessment, LoanAccount, LoanApplication, LoanQuote, Disbursement } from "../loans/types";

export type Support = { id: string; amount: string; currency: string; available_on: string | null; confirmed: boolean; included_in_funds?: boolean };
export type RepaymentValues = { income: string | null; living_expenses: string | null; existing_repayments: string | null };
export type AssessmentInputs = {
  available_funds: string | null; funds_currency: string; reserve: string | null; as_of: string;
  horizon: 30 | 60 | 90; payment_date: string | null; supports: Support[];
  costs: { cost_id: string; amount?: string | null; due_date?: string | null; paid?: boolean }[];
  repayment: RepaymentValues & { from_month: string; to_month: string; changes: ({ month: string } & Partial<RepaymentValues>)[] };
  loan: { product?: LoanProduct; principal: string | null; annual_rate: string; fees: string; first_due_date: string;
    /** The one term picked; `periods` is kept on older stored inputs only. */
    months?: Term; periods?: number[] };
  borrower?: Borrower;
};
export const TERMS = [24, 36, 48, 60] as const;
export type Term = typeof TERMS[number];
export type Borrower = "student_with_parent" | "parent";
/** The simulated pre-check: the most that can be borrowed is the full-course gap plus fees (THB); income is not asked. */
export type Prequal = { status: "enough" | "no_gap" | "unknown"; currency: "THB"; annual_rate: string;
  longest_term: number; gap: string | null; max_principal: string | null;
  /** Each product's rate and terms: the study loan has a lower fixed rate and is the only one over 60 months. */
  products?: { key: LoanProduct; annual_rate: string; terms: number[] }[] };
export type LoanPreview = { principal: string; months: number; monthly_payment: string; total_interest: string; total_repayment: string;
  first_due_date: string; last_due_date: string; annual_rate: string; fees: string; net_proceeds: string; product: LoanProduct;
  schedule: { number: number; due_date: string; amount: string; principal: string; interest: string; remaining_principal: string }[] };
export type LoanDocument = { id: string; key: string; title: Text | null; done: boolean; due_date: string | null; version: number };
export type LoanPayout = { id: string; amount: string; bill_amount: string; bill_currency: string; bill_label: Text | string;
  due_date: string; status: "SCHEDULED" | "PAID"; paid_on: string | null; kind: string };
export type PlanningQuote = LoanQuote & { assessment: LoanAssessment };
export type Projection = { horizon: number; as_of: string; end_date: string; complete: boolean; issues: string[];
  maximum_reserve_gap: string; first_gap_date: string | null; ending_balance: string; conditional: boolean;
  timeline: { id: string; date: string; amount: string; kind: string; balance_after: string }[] };
export type PlanningAssessment = { version: number; plan_version: number; plan: Plan | null; inputs: AssessmentInputs | null;
  quotes: PlanningQuote[]; stale?: boolean; draft?: boolean; estimate?: Estimate; suggested_principal?: string | null;
  forecast?: Projection; conditional_forecast?: Projection; prequal?: Prequal;
  loan_stage?: { documents: LoanDocument[]; payouts: LoanPayout[]; signed: boolean };
  lifecycle?: { applications: LoanApplication[]; accounts: LoanAccount[]; disbursements: Disbursement[] } };
