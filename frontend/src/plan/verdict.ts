import type { MessageKey } from "../i18n";
import type { PlanningQuote } from "./assessmentTypes";

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

/** Whether the declared monthly budget can carry a loan, in words a family can act on. */
export function verdict(t: Translate, quote: PlanningQuote) {
  const { status, shortfall_months: short } = quote.assessment;
  if ((status as string) === "NOT_ASSESSED") return "";
  if (status === "AFFORDABLE") return t("simple.affordable");
  if (status === "UNAFFORDABLE") return t("simple.unaffordable", { n: short?.length ?? 0 });
  return t("simple.insufficient");
}
