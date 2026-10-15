import type { MessageKey } from "../i18n";
import type { PlanningQuote } from "./assessmentTypes";

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

/** An older assessment's affordability, in words a family can act on. New quotes are NOT_ASSESSED and show nothing. */
export function verdict(t: Translate, quote: PlanningQuote) {
  const { status, shortfall_months: short } = quote.assessment;
  if (status === "AFFORDABLE") return t("simple.affordable");
  if (status === "UNAFFORDABLE") return t("simple.unaffordable", { n: short?.length ?? 0 });
  return "";
}
