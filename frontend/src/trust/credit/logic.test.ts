import { describe, expect, it } from "vitest";
import { cleanStatement, expiresAt, isLevel, newSnapshots, reasonKey, statementProblem, STATEMENT_MAX, type CreditSnapshot } from "./logic";

const snap = (id: string): CreditSnapshot => ({ id, created_at: "2026-10-11T00:00:00Z", level: "FAIR", on_time: 4, late: 0, overdue: 0, as_of: "2026-10-11" });

describe("statement input", () => {
  it("drops whitespace that email or chat wrapping adds", () => {
    expect(cleanStatement("  eyJh:1abc\n:sig\r\n ")).toBe("eyJh:1abc:sig");
    expect(cleanStatement("a b\tc")).toBe("abc");
  });
  it("reports empty and over-long statements before sending them", () => {
    expect(statementProblem(cleanStatement(" \n "))).toBe("empty");
    expect(statementProblem("x".repeat(STATEMENT_MAX))).toBeNull();
    expect(statementProblem("x".repeat(STATEMENT_MAX + 1))).toBe("tooLong");
  });
});

describe("verification result", () => {
  it("maps known reasons and falls back for anything else", () => {
    expect(reasonKey("INVALID_SIGNATURE")).toBe("INVALID_SIGNATURE");
    expect(reasonKey("EXPIRED")).toBe("EXPIRED");
    expect(reasonKey("SNAPSHOT_MISMATCH")).toBe("SNAPSHOT_MISMATCH");
    expect(reasonKey("SOMETHING_NEW")).toBe("UNKNOWN");
  });
  it("recognizes only the four levels", () => {
    expect(isLevel("GOOD")).toBe(true);
    expect(isLevel("EXCELLENT")).toBe(false);
  });
  it("computes the 90-day expiry from issued_at", () => {
    expect(expiresAt("2026-10-11T00:00:00+00:00")?.toISOString()).toBe("2027-01-09T00:00:00.000Z");
    expect(expiresAt("not a date")).toBeNull();
  });
});

describe("lost create recovery", () => {
  it("finds snapshots that appeared after the lost request", () => {
    expect(newSnapshots([snap("a")], [snap("b"), snap("a")]).map((item) => item.id)).toEqual(["b"]);
    expect(newSnapshots([snap("a")], [snap("a")])).toEqual([]);
  });
});
