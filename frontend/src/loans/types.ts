// Shapes of the B-lending records Django returns (finance/workflow_common.record, lending_ledger.account_record).
import type { LoanProduct } from "./products";

export type ApplicationStatus = "DRAFT" | "UNDER_REVIEW" | "APPROVED" | "REJECTED" | "DISBURSED" | "CANCELLED";
export const APPLICATION_STATUSES: ApplicationStatus[] = ["DRAFT", "UNDER_REVIEW", "APPROVED", "REJECTED", "DISBURSED", "CANCELLED"];

export type Repayment = { number: number; due_date: string; principal: string; interest: string; amount: string; remaining_principal: string };

export type LoanQuote = {
  id: string;
  created_at: string;
  inputs: { product?: LoanProduct; currency?: string; principal: string; annual_rate: string; fees: string; months: number; first_due_date: string };
  result: {
    currency: string; principal: string; net_proceeds: string; fees: string; total_interest: string; total_repayment: string;
    repayments: Repayment[]; total_cost_over_net_proceeds?: string; maximum_installment?: string;
  };
  engine_version?: string;
};

export type Assessment = { status?: "AFFORDABLE" | "UNAFFORDABLE" | "INSUFFICIENT_DATA"; missing_inputs?: string[]; shortfall_months?: string[]; profile_version?: number };

export type LoanApplication = {
  id: string; created_at: string; version: number; loan: string; status: ApplicationStatus;
  assessment: Assessment; decision_reason: string;
};

export type InstallmentStatus = "PAID" | "DUE" | "OVERDUE" | "SCHEDULED";
export type Installment = { id: string; number: number; due_on: string; amount: string; principal: string; paid_on: string | null; status: InstallmentStatus };
export type LoanAccount = {
  id: string; created_at: string; disbursement: string; status: "ACTIVE" | "CLOSED"; version: number;
  outstanding_principal: string; installments: Installment[];
};

export type Disbursement = { id: string; created_at: string; application: string; amount: string; scheduled_on: string; status: string };

export type ProfileMonth = { month: string; income: string | null; living_expenses: string | null; existing_repayments: string | null };
export type AffordabilityProfile = { version: number; months: ProfileMonth[] };

export type DemoWallet = { id: string; clock: string; balance: string; available_balance?: string };

export type LoansSnapshot = {
  applications: LoanApplication[];
  quotes: LoanQuote[];
  profile: AffordabilityProfile | null;
  accounts: LoanAccount[];
  disbursements: Disbursement[];
  wallet: DemoWallet | null;
  errors: Partial<Record<"applications" | "quotes" | "profile" | "accounts" | "disbursements" | "wallet", string>>;
};
