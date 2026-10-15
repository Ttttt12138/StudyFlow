import { describe, expect, it } from "vitest";
import { billItems, byDueDate, payTabSections, sumByCurrency, type PlanBillRow } from "./billGroups";

const row = (id: string, extra: Partial<PlanBillRow> = {}): PlanBillRow => ({ id, kind: "insurance", label: { en: id, zh: id },
  due_date: "2029-08-09", amount: "1000.00", currency: "THB", status: "DUE", paid_at: null, paid_by_loan: false, group: id, ...extra });

describe("pay tab bill items", () => {
  it("shows a bill the loan only partly covers once, with both parts", () => {
    const items = billItems([row("insurance:y3", { amount: "2300.00" }),
      row("insurance:y3:loan", { amount: "4700.00", paid_by_loan: true, group: "insurance:y3" })]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ key: "insurance:y3", total: 7000, loan: { amount: 4700, state: "scheduled" },
      own: { amount: 2300, paid: false } });
    const { toPay, byLoan } = payTabSections(items);
    expect(toPay.map(i => i.key)).toEqual(["insurance:y3"]);
    expect(byLoan).toEqual([]);
  });

  it("puts each bill in exactly one section", () => {
    const items = billItems([
      row("self", { due_date: "2029-12-09" }),
      row("loan", { paid_by_loan: true, kind: "tuition" }),
      row("loanPaid", { paid_by_loan: true, status: "PAID" }),
      row("selfPaid", { status: "PAID" }),
      row("pending", { loan_pending: { amount: "1000.00", status: "APPROVED" } }),
      row("pendingPart", { amount: "1500.00", loan_pending: { amount: "1000.00", status: "UNDER_REVIEW" } }),
    ]);
    const { toPay, byLoan, done } = payTabSections(items);
    expect(toPay.map(i => i.key)).toEqual(["pendingPart", "self"]);
    expect(byLoan.map(i => i.key)).toEqual(["loan", "pending"]);
    expect(done.map(i => i.key).sort()).toEqual(["loanPaid", "selfPaid"]);
    // The rest of a bill the pending loan covers cannot be paid until signing: no row to pay.
    expect(toPay[0].own).toEqual({ amount: 500, row: null, paid: false });
    expect(toPay[0].loan).toEqual({ amount: 1000, state: "awaitingApproval" });
    expect(byLoan[1].loan?.state).toBe("awaitingSigning");
  });

  it("groups by due date and sums per currency", () => {
    const items = billItems([row("a", { due_date: "2029-08-09" }), row("b", { due_date: "2029-12-09", currency: "USD", amount: "20.50" }),
      row("c", { due_date: "2029-08-09", amount: "0.10" })]);
    expect(byDueDate(items).map(([date, list]) => [date, list.length])).toEqual([["2029-08-09", 2], ["2029-12-09", 1]]);
    expect(sumByCurrency(items.map(i => ({ amount: i.total, currency: i.currency })))).toEqual([
      { currency: "THB", amount: 1000.1 }, { currency: "USD", amount: 20.5 }]);
  });
});
