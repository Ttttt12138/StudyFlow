import { describe, expect, it } from "vitest";
import { explainCode, formatAmount, formatDate, formatMoney, formatRate, formatTimestampDate } from "./presenters";

describe("formatAmount", () => {
  it.each([
    ["1234567.89", "1,234,567.89"],
    ["-4500.00", "-4,500.00"],
    ["999", "999"],
    ["0.123456", "0.123456"],
    [" 1000.5 ", "1,000.5"],
  ])("groups thousands without changing B's decimals: %s", (input, expected) => {
    expect(formatAmount(input)).toBe(expected);
  });

  it("passes through values that are not plain decimals", () => {
    expect(formatAmount("1e5")).toBe("1e5");
    expect(formatAmount("12,000")).toBe("12,000");
  });

  it.each([null, undefined, "", "   ", 42])("treats %s as not supplied", (input) => {
    expect(formatAmount(input)).toBeNull();
  });
});

describe("formatMoney", () => {
  it("prefixes the currency", () => {
    expect(formatMoney("65000.00", "THB")).toBe("THB 65,000.00");
    expect(formatMoney("12", "USD")).toBe("USD 12");
  });

  it("never invents an amount", () => {
    expect(formatMoney(null, "THB")).toBe("Amount not supplied");
  });
});

describe("formatDate", () => {
  it("formats calendar dates without shifting the day", () => {
    expect(formatDate("2026-01-01")).toBe("Jan 1, 2026");
    expect(formatDate("2026-12-31")).toBe("Dec 31, 2026");
  });

  it("keeps unparseable input and reports missing dates", () => {
    expect(formatDate("soon")).toBe("soon");
    expect(formatDate(null)).toBe("Date not supplied");
    expect(formatDate("")).toBe("Date not supplied");
  });
});

describe("formatTimestampDate", () => {
  it("uses the viewer's calendar day for a timestamp", () => {
    const stamp = "2026-10-11T17:30:00Z";
    const local = new Date(stamp);
    const expected = new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric" }).format(local);
    expect(formatTimestampDate(stamp)).toBe(expected);
  });

  it("keeps unparseable input and reports missing timestamps", () => {
    expect(formatTimestampDate("not a time")).toBe("not a time");
    expect(formatTimestampDate(undefined)).toBe("Date not supplied");
  });
});

describe("explainCode", () => {
  it("explains known codes with their detail", () => {
    expect(explainCode("MISSING:food")).toBe("food needs an amount or an explicit missing status.");
    expect(explainCode("CONFLICT:tuition_fee")).toBe("Review conflicting source values for tuition fee.");
    expect(explainCode("APPROVED")).toMatch(/does not mean money has arrived/);
  });

  it("turns unknown codes into readable text", () => {
    expect(explainCode("NEXT_PAYMENT_DUE")).toBe("Next payment due");
  });
});

describe("formatRate", () => {
  it.each([
    ["4.5816000000", "4.5816"],
    ["33.0500000000", "33.0500"],
    ["0.21739130434", "0.2174"],
    [32.8, "32.8000"],
  ])("shows four decimals: %s", (input, expected) => {
    expect(formatRate(input)).toBe(expected);
  });

  it("keeps unparseable values and marks missing ones", () => {
    expect(formatRate("n/a")).toBe("n/a");
    expect(formatRate(null)).toBe("—");
  });
});
