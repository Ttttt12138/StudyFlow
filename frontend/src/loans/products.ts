import type { MessageKey } from "../i18n";

export type LoanProduct = "custom" | "commercial_student_demo";
export const COMMERCIAL_STUDY_TERMS = { annual_rate: "0.06", fees: "0.00", periods: [48, 24] };

export function loanProductLabel(product?: LoanProduct): MessageKey {
  return product === "commercial_student_demo" ? "loanProduct.commercial" : "loanProduct.custom";
}
