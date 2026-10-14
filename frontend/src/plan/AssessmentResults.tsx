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
  const facts: [MessageKey, string][] = [["simple.principalLabel", r.principal], [toSchool ? "stage.toSchool" : "simple.net", r.net_proceeds],
    ["simple.monthly", r.maximum_installment ?? r.repayments[0]?.amount], ["simple.interest", r.total_interest],
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
    <QuoteFacts quote={q} showProduct={false} />
    <section className="assessment-group"><h4>{t("simple.schedule")}</h4><div className="assessment-table"><table><thead><tr><th>{t("simple.date")}</th><th>{t("simple.amount")}</th></tr></thead>
      <tbody>{q.result.repayments.map(r => <tr key={r.number}><td>{r.due_date}</td><td>{r.amount} THB</td></tr>)}</tbody></table></div></section>
  </article>)}</div></section>;
}

export function AssessmentResults({ data }: { data: PlanningAssessment }) {
  const { t, lang } = useI18n();
  const e = data.estimate, f = data.forecast;
  const money = (value: string, currency = "THB") => formatMoney(value, currency, lang);
  const issueLabel = (issue: string) => {
    const [code, ...parts] = issue.split(":");
    const id = parts[0] === "cost" ? parts[1] : parts[0];
    const fee = e?.lines.find(c => c.cost_id === id);
    const label = fee ? pick(fee.label, lang) : id === "available_funds" ? t("simple.funds") : id === "reserve" ? t("simple.reserve") : t("simple.support");
    const key = code === "FX_REQUIRED" ? "simple.missingFx" : code === "SUPPORT_DATE_PAST" ? "simple.pastSupport" : code === "MISSING" ? "simple.missingValue" : "simple.missingDate";
    return `${label}: ${t(key)}`;
  };
  return <>
    {e && <section><h3>{data.plan?.school && pick(data.plan.school.name, lang)}</h3>
      {e.program && <p className="panel-muted">{pick(e.program, lang)} · {t("simple.years", { n: e.years })}</p>}<dl className="assessment-facts">
      <div><dt>{t("simple.total")}</dt><dd>{money(e.total, e.currency)}</dd></div>
      <div><dt>{t("simple.firstYear")}</dt><dd>{money(e.first_year, e.currency)}</dd></div></dl>
      {e.complete === false && <p className="panel-note">{t("simple.incomplete")}: {e.missing_cost_ids?.join(", ")}</p>}
      <section className="assessment-group"><h4>{t("simple.feeList")}</h4>{e.lines.map(c => <div className="assessment-item" key={c.cost_id}>
        <p>{pick(c.label, lang)} · {c.total === null ? t("simple.unknown") : money(c.total, e.currency)}</p>
        <p className="panel-muted">{t(`plan.period.${c.period}` as MessageKey)} · {c.occurrences ?? "—"} × {c.amount ?? "—"} {e.currency} · {c.observed_at}
          {c.estimate && <> · {t("plan.estimate")}</>}</p>
        {c.quote && <blockquote>{c.quote}</blockquote>}
        {c.source_url && <a href={c.source_url} target="_blank" rel="noreferrer">{t("simple.sourceLink")}</a>}</div>)}</section></section>}
    {f && <section><h3>{t("simple.forecast", { days: f.horizon })}</h3><p className="panel-muted">{f.as_of} → {f.end_date}</p>
      <dl className="assessment-facts"><div><dt>{t("simple.gap")}</dt><dd>{f.complete ? money(f.maximum_reserve_gap) : t("simple.unknown")}</dd></div>
        <div><dt>{t("simple.firstGap")}</dt><dd>{f.first_gap_date ?? (f.complete ? t("simple.noGap") : t("simple.unknown"))}</dd></div>
        {data.inputs?.supports.some(s => !s.confirmed && !s.included_in_funds) && data.conditional_forecast && <div><dt>{t("simple.conditional")}</dt><dd>{money(data.conditional_forecast.maximum_reserve_gap)}</dd></div>}</dl>
      {!f.complete && <section className="assessment-group panel-note"><h4>{t("simple.missing")} ({f.issues.length})</h4>
        <ul>{[...new Set(f.issues.map(issueLabel))].map(issue => <li key={issue}>{issue}</li>)}</ul></section>}</section>}
  </>;
}
