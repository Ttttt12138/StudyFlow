import type { LoanOffer, LoanPreview, PlanningAssessment } from "./assessmentTypes";

export type LoanAdvice = {
  status: "needs_amount" | "recommended" | "paused" | "submitted";
  intent?: string; product?: LoanOffer; selected?: Omit<LoanPreview, "schedule">;
  alternatives?: Omit<LoanPreview, "schedule">[];
  change?: { principal: string; monthly_payment: string; total_interest: string; total_repayment: string } | null;
  ready_to_apply?: boolean; quote_id?: string; assessment_version?: number; plan_version?: number;
};
export type LoanReview = { planId: string; quoteId: string; assessmentVersion: number; planVersion: number };

export function matchesLoanReview(data: PlanningAssessment, review: LoanReview) {
  return data.plan?.id === review.planId && data.plan.status === "DRAFT" && !data.draft && !data.stale
    && data.version === review.assessmentVersion && data.plan_version === review.planVersion
    && data.quotes.some(quote => quote.id === review.quoteId);
}
