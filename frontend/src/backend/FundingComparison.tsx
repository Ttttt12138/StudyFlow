import { useI18n } from "../i18n";
import type { Application, FundingResult, FundingSource, LoanQuote, Run } from "./contracts";
import { explainCode, formatDate, formatMoney } from "./presenters";

type Props = {
  recommendation: Run<FundingResult> | null;
  current: boolean;
  sources: FundingSource[];
  quotes: LoanQuote[];
  application: Application | null;
  onReviewQuote: (id: string) => void;
  onValidatePlan: () => void;
  validationDisabled: boolean;
  savedPlan: Run<Record<string, unknown>> | null;
  preview?: boolean;
  // Gap and allocation amounts are in the backend home currency.
  homeCurrency?: string;
};

function value(input: unknown): string | null {
  return typeof input === "string" && input.trim() ? input : null;
}

export function FundingComparison({ recommendation, current, sources, quotes, application, onReviewQuote, onValidatePlan, validationDisabled, savedPlan, preview = false, homeCurrency = "THB" }: Props) {
  const { lang, t } = useI18n();
  const money = (input: unknown, currency?: string) => formatMoney(input, currency, lang);
  const date = (input: unknown) => formatDate(input, lang);
  const explain = (code: string) => explainCode(code, lang);
  const plan = recommendation?.result.nonloan_plan;
  const allocationBySource = new Map(plan?.allocations.map((item) => [item.source_id, item.amount]) ?? []);
  return <section className="card backend-section funding-comparison" aria-labelledby="funding-comparison-title">
    <span className="eyebrow">{t("fund.eyebrow")}</span>
    <h2 id="funding-comparison-title">{t("fund.title")}</h2>
    <p>{t("fund.intro")}</p>
    {recommendation && !current && <div className="stale-banner" role="status"><strong>{t("fund.stale.title")}</strong><span>{t("fund.stale.text")}</span></div>}
    <div className="result-highlights funding-highlights"><div><span>{recommendation && !current ? t("fund.gap.outdated") : t("fund.gap.reported")}</span><strong>{plan ? money(plan.remaining_gap, homeCurrency) : t("fund.gap.none")}</strong><small>{plan ? recommendation?.result.is_recommendation_final ? t("fund.gap.final") : t("fund.gap.conditional") : t("fund.gap.request")}</small></div><div><span>{t("fund.status.label")}</span><strong>{plan ? explain(plan.validation) : t("fund.status.waiting")}</strong><small>{plan ? t(plan.conditions.length === 1 ? "fund.status.condOne" : "fund.status.condMany", { count: plan.conditions.length }) : t("fund.status.noDecision")}</small></div></div>
    <details className="result-details student-explainer"><summary>{t("fund.explainer.summary")}</summary><p>{t("fund.explainer.text")}</p></details>
    {plan?.conditions.length ? <div className="result-attention"><strong>{t("fund.attention")}</strong><ul>{plan.conditions.map((condition, index) => <li key={index}>{explain(condition)}</li>)}</ul></div> : null}
    {preview && <div className="preview-funding-glance" role="region" aria-label={t("fund.glance.label")}><div><strong>{t("fund.glance.sources")}</strong>{sources.length ? sources.map(source => <p key={source.id}>{source.kind.replaceAll("_", " ")} · {money(source.amount, source.currency)} · {source.received ? t("plan.received") : t("plan.notReceived")}</p>) : <p>{t("fund.glance.noSources")}</p>}</div><div><strong>{t(quotes.length === 1 ? "fund.glance.quotesOne" : "fund.glance.quotesMany", { count: quotes.length })}</strong>{quotes.length ? quotes.map((quote, index) => <p key={quote.id}>{t("fund.glance.option", { n: index + 1, net: money(quote.result?.net_proceeds, quote.inputs?.currency ?? homeCurrency), total: money(quote.result?.total_repayment, quote.inputs?.currency ?? homeCurrency) })}</p>) : <p>{t("fund.glance.noQuotes")}</p>}</div></div>}
    <details className="result-details funding-section"><summary>{t("fund.details.summary")}</summary><div className="comparison-grid">
      <div className="comparison-panel">
        <h3>{t("fund.sources.title")}</h3>
        <p>{t("fund.sources.text")}</p>
        {sources.length ? <ul className="comparison-list">{sources.map((source) => <li key={source.id}>
          <strong>{source.kind.replaceAll("_", " ")}</strong>
          <dl>
            <div><dt>{t("fund.sources.amount")}</dt><dd>{money(source.amount, source.currency)}</dd></div>
            <div><dt>{t("fund.sources.availableOn")}</dt><dd>{date(source.available_on)}</dd></div>
            <div><dt>{t("fund.sources.receipt")}</dt><dd>{source.received ? t("plan.received") : t("plan.notReceived")}</dd></div>
            {allocationBySource.has(source.id) && <div><dt>{t("fund.sources.allocation")}</dt><dd>{money(allocationBySource.get(source.id), source.currency)}</dd></div>}
          </dl>
          <details><summary>{t("fund.sources.details")}</summary><dl>
            <div><dt>{t("fund.sources.certainty")}</dt><dd>{source.certainty || t("plan.notSupplied")}</dd></div>
            <div><dt>{t("fund.sources.opening")}</dt><dd>{source.already_in_opening ? t("fund.sources.included") : t("fund.sources.notIncluded")}</dd></div>
          </dl></details>
        </li>)}</ul> : <p className="comparison-empty">{t("fund.sources.empty")}</p>}
      </div>
      <div className="comparison-panel">
        <h3>{t("fund.plan.title")}</h3>
        {plan ? <>
          <dl className="comparison-facts">
            <div><dt>{t("fund.plan.validation")}</dt><dd>{plan.validation ? explain(plan.validation) : t("plan.notSupplied")}</dd></div>
            <div><dt>{t("fund.plan.gap")}</dt><dd>{money(plan.remaining_gap, homeCurrency)}</dd></div>
            <div><dt>{t("fund.plan.borrowing")}</dt><dd>{money(recommendation?.result.recommended_borrowing_net, homeCurrency)}</dd></div>
            <div><dt>{t("fund.plan.quoteNeeded")}</dt><dd>{recommendation?.result.quote_required ? t("plan.yes") : t("plan.no")}</dd></div>
            <div><dt>{t("fund.plan.final")}</dt><dd>{recommendation?.result.is_recommendation_final ? t("plan.yes") : t("plan.no")}</dd></div>
            <div><dt>{t("fund.plan.affordability")}</dt><dd>{plan.affordability ? explain(plan.affordability) : t("plan.notSupplied")}</dd></div>
          </dl>
          {plan.conditions.length > 0 && <details><summary>{t("fund.plan.conditions")}</summary><ul>{plan.conditions.map((condition, index) => <li key={index}>{explain(condition)}</li>)}</ul></details>}
          {plan.allocations.length > 0 && <details><summary>{t("fund.plan.allocations")}</summary><ul>{plan.allocations.map((allocation, index) => <li key={index}>{allocation.source_id}: {money(allocation.amount, homeCurrency)}</li>)}</ul></details>}
          <details><summary>{t("fund.plan.codes")}</summary><p>{t("fund.plan.codesLine", { validation: plan.validation ?? "", affordability: plan.affordability ?? "" })}</p>{plan.conditions.map((condition, index) => <p key={index}>{condition}</p>)}</details>
          <p className="comparison-note">{t("fund.plan.note")}</p>
          <button className="secondary" disabled={validationDisabled} onClick={onValidatePlan}>{t("fund.plan.check")}</button>
          {savedPlan && <p role="status">{t("fund.plan.saved", { validation: value(savedPlan.result.validation) ? explain(value(savedPlan.result.validation)!) : t("plan.notSupplied"), gap: money(savedPlan.result.remaining_gap, homeCurrency) })}</p>}
        </> : <p className="comparison-empty">{t("fund.plan.empty")}</p>}
      </div>
    </div></details>
    <details className="result-details funding-section"><summary>{t(quotes.length === 1 ? "fund.quotes.summaryOne" : "fund.quotes.summaryMany", { count: quotes.length })}</summary><h3>{t("fund.quotes.title")}</h3>
    <p>{t("fund.quotes.text")}</p>
    {quotes.length ? <div className="comparison-grid quote-grid">{quotes.map((quote) => {
      const result = quote.result;
      const currency = value(result?.currency) ?? value(quote.inputs?.currency) ?? homeCurrency;
      const repayments = Array.isArray(result?.repayments) ? result.repayments : Array.isArray(result?.schedule) ? result.schedule : null;
      const linkedApplication = application && (application.quote_id === quote.id || application.loan === quote.id) ? application : null;
      return <article className="comparison-panel quote-panel" key={quote.id} aria-label={t("fund.quote.aria", { id: quote.id })}>
        <div className="quote-head"><strong>{t("fund.quote.head", { id: quote.id })}</strong><span>{t("fund.quote.simulation")}</span></div>
        <dl className="comparison-facts">
          <div><dt>{t("fund.quote.fees")}</dt><dd>{money(quote.inputs?.fees ?? result?.fees, currency)}</dd></div>
          <div><dt>{t("fund.quote.net")}</dt><dd>{money(result?.net_proceeds, currency)}</dd></div>
          <div><dt>{t("fund.quote.total")}</dt><dd>{money(result?.total_repayment, currency)}</dd></div>
          {linkedApplication && <div><dt>{t("fund.quote.appStatus")}</dt><dd>{explain(linkedApplication.status)}</dd></div>}
        </dl>
        <details><summary>{t("fund.quote.allTerms")}</summary><dl className="comparison-facts">
          <div><dt>{t("fund.quote.principal")}</dt><dd>{money(quote.inputs?.principal ?? result?.principal, currency)}</dd></div>
          <div><dt>{t("fund.quote.rate")}</dt><dd>{value(quote.inputs?.annual_rate) ?? t("plan.notSupplied")}</dd></div>
          <div><dt>{t("fund.quote.months")}</dt><dd>{quote.inputs?.months ?? t("plan.notSupplied")}</dd></div>
          <div><dt>{t("fund.quote.firstDue")}</dt><dd>{date(quote.inputs?.first_due_date)}</dd></div>
          <div><dt>{t("fund.quote.interest")}</dt><dd>{money(result?.total_interest, currency)}</dd></div>
        </dl></details>
        {repayments && <details><summary>{t("fund.quote.schedule")}</summary><ul>{repayments.map((row, index) => {
          const payment = row as Record<string, unknown>;
          return <li key={index}>{date(payment.due_date)} · {money(payment.amount ?? payment.payment, currency)}</li>;
        })}</ul></details>}
        <button className="secondary" onClick={() => onReviewQuote(quote.id)}>{t("fund.quote.review")}</button>
      </article>;
    })}</div> : <p className="comparison-empty">{t("fund.quotes.empty")}</p>}</details>
  </section>;
}
