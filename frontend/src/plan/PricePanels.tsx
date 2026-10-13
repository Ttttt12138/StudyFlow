import { ArrowRight } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { Scales } from "@phosphor-icons/react/dist/csr/Scales";
import { useState } from "react";
import { useI18n } from "../i18n";
import { useToolRefresh, useWorkspace } from "../workspace/context";
import { PanelEmpty, ToolPanel } from "../workspace/ToolPanel";
import type { CardActions } from "./cards";
import { convertAmount, useDisplay, useShow } from "./currency";
import { pick } from "./format";
import { GapCard, LoanOffer } from "./priceCards";
import type { Card, Plan } from "./types";

type Row = { card: Card; id: string };

/** Every total and comparison asked in this conversation, newest first; each opens its full result. */
export function CompareHistory({ rows }: { rows: Row[] }) {
  const { lang, t } = useI18n();
  const show = useShow();
  const { rates } = useDisplay();
  const workspace = useWorkspace();
  const priced = rows.filter(row => row.card.type === "cost" || row.card.type === "comparison").reverse();
  return <ToolPanel label={t("side.compare")}>
    {priced.length === 0 ? <PanelEmpty icon={Scales} title={t("price.historyEmpty")} text={t("price.historyHint")} /> :
      <ul className="price-history">{priced.map(({ card, id }) => {
        let title = "", figure = "", detail = "";
        if (card.type === "cost") {
          title = t("price.totalOf", { name: pick(card.school.name, lang), years: card.estimate.years });
          figure = show(card.estimate.total, card.estimate.currency, lang).main;
        } else if (card.type === "comparison") {
          title = card.schools.map(s => pick(s.name, lang)).join(" / ");
          const totals = card.schools.map(s => ({ s, base: convertAmount(s.total ?? s.first_year_total, s.currency, "THB", rates) }))
            .filter(x => x.base !== null).sort((a, b) => a.base! - b.base!);
          if (totals[0]) {
            const best = totals[0].s;
            figure = show(best.total ?? best.first_year_total, best.currency, lang).main;
            detail = t("price.historyBest", { name: pick(best.name, lang) });
          }
        }
        return <li key={id}><button type="button" onClick={() => workspace?.open({ kind: "card", cardId: id })}>
          <span><strong>{title}</strong>{detail && <small>{detail}</small>}</span>
          <span className="price-history-figure">{figure}<ArrowRight size={14} aria-hidden="true" /></span>
        </button></li>;
      })}</ul>}
  </ToolPanel>;
}

type Step = "gap" | "loan" | "confirm";

/** Funding before departure: what is missing, how a simulated loan or family support could cover it, then the plan. */
export function FundingPanel({ plan, actions, onRefresh }: { plan: Plan | null; actions: CardActions; onRefresh: () => Promise<void> }) {
  const { lang, t } = useI18n();
  const show = useShow();
  const workspace = useWorkspace();
  const stale = useToolRefresh(onRefresh);
  // Until the reader picks a step, follow the plan: gap, then loan, then confirmation.
  const [picked, setPicked] = useState<Step | null>(null);
  const step: Step = picked ?? (!plan || plan.status === "DRAFT" ? (plan?.loan ? "loan" : "gap") : "confirm");
  if (!plan) return <ToolPanel label={t("side.funding")} notices={stale}>
    <PanelEmpty title={t("price.fundingEmpty")} text={t("price.fundingHint")}
      action={!actions.readOnly && <button type="button" className="primary" disabled={actions.busy}
        onClick={() => actions.ask(t("price.askCheapest"))}>{t("price.askCheapest")}</button>} />
  </ToolPanel>;
  const cur = plan.currency ?? plan.school?.currency ?? "THB";
  const name = pick(plan.school?.name, lang) || plan.school_key;
  const gap = Number(plan.gap);
  const steps = [{ key: "gap" as const, label: t("price.stepGap"), done: plan.gap != null },
    { key: "loan" as const, label: t("price.stepLoan"), done: !!plan.loan || (plan.gap != null && gap <= 0) },
    { key: "confirm" as const, label: t("price.stepConfirm"), done: plan.status !== "DRAFT" }];
  return <ToolPanel label={t("side.funding")} steps={steps} active={step} onSelect={setPicked} notices={stale}>
    {step === "gap" && <>
      {plan.gap != null && gap > 0 ? <GapCard plan={plan} actions={actions} />
        : <p className="panel-muted">{plan.gap == null ? t("price.noFunds") : t("price.noGap")}</p>}
      <dl className="price-ledger">
        <div><dt>{t("price.totalOf", { name, years: plan.years })}</dt><dd>{show(plan.total, cur, lang).main}</dd></div>
        <div><dt>{t("plan.plan.funds")}</dt><dd>{plan.available_funds ? `− ${show(plan.available_funds, plan.funds_currency || cur, lang).main}` : t("plan.plan.noFunds")}</dd></div>
        {plan.gap != null && <div className="is-total"><dt>{t("plan.plan.gap")}</dt><dd>{show(plan.gap, cur, lang).main}</dd></div>}
      </dl>
      {plan.gap == null && !actions.readOnly && <button type="button" className="secondary" onClick={() => actions.ask(t("price.askFunds"))}>{t("price.askFunds")}</button>}
    </>}
    {step === "loan" && (plan.loan ? <LoanOffer plan={plan} actions={actions} /> : <div className="price-options">
      <p className="panel-muted">{gap > 0 ? t("price.loanIntro") : t("price.noGap")}</p>
      {gap > 0 && !actions.readOnly && <button type="button" className="price-option is-primary" disabled={actions.busy} onClick={() => actions.ask(t("price.askLoan"))}>
        <span><strong>{t("plan.loan.title")}</strong><small>{t("price.loanDefault")}</small></span><ArrowRight size={16} aria-hidden="true" /></button>}
      <button type="button" className="price-option" onClick={() => workspace?.open({ kind: "family" })}>
        <span><strong>{t("price.inviteFamily")}</strong><small>{t("price.familyHint")}</small></span><ArrowRight size={16} aria-hidden="true" /></button>
    </div>)}
    {step === "confirm" && <div className="price-options">
      <p className="panel-muted">{plan.status === "DRAFT" ? t("price.confirmIntro") : t(`plan.plan.status.${plan.status}`)}</p>
      {plan.status === "DRAFT" && !actions.readOnly && <button type="button" className="primary" disabled={actions.busy}
        onClick={() => actions.ask(t("price.askConfirm"))}>{t("price.stepConfirm")}</button>}
    </div>}
  </ToolPanel>;
}
