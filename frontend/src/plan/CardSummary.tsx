import { ArrowRight } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { Check } from "@phosphor-icons/react/dist/csr/Check";
import { useI18n } from "../i18n";
import { useWorkspace } from "../workspace/context";
import { money, pick } from "./format";
import { CardView, type CardActions } from "./cards";
import { CompareCard, LoanOffer, PriceCard } from "./priceCards";
import { useShow } from "./currency";
import type { Card, Plan } from "./types";

/**
 * A result under an assistant reply. Prices, comparisons, the funding gap and the loan are shown in full in the
 * conversation; everything else is a one-line summary that opens in the tool panel.
 */
export function CardSummary({ card, id, actions }: { card: Card; id: string; actions: CardActions }) {
  const { t, lang } = useI18n();
  const workspace = useWorkspace();
  const show = useShow();
  if (card.type === "role") return null;
  if (card.type === "confirmation" || card.type === "spending" && card.expense) return <CardView card={card} actions={actions} />;
  if (card.type === "cost") return <PriceCard id={id} name={card.school.name} estimate={card.estimate} actions={actions} />;
  if (card.type === "comparison" || card.type === "school_list") return <CompareCard id={id} schools={card.schools} actions={actions} list={card.type === "school_list"} />;
  if (card.type === "loan" && card.plan.loan) return <LoanOffer plan={card.plan} actions={actions} />;
  let title = "", detail = "", next = "";
  switch (card.type) {
    case "school": title = card.school ? pick(card.school.school.name, lang) : t("plan.card.schools"); detail = card.school ? pick(card.school.school.program, lang) : ""; break;
    case "plan": title = t("ws.plan"); detail = `${pick(card.plan.school?.name, lang) || card.plan.school_key} · ${t(`plan.plan.status.${card.plan.status}`)}`;
      next = planNext(card.plan, t, (value, from) => show(value, from, lang).main); break;
    case "loan": title = t("plan.loan.title"); detail = "—"; break;
    case "bills": title = t("plan.bills.title"); detail = t("ws.billsCount", { n: card.bills.length }); break;
    case "spending": title = t("plan.spending.title", { month: card.month }); detail = money(card.spent, card.currency, lang); break;
  }
  return <article className="workspace-card-summary">
    <span className="workspace-card-check" aria-hidden="true"><Check size={13} weight="bold" /></span>
    <h3>{title}</h3><p>{detail}</p>{next && <p className="workspace-card-next">{next}</p>}
    <span className="plan-badge">{t(["loan", "bills", "plan", "spending"].includes(card.type) ? "plan.simulated" : "plan.sample")}</span>{" "}
    <button className="chip" onClick={() => workspace?.open(card.type === "plan" ? { kind: "funding" } : { kind: "card", cardId: id })}>{t(card.type === "plan" ? "simple.choose" : "ws.details")}<ArrowRight size={14} aria-hidden="true" /></button>
    {card.type === "spending" && <button className="chip" onClick={() => workspace?.open({ kind: "life" })}>{t("life.title")}</button>}
  </article>;
}

/** The plan card's one line: what is still needed, and the next step. */
function planNext(plan: Plan, t: ReturnType<typeof useI18n>["t"], money: (value: string, from: string) => string) {
  if (plan.status === "ENROLLED") return t("plan.card.next.enrolled");
  if (plan.status === "CONFIRMED") return t("plan.card.next.loan");
  if (plan.gap == null) return t("plan.card.next.funds");
  return `${t("plan.card.gapLine", { amount: money(plan.gap, plan.currency ?? "THB") })} · ${t("plan.card.next.choose")}`;
}
