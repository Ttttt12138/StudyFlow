import { useI18n, type MessageKey } from "../i18n";
import { loanProductLabel } from "../loans/products";
import { formatMoney } from "../backend/presenters";
import type { CardActions } from "./cards";
import type { Card } from "./types";

export function LoanAdviceCard({ card, actions }: { card: Extract<Card, { type: "loan_advice" }>; actions: CardActions }) {
  const { t, lang } = useI18n();
  const advice = card.advice, selected = advice.selected;
  const cash = (value: string | null | undefined) => formatMoney(value, "THB", lang);
  const paused = advice.status === "paused", submitted = advice.status === "submitted";
  const reason = advice.intent === "lower_monthly" ? "advice.reason.monthly"
    : advice.intent === "lower_interest" ? "advice.reason.interest" : "advice.reason.default";
  const active = !actions.readOnly && !submitted;
  return <article className="price-card loan-advice-card" aria-label={t("advice.title")}>
    <div className="price-head"><h3>{t(paused ? "advice.paused" : submitted ? "advice.submitted" : "advice.title")}</h3>
      <span className="price-tag is-quiet">{t("price.loanSim")}</span></div>
    {selected && <>
      <strong>{t(loanProductLabel(selected.product))} · {t("simple.months", { n: selected.months })}</strong>
      <p className="price-sub">{t(reason)}</p>
      <p className="price-label">{t(selected.interest_only_months ? "choose.afterMonthly" : "simple.monthly")}</p>
      <p className="price-big">{cash(selected.monthly_payment)}</p>
      {!!selected.interest_only_months && <p>{t("choose.studyPay", { n: selected.interest_only_months, amount: cash(selected.interest_only_payment) })}</p>}
      <dl className="price-groups loan-advice-facts">
        {([["simple.principalLabel", selected.principal], ["simple.interest", selected.total_interest],
          ["simple.fees", selected.fees], ["simple.totalRepay", selected.total_repayment],
          ["stage.toSchool", selected.net_proceeds]] as [MessageKey, string][]).map(([key, value]) =>
          <div key={key}><dt>{t(key)}</dt><dd>{cash(value)}</dd></div>)}
        <div><dt>{t("simple.rate")}</dt><dd>{Number(selected.annual_rate) * 100}%</dd></div>
        <div><dt>{t("simple.firstDue")}</dt><dd>{selected.first_due_date}</dd></div>
      </dl>
      {advice.change && <div className="loan-advice-change"><strong>{t("advice.change")}</strong>
        {(["monthly_payment", "total_interest"] as const).map(key => <p key={key}>{t(key === "monthly_payment" ? "simple.monthly" : "simple.interest")}: {Number(advice.change![key]) > 0 ? "+" : ""}{cash(advice.change![key])}</p>)}</div>}
      {!!advice.alternatives?.length && <details className="loan-advice-alternatives"><summary>{t("advice.compare")}</summary>
        {advice.alternatives.map((row, i) => <div key={i}><strong>{t(loanProductLabel(row.product))} · {t("simple.months", { n: row.months })}</strong>
          <p>{t("simple.monthly")}: {cash(row.monthly_payment)} · {t("simple.interest")}: {cash(row.total_interest)}</p>
          <p>{t("simple.totalRepay")}: {cash(row.total_repayment)}</p></div>)}
      </details>}
    </>}
    {advice.status === "needs_amount" && <>
      {advice.product && <p>{t(loanProductLabel(advice.product.key))} · {t("simple.rate")} {Number(advice.product.annual_rate) * 100}%</p>}
      <p>{t("advice.amount")}</p></>}
    {active && <div className="price-actions">
      {selected && advice.quote_id && advice.assessment_version && advice.plan_version && <button type="button" className="primary" disabled={actions.busy}
        onClick={() => actions.reviewLoan?.({ planId: card.plan_id, quoteId: advice.quote_id!, assessmentVersion: advice.assessment_version!, planVersion: advice.plan_version! })}>{t("advice.apply")}</button>}
      {paused ? <button type="button" className="secondary" disabled={actions.busy} onClick={() => actions.ask(t("advice.resume"))}>{t("advice.resume")}</button>
        : <div className="loan-advice-concerns">{(selected ? ["advice.monthly", "advice.interest", "advice.reduce", "advice.pause"] : ["advice.pause"]).map(key =>
          <button type="button" className="chip" key={key} disabled={actions.busy} onClick={() => actions.ask(t(key as MessageKey))}>{t(key as MessageKey)}</button>)}</div>}
    </div>}
  </article>;
}
