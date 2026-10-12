import { useI18n } from "../i18n";
import { useWorkspace } from "../workspace/context";
import { money, pick } from "./format";
import { CardView, type CardActions } from "./cards";
import type { Card } from "./types";

export function CardSummary({ card, id, actions }: { card: Card; id: string; actions: CardActions }) {
  const { t, lang } = useI18n();
  const workspace = useWorkspace();
  if (card.type === "role" || card.type === "confirmation" || card.type === "spending" && card.expense) return <CardView card={card} actions={actions} />;
  let title = "", detail = "";
  switch (card.type) {
    case "school_list": case "comparison":
      title = t(card.type === "comparison" ? "plan.card.compare" : "plan.card.schools");
      detail = `${t("ws.schools", { n: card.schools.length })} · ${card.schools.slice(0, 3).map(s => pick(s.name, lang)).join(" / ")}`; break;
    case "school": title = card.school ? pick(card.school.school.name, lang) : t("plan.card.schools"); detail = card.school ? pick(card.school.school.program, lang) : ""; break;
    case "cost": title = t("plan.cost.title", { years: card.estimate.years }); detail = `${pick(card.school.name, lang)} · ${money(card.estimate.total, card.estimate.currency, lang)}`; break;
    case "plan": title = t("ws.plan"); detail = `${pick(card.plan.school?.name, lang) || card.plan.school_key} · ${t(`plan.plan.status.${card.plan.status}`)}`; break;
    case "loan": title = t("plan.loan.title"); detail = card.plan.loan ? money(card.plan.loan.principal, "THB", lang) : "—"; break;
    case "bills": title = t("plan.bills.title"); detail = t("ws.billsCount", { n: card.bills.length }); break;
    case "spending": title = t("plan.spending.title", { month: card.month }); detail = money(card.spent, card.currency, lang); break;
  }
  return <article className="workspace-card-summary">
    <h3>{title}</h3><p>{detail}</p>
    <span className="plan-badge">{t(["loan", "bills", "plan", "spending"].includes(card.type) ? "plan.simulated" : "plan.sample")}</span>{" "}
    <button className="chip" onClick={() => workspace?.open({ kind: "card", cardId: id })}>{t("ws.details")}</button>
    {card.type === "spending" && <button className="chip" onClick={() => workspace?.open({ kind: "spending", month: card.month })}>{t("plan.monthly.title")}</button>}
  </article>;
}
