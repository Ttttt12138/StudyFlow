import { WalletApiError, type WalletClient } from "../wallet/client";
import type { AffordabilityProfile, DemoWallet, Disbursement, Installment, LoanAccount, LoanApplication, LoanQuote, Repayment } from "./types";

// Fixed synthetic records for the signed-out preview; no Django request is made.
const id = (n: string) => `00000000-0000-4000-8000-0000000${n}`;
const row = (number: number, due_date: string, principal: string, interest: string, amount: string, remaining_principal: string): Repayment =>
  ({ number, due_date, principal, interest, amount, remaining_principal });

const activeRows = [
  row(1, "2026-10-15", "9875.73", "300.00", "10175.73", "50124.27"),
  row(2, "2026-11-15", "9925.11", "250.62", "10175.73", "40199.16"),
  row(3, "2026-12-15", "9974.73", "201.00", "10175.73", "30224.43"),
  row(4, "2027-01-15", "10024.61", "151.12", "10175.73", "20199.82"),
  row(5, "2027-02-15", "10074.73", "101.00", "10175.73", "10125.09"),
  row(6, "2027-03-15", "10125.09", "50.63", "10175.72", "0.00"),
];
const reviewRows = [
  row(1, "2027-01-15", "7453.29", "125.00", "7578.29", "22546.71"),
  row(2, "2027-02-15", "7484.35", "93.94", "7578.29", "15062.36"),
  row(3, "2027-03-15", "7515.53", "62.76", "7578.29", "7546.83"),
  row(4, "2027-04-15", "7546.83", "31.45", "7578.28", "0.00"),
];

const quotes: LoanQuote[] = [
  { id: id("10b2"), created_at: "2026-11-02T03:00:00Z", engine_version: "b-monthly-amortization-v1",
    inputs: { currency: "THB", principal: "30000.00", annual_rate: "0.05", fees: "600.00", months: 4, first_due_date: "2027-01-15" },
    result: { currency: "THB", principal: "30000.00", net_proceeds: "29400.00", fees: "600.00", total_interest: "313.15", total_repayment: "30313.15",
      repayments: reviewRows, total_cost_over_net_proceeds: "913.15", maximum_installment: "7578.29" } },
  { id: id("10b1"), created_at: "2026-09-10T03:00:00Z", engine_version: "b-monthly-amortization-v1",
    inputs: { currency: "THB", principal: "60000.00", annual_rate: "0.06", fees: "1200.00", months: 6, first_due_date: "2026-10-15" },
    result: { currency: "THB", principal: "60000.00", net_proceeds: "58800.00", fees: "1200.00", total_interest: "1054.37", total_repayment: "61054.37",
      repayments: activeRows, total_cost_over_net_proceeds: "2254.37", maximum_installment: "10175.73" } },
];

const applications: LoanApplication[] = [
  { id: id("20a2"), created_at: "2026-11-02T03:05:00Z", version: 2, loan: quotes[0].id, status: "UNDER_REVIEW", decision_reason: "",
    assessment: { status: "INSUFFICIENT_DATA", missing_inputs: ["2027-04.income", "2027-04.living_expenses", "2027-04.existing_repayments"], shortfall_months: [], profile_version: 3 } },
  { id: id("20a1"), created_at: "2026-09-10T03:05:00Z", version: 3, loan: quotes[1].id, status: "DISBURSED", decision_reason: "",
    assessment: { status: "AFFORDABLE", missing_inputs: [], shortfall_months: [], profile_version: 2 } },
];

const disbursement: Disbursement = { id: id("30d1"), created_at: "2026-09-20T04:00:00Z", application: applications[1].id, amount: "58800.00", scheduled_on: "2026-09-20", status: "settled" };

const installments: Installment[] = activeRows.map((r) => ({
  id: id(`40i${r.number}`), number: r.number, due_on: r.due_date, amount: r.amount, principal: r.principal,
  paid_on: r.number === 1 ? "2026-10-15" : null, status: r.number === 1 ? "PAID" : r.number === 2 ? "DUE" : "SCHEDULED",
}));
const account: LoanAccount = { id: id("50c1"), created_at: "2026-09-20T04:00:00Z", disbursement: disbursement.id, status: "ACTIVE", version: 2, outstanding_principal: "50124.27", installments };

const profile: AffordabilityProfile = { version: 3, months: ["2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03"].map((month) => (
  { month, income: "32000.00", living_expenses: "15000.00", existing_repayments: month < "2027-04" ? "0.00" : null })) };

const wallet: DemoWallet = { id: id("60w1"), clock: "2026-11-15", balance: "41200.00", available_balance: "41200.00" };

export function createLoansPreview(): WalletClient {
  const page = <T,>(results: T[]) => ({ count: results.length, next: null, previous: null, results });
  const routes: Record<string, unknown> = {
    "applications/": page(applications), "loans/": page(quotes), "affordability-profile/": profile,
    "loan-accounts/": page([account]), "disbursements/": page([disbursement]), "demo/wallets/": page([wallet]),
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
