import { useI18n, type MessageKey } from "../i18n";
import { verdict } from "./verdict";
import { formatMoney } from "../backend/presenters";
import { pick } from "./format";
import type { PlanningAssessment, PlanningQuote } from "./assessmentTypes";
import { LoanProductNotice } from "../loans/LoanProductSelect";

export function QuoteFacts({ quote, showProduct = true, toSchool = false }: {
  quote: PlanningQuote; showProduct?: boolean;
  /** A planning loan is paid to the school, so its net amount is not "received". */
  toSchool?: boolean;
}) {
  const { t, lang } = useI18n();
  const r = quote.result;
  const study = quote.inputs.grace_months ?? 0;
  const facts: [MessageKey, string][] = [["simple.principalLabel", r.principal], [toSchool ? "stage.toSchool" : "simple.net", r.net_proceeds],
    ...(study > 0 ? [["choose.studyMonthly", r.repayments[0]?.amount] as [MessageKey, string]] : []),
    [study > 0 ? "choose.afterMonthly" : "simple.monthly", r.maximum_installment ?? r.repayments[0]?.amount], ["simple.interest", r.total_interest],
    ["simple.fees", r.fees], ["simple.totalRepay", r.total_repayment]];
  return <>{showProduct && <LoanProductNotice product={quote.inputs.product} />}<dl className="assessment-facts">{facts.map(([key, value]) => <div key={key}><dt>{t(key)}</dt><dd>{formatMoney(value, "THB", lang)}</dd></div>)}
    <div><dt>{t("simple.rate")}</dt><dd>{Number(quote.inputs.annual_rate) * 100}%</dd></div>
    <div><dt>{t("simple.firstDue")}</dt><dd>{quote.inputs.first_due_date}</dd></div></dl>
    {verdict(t, quote) && <p className={`assessment-status is-${quote.assessment.status}`}>{verdict(t, quote)}</p>}
    {quote.assessment.shortfall_months?.length ? <p className="panel-muted">{t("simple.shortMonths", { months: quote.assessment.shortfall_months.join("、") })}</p> : null}</>;
}

export function QuoteChoices({ quotes, selected, onSelect }: { quotes: PlanningQuote[]; selected: string; onSelect: (id: string) => void }) {
  const { t } = useI18n();
  return <section><h3>{t("simple.loanChoice")}</h3><div className="assessment-quotes">{quotes.map(q => <article key={q.id} className={q.id === selected ? "is-selected" : ""}>
    <label className="assessment-choice"><input type="radio" name="planning-quote" checked={q.id === selected} onChange={() => onSelect(q.id)} />
      <strong>{q.inputs.product === "commercial_student_demo" ? t("loanProduct.commercial") : t("simple.months", { n: q.inputs.months })}</strong></label>
    {q.inputs.product === "commercial_student_demo" && <p className="panel-muted">{t("simple.months", { n: q.inputs.months })} · {t("loanProduct.hint")}</p>}
    <QuoteFacts quote={q} showProduct={false} toSchool />
    <section className="assessment-group"><h4>{t("simple.schedule")}</h4><div className="assessment-table"><table><thead><tr><th>{t("simple.date")}</th><th>{t("simple.amount")}</th></tr></thead>
      <tbody>{q.result.repayments.map(r => <tr key={r.number}><td>{r.due_date}</td><td>{r.amount} THB</td></tr>)}</tbody></table></div></section>
  </article>)}</div></section>;
}

export function AssessmentResults({ data }: { data: PlanningAssessment }) {
  const { t, lang } = useI18n();
  const e = data.estimate;
  if (!e) return null;
  return <section><h3>{data.plan?.school && pick(data.plan.school.name, lang)}</h3>
    <dl className="assessment-facts"><div><dt>{t("simple.total")}</dt><dd>{formatMoney(e.total, e.currency, lang)}</dd></div>
      <div><dt>{t("simple.firstYear")}</dt><dd>{formatMoney(e.first_year, e.currency, lang)}</dd></div></dl>
    {e.complete === false && <p className="panel-note">{t("simple.incomplete")}: {e.missing_cost_ids?.join(", ")}</p>}
    {e.lines.map(c => <div className="assessment-item" key={c.cost_id}><p>{pick(c.label, lang)} · {c.total === null ? t("simple.unknown") : formatMoney(c.total, e.currency, lang)}</p>
      <small>{t(`plan.period.${c.period}` as MessageKey)}</small>
      {c.source_url && <a href={c.source_url} target="_blank" rel="noreferrer">{t("simple.sourceLink")}</a>}</div>)}
  </section>;
}
