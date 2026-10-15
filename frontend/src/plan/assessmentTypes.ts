import type { Estimate, Plan, Text } from "./types";
import type { LoanProduct } from "../loans/products";
import type { Assessment as LoanAssessment, LoanAccount, LoanApplication, LoanQuote, Disbursement } from "../loans/types";

export type AssessmentInputs = {
  borrower: Borrower;
  loan: { product: LoanProduct; principal: string | null; annual_rate: string; fees: string; first_due_date: string;
    months: Term; method: LoanMethod };
};
export const TERMS = [24, 36, 48, 60] as const;
export type Term = typeof TERMS[number];
export type LoanMethod = "amortized" | "interest_only";
export type Borrower = "student_with_parent" | "parent";
export type LoanOffer = { key: LoanProduct; annual_rate: string; terms: number[]; methods: LoanMethod[] };
export type LoanLimit = { currency: "THB"; max_principal: string | null };
export type LoanPreview = { principal: string; months: number; monthly_payment: string; total_interest: string; total_repayment: string;
  first_due_date: string; last_due_date: string; annual_rate: string; fees: string; net_proceeds: string; product: LoanProduct;
  /** Interest-only months while studying (0 for equal installments from the start) and the most paid in one. */
  method?: LoanMethod; interest_only_months?: number; interest_only_payment?: string | null;
  schedule: { number: number; due_date: string; amount: string; principal: string; interest: string; remaining_principal: string }[] };
/** The school's tuition account; money goes to the school only while it is verified. */
export type SchoolPayee = { id: string; name: string; account: string; verified: boolean };
export type LoanDocument = { id: string; key: string; title: Text | null; done: boolean; auto: boolean; due_date: string | null; version: number };
export type LoanPayout = { id: string; amount: string; bill_amount: string; bill_currency: string; bill_label: Text | string;
  due_date: string; status: "SCHEDULED" | "PAID"; paid_on: string | null; kind: string };
export type PlanningQuote = LoanQuote & { assessment: LoanAssessment };
export type PlanningAssessment = { version: number; plan_version: number; plan: Plan | null; inputs: AssessmentInputs | null;
  quotes: PlanningQuote[]; stale?: boolean; draft?: boolean; estimate?: Estimate;
  products?: LoanOffer[]; limit?: LoanLimit;
  loan_stage?: { documents: LoanDocument[]; payouts: LoanPayout[]; signed: boolean; school_payee?: SchoolPayee | null };
  lifecycle?: { applications: LoanApplication[]; accounts: LoanAccount[]; disbursements: Disbursement[] } };
