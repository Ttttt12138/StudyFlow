import type { ApplicationStatus, Installment, LoanAccount, LoanApplication, LoanQuote, ProfileMonth, Repayment } from "./types";

export const MONEY_PATTERN = /^\d{1,16}(\.\d{1,2})?$/;

/** "12" → "0.12", "7.25" → "0.0725" by shifting the decimal point, so no binary float reaches Django (it rejects >8 places). */
export function percentToFraction(text: string): string | null {
  const value = text.trim();
  const match = /^(\d{1,3})(?:\.(\d{1,6}))?$/.exec(value);
  if (!match) return null;
  const digits = (match[1] + (match[2] ?? "")).replace(/^0+(?=\d)/, "");
  const scale = (match[2]?.length ?? 0) + 2;
  const padded = digits.padStart(scale + 1, "0");
  const whole = padded.slice(0, padded.length - scale);
  const fraction = padded.slice(padded.length - scale).replace(/0+$/, "");
  const result = fraction ? `${whole}.${fraction}` : whole;
  return Number(result) > 1 ? null : result;
}

export function fractionToPercent(text: string | undefined): string {
  if (!text) return "—";
  const value = Number(text) * 100;
  return `${Number.isFinite(value) ? Number(value.toFixed(4)) : text}%`;
}

/** The only installment Django lets the student repay: the lowest-numbered unpaid one (lending_ledger.payable). */
export function nextInstallment(account: LoanAccount): Installment | null {
  return [...account.installments].filter((row) => !row.paid_on).sort((a, b) => a.number - b.number)[0] ?? null;
}

export type RepayEligibility = "ok" | "closed" | "paid" | "not_next" | "not_due";

export function repayEligibility(account: LoanAccount, installment: Installment): RepayEligibility {
  if (account.status !== "ACTIVE") return "closed";
  if (installment.paid_on || installment.status === "PAID") return "paid";
  if (nextInstallment(account)?.number !== installment.number) return "not_next";
  return installment.status === "DUE" || installment.status === "OVERDUE" ? "ok" : "not_due";
}

/** Earliest unpaid due date across active accounts — the date the demo clock can jump to. */
export function nextDueDate(accounts: LoanAccount[]): string | null {
  const dates = accounts.filter((a) => a.status === "ACTIVE").map(nextInstallment).filter((row): row is Installment => !!row).map((row) => row.due_on).sort();
  return dates[0] ?? null;
}

export function repaymentMonths(quote: LoanQuote | undefined): string[] {
  const rows = quote?.result?.repayments ?? [];
  return [...new Set(rows.filter((row) => Number(row.amount) > 0).map((row) => row.due_date.slice(0, 7)))].sort();
}

/** Which repayment months the profile does not cover; the assessment needs all three numbers for each (lending_core.calculations.assess). */
export function profileCoverage(months: string[], profile: Pick<ProfileMonth, "month" | "income" | "living_expenses" | "existing_repayments">[]) {
  const byMonth = new Map(profile.map((row) => [row.month, row]));
  const filled = (value: string | null) => value !== null && value.trim() !== "";
  const missing = months.filter((month) => !byMonth.has(month));
  const incomplete = months.filter((month) => {
    const row = byMonth.get(month);
    return row && !(filled(row.income) && filled(row.living_expenses) && filled(row.existing_repayments));
  });
  return { needed: months, missing, incomplete, complete: missing.length === 0 && incomplete.length === 0 };
}

/**
 * Annual cost rate including fees: the monthly rate r where the net proceeds equal the discounted installments, times 12.
 * An approximation for comparison only (it assumes one installment per month after disbursement).
 */
export function effectiveAnnualRate(netProceeds: string, repayments: Pick<Repayment, "amount">[]): number | null {
  const net = Number(netProceeds);
  const amounts = repayments.map((row) => Number(row.amount)).filter((value) => value > 0);
  if (!(net > 0) || amounts.length === 0) return null;
  const value = (rate: number) => amounts.reduce((sum, amount, n) => sum + amount / (1 + rate) ** (n + 1), 0);
  if (value(0) <= net) return 0;
  let low = 0, high = 1;
  if (value(high) > net) return null;
  for (let step = 0; step < 100; step++) {
    const mid = (low + high) / 2;
    if (value(mid) > net) low = mid; else high = mid;
  }
  return ((low + high) / 2) * 12;
}

export const FINAL_STATUSES: ApplicationStatus[] = ["DISBURSED", "CANCELLED", "REJECTED"];
export const canCancel = (application: LoanApplication) => !FINAL_STATUSES.includes(application.status);

export function statusTone(status: string): "ok" | "pending" | "failed" | "used" {
  if (["APPROVED", "DISBURSED", "PAID", "ACTIVE", "settled", "AFFORDABLE"].includes(status)) return "ok";
  if (["REJECTED", "CANCELLED", "OVERDUE", "UNAFFORDABLE", "failed"].includes(status)) return "failed";
  if (["CLOSED", "SCHEDULED"].includes(status)) return "used";
  return "pending";
}

/** First due date proposed for a new quote: one month after the demo clock (Django requires it to be in the future). */
export function defaultFirstDue(clock: string | undefined): string {
  const base = clock ? new Date(`${clock}T00:00:00Z`) : new Date();
  const next = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, Math.min(base.getUTCDate(), 28)));
  return next.toISOString().slice(0, 10);
}
