import { describe, expect, it } from "vitest";
import { canCancel, defaultFirstDue, effectiveAnnualRate, nextDueDate, nextInstallment, percentToFraction, profileCoverage, repayEligibility, repaymentMonths } from "./logic";
import type { Installment, InstallmentStatus, LoanAccount, LoanApplication, LoanQuote } from "./types";

const inst = (number: number, status: InstallmentStatus, due_on: string): Installment =>
  ({ id: `i${number}`, number, due_on, amount: "1000.00", principal: "900.00", paid_on: status === "PAID" ? due_on : null, status });
const account = (rows: Installment[], status: LoanAccount["status"] = "ACTIVE"): LoanAccount =>
  ({ id: "a1", created_at: "", disbursement: "d1", status, version: 2, outstanding_principal: "1800.00", installments: rows });

describe("percentToFraction", () => {
  it("shifts the decimal point without floating point", () => {
    expect(percentToFraction("12")).toBe("0.12");
    expect(percentToFraction("7.25")).toBe("0.0725");
    expect(percentToFraction("0.5")).toBe("0.005");
    expect(percentToFraction("0")).toBe("0");
    expect(percentToFraction("100")).toBe("1");
    expect(percentToFraction(" 6 ")).toBe("0.06");
    expect(percentToFraction("12.345678")).toBe("0.12345678");
  });
  it("rejects values Django would refuse", () => {
    expect(percentToFraction("")).toBeNull();
    expect(percentToFraction("-1")).toBeNull();
    expect(percentToFraction("101")).toBeNull();
    expect(percentToFraction("1.2345678")).toBeNull();
    expect(percentToFraction("1e2")).toBeNull();
  });
});

describe("nextInstallment / repayEligibility", () => {
  const rows = [inst(3, "SCHEDULED", "2026-12-15"), inst(1, "PAID", "2026-10-15"), inst(2, "DUE", "2026-11-15")];
  it("picks the lowest-numbered unpaid installment", () => {
    expect(nextInstallment(account(rows))?.number).toBe(2);
    expect(nextInstallment(account([inst(1, "PAID", "2026-10-15")]))).toBeNull();
  });
  it("allows only the next installment once it is due or overdue", () => {
    expect(repayEligibility(account(rows), rows[2])).toBe("ok");
    expect(repayEligibility(account(rows), rows[0])).toBe("not_next");
    expect(repayEligibility(account(rows), rows[1])).toBe("paid");
    const overdue = [inst(1, "OVERDUE", "2026-10-15"), inst(2, "DUE", "2026-11-15")];
    expect(repayEligibility(account(overdue), overdue[0])).toBe("ok");
    const early = [inst(1, "SCHEDULED", "2026-10-15")];
    expect(repayEligibility(account(early), early[0])).toBe("not_due");
    expect(repayEligibility(account(rows, "CLOSED"), rows[2])).toBe("closed");
  });
  it("finds the next due date across active accounts", () => {
    const later = { ...account([inst(1, "SCHEDULED", "2027-01-05")]), id: "a2" };
    expect(nextDueDate([account(rows), later])).toBe("2026-11-15");
    expect(nextDueDate([account(rows, "CLOSED")])).toBeNull();
  });
});

describe("profileCoverage", () => {
  const quote = { result: { repayments: [
    { number: 1, due_date: "2027-01-15", amount: "10.00" }, { number: 2, due_date: "2027-02-15", amount: "10.00" },
    { number: 3, due_date: "2027-03-15", amount: "10.00" }] } } as unknown as LoanQuote;
  it("lists the repayment months of a quote", () => {
    expect(repaymentMonths(quote)).toEqual(["2027-01", "2027-02", "2027-03"]);
    expect(repaymentMonths(undefined)).toEqual([]);
  });
  it("reports missing and incomplete months", () => {
    const months = repaymentMonths(quote);
    const result = profileCoverage(months, [
      { month: "2027-01", income: "100", living_expenses: "50", existing_repayments: "0" },
      { month: "2027-02", income: "100", living_expenses: null, existing_repayments: "0" },
      { month: "2026-12", income: "100", living_expenses: "50", existing_repayments: "0" },
    ]);
    expect(result.missing).toEqual(["2027-03"]);
    expect(result.incomplete).toEqual(["2027-02"]);
    expect(result.complete).toBe(false);
    expect(profileCoverage(["2027-01"], [{ month: "2027-01", income: "1", living_expenses: "0", existing_repayments: "0" }]).complete).toBe(true);
  });
});

describe("helpers", () => {
  it("estimates a fee-inclusive annual rate above the nominal one", () => {
    const rows = Array.from({ length: 6 }, () => ({ amount: "10175.73" }));
    const rate = effectiveAnnualRate("58800.00", rows)!;
    expect(rate).toBeGreaterThan(0.06);
    expect(rate).toBeLessThan(0.2);
    expect(effectiveAnnualRate("100.00", [{ amount: "100.00" }])).toBe(0);
    expect(effectiveAnnualRate("0", [])).toBeNull();
  });
  it("cancels only non-final applications", () => {
    const app = (status: LoanApplication["status"]) => ({ status }) as LoanApplication;
    expect(canCancel(app("DRAFT"))).toBe(true);
    expect(canCancel(app("APPROVED"))).toBe(true);
    expect(canCancel(app("DISBURSED"))).toBe(false);
    expect(canCancel(app("CANCELLED"))).toBe(false);
  });
  it("proposes a first due date one month after the demo clock", () => {
    expect(defaultFirstDue("2026-11-15")).toBe("2026-12-15");
    expect(defaultFirstDue("2026-01-31")).toBe("2026-02-28");
  });
});
