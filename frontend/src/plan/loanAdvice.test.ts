import { describe, expect, it } from "vitest";
import { matchesLoanReview } from "./loanAdvice";
import type { PlanningAssessment } from "./assessmentTypes";

const review = { planId: "plan", quoteId: "quote", assessmentVersion: 3, planVersion: 2 };
const current = { plan: { id: "plan", status: "DRAFT" }, plan_version: 2, version: 3,
  quotes: [{ id: "quote" }] } as PlanningAssessment;

describe("loan recommendation application review", () => {
  it("accepts only the current plan and quoted assessment", () => {
    expect(matchesLoanReview(current, review)).toBe(true);
    for (const patch of [{ version: 4 }, { plan_version: 3 }, { quotes: [{ id: "other" }] },
      { draft: true }, { stale: true }, { plan: { id: "plan", status: "CONFIRMED" } },
      { plan: { id: "other", status: "DRAFT" } }]) {
      expect(matchesLoanReview({ ...current, ...patch } as PlanningAssessment, review)).toBe(false);
    }
  });
});
