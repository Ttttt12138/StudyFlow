import { describe, expect, it } from "vitest";
import { problem } from "./confirmation/adapter";
import type { Field } from "./confirmation/types";
import { expenseProblems, newExpense } from "./expenses/adapter";
import { previewQuotes } from "./wallet/mockAdapter";

const field = (kind: Field["kind"], original: string | null, extra: Partial<Field> = {}): Field =>
  ({ id: "f", label: "F", original, status: "known", required: true, kind, evidence: [], ...extra });

describe("confirmation problem()", () => {
  it("requires required values and accepts optional blanks", () => {
    expect(problem(field(undefined, null), {})).toBe("Required information is missing.");
    expect(problem(field(undefined, null, { required: false }), {})).toBeNull();
  });

  it.each([
    ["amount", "12000", null],
    ["amount", "12000.50", null],
    ["amount", "-5", "Enter a valid non-negative amount."],
    ["amount", "1.005", "Enter a valid non-negative amount."],
    ["currency", "USD", null],
    ["currency", "usd", "Use a three-letter uppercase currency code."],
    ["date", "2027-01-10", null],
    ["date", "2027-02-30", "Enter a valid due date."],
    ["date", "10/01/2027", "Enter a valid due date."],
  ] as const)("%s %s", (kind, value, expected) => {
    expect(problem(field(kind, value), {})).toBe(expected);
  });

  it("checks the student's correction instead of the extraction", () => {
    expect(problem(field("amount", "12000"), { f: "abc" })).toBe("Enter a valid non-negative amount.");
  });

  it("asks for a verified value while sources conflict", () => {
    const conflicting = field("amount", "12000", { alternatives: [{ value: "12500", source: "invoice" }] });
    expect(problem(conflicting, {})).toMatch(/Conflicting sources/);
    expect(problem(conflicting, { f: "12500" })).toBeNull();
  });
});

describe("expenseProblems", () => {
  const known = { ...newExpense("Rent"), status: "known" as const, amount: "9000", currency: "THB", recurrence: "monthly" as const };

  it("accepts a complete monthly expense", () => {
    expect(expenseProblems(known)).toEqual([]);
  });

  it("requires a label and an acknowledged missing amount", () => {
    expect(expenseProblems(newExpense())).toEqual(["Add an expense label.", "Mark this expense as missing to continue, or enter an amount."]);
    expect(expenseProblems({ ...newExpense("Food"), missingAcknowledged: true })).toEqual([]);
  });

  it("validates amount, currency and one-time due dates", () => {
    expect(expenseProblems({ ...known, amount: "9,000", currency: "thb" })).toHaveLength(2);
    expect(expenseProblems({ ...known, recurrence: "once", dueDate: "2027-13-01" })).toEqual(["Enter a valid due date."]);
  });
});

describe("wallet preview quotes", () => {
  it("are still valid whatever today's date is", () => {
    for (const quote of previewQuotes()) expect(Date.parse(quote.expires_at)).toBeGreaterThan(Date.now());
  });
});
