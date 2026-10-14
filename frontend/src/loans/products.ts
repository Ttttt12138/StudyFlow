import type { MessageKey } from "../i18n";

export type LoanProduct = "custom" | "commercial_student_demo";
/** The study loan example: a lower fixed rate, and the only product offered over 60 months (planning/products.py). */
export const COMMERCIAL_STUDY_TERMS = { annual_rate: "0.045", fees: "0.00", periods: [60, 48] };

export function loanProductLabel(product?: LoanProduct): MessageKey {
  return product === "commercial_student_demo" ? "loanProduct.commercial" : "loanProduct.custom";
}
