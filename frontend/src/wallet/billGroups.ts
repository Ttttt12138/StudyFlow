import type { Text } from "../plan/types";

export type PlanBillRow = { id: string; kind: string; label: Text | string; due_date: string; amount: string; currency: string;
  status: "DUE" | "PAID"; paid_at: string | null; paid_by_loan: boolean;
  /** Shared by the two halves of a bill the signed loan only partly covers. */
  group?: string;
  loan_pending?: { amount: string; status: "APPROVED" | "UNDER_REVIEW" } | null };

/** Who pays the loan's part: scheduled after signing, paid, or waiting for approval or signing. */
export type LoanState = "scheduled" | "paid" | "awaitingApproval" | "awaitingSigning";

/** One bill as the family sees it: the loan's part and theirs, however the server split it. */
export type BillItem = {
  key: string; kind: string; label: Text | string; due_date: string; currency: string; total: number;
  loan: { amount: number; state: LoanState } | null;
  /** The family's part: the row to pay from the wallet, or what is left once a pending loan is signed. */
  own: { amount: number; row: PlanBillRow | null; paid: boolean } | null;
};

const cents = (value: string | number) => Math.round(Number(value) * 100) / 100;

/** Pairs split halves (and a pending loan's share) into one item per bill, in due-date order. */
export function billItems(rows: PlanBillRow[]): BillItem[] {
  const groups = new Map<string, PlanBillRow[]>();
  for (const row of rows) {
    const key = row.group ?? row.id;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()].map(([key, parts]) => {
    const first = parts[0];
    const item: BillItem = { key, kind: first.kind, label: first.label, due_date: first.due_date, currency: first.currency,
      total: cents(parts.reduce((sum, part) => sum + Number(part.amount), 0)), loan: null, own: null };
    for (const part of parts) {
      if (part.paid_by_loan) item.loan = { amount: cents(part.amount), state: part.status === "PAID" ? "paid" : "scheduled" };
      else if (part.loan_pending) {
        const share = Math.min(cents(part.loan_pending.amount), cents(part.amount));
        item.loan = { amount: share, state: part.loan_pending.status === "APPROVED" ? "awaitingSigning" : "awaitingApproval" };
        // What the loan leaves can be paid once it is signed; until then the row cannot be paid.
        if (cents(part.amount) > share) item.own = { amount: cents(Number(part.amount) - share), row: null, paid: false };
      } else item.own = { amount: cents(part.amount), row: part, paid: part.status === "PAID" };
    }
    return item;
  }).sort((a, b) => a.due_date.localeCompare(b.due_date) || a.key.localeCompare(b.key));
}

/**
 * Where each bill goes on the pay tab, once: "toPay" when the family still owes part of it (with the loan's part noted),
 * "byLoan" when the loan alone still has to pay it, "done" when nothing is left to pay (shown in the records).
 */
export function payTabSections(items: BillItem[]) {
  const toPay = items.filter(item => item.own && !item.own.paid);
  const byLoan = items.filter(item => !toPay.includes(item) && item.loan && item.loan.state !== "paid");
  const done = items.filter(item => !toPay.includes(item) && !byLoan.includes(item));
  return { toPay, byLoan, done };
}

/** Items grouped under their due date, dates in order. */
export function byDueDate(items: BillItem[]) {
  const dates = new Map<string, BillItem[]>();
  for (const item of items) dates.set(item.due_date, [...(dates.get(item.due_date) ?? []), item]);
  return [...dates.entries()];
}

/** Sums per currency, for totals that may mix currencies. */
export function sumByCurrency(entries: { amount: number; currency: string }[]) {
  const totals = new Map<string, number>();
  for (const { amount, currency } of entries) totals.set(currency, cents((totals.get(currency) ?? 0) + amount));
  return [...totals.entries()].map(([currency, amount]) => ({ currency, amount }));
}
