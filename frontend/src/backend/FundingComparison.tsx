import type { Application, FundingResult, FundingSource, LoanQuote, Run } from "./contracts";
import { explainCode, formatDate as date, formatMoney as money } from "./presenters";

type Props = {
  recommendation: Run<FundingResult> | null;
  current: boolean;
  sources: FundingSource[];
  quotes: LoanQuote[];
  application: Application | null;
  onReviewQuote: (id: string) => void;
  onValidatePlan: () => void;
  validationDisabled: boolean;
  savedPlanCurrent: boolean;
  savedPlan: Run<Record<string, unknown>> | null;
};

function value(input: unknown): string | null {
  return typeof input === "string" && input.trim() ? input : null;
}

export function FundingComparison({ recommendation, current, sources, quotes, application, onReviewQuote, onValidatePlan, validationDisabled, savedPlan, savedPlanCurrent }: Props) {
  const plan = recommendation?.result.nonloan_plan;
  const allocationBySource = new Map(plan?.allocations.map((item) => [item.source_id, item.amount]) ?? []);
  return <section className="card backend-section funding-comparison" aria-labelledby="funding-comparison-title">
    <h2 id="funding-comparison-title">Compare funding and loan options</h2>
    <p>These are separate backend responses. A source is not received cash until marked received; a loan quote is not an approval or disbursement.</p>
    {recommendation && !current && <div className="stale-banner" role="status"><strong>Recommendation needs updating</strong><span>Your planning data changed. Request a new funding recommendation before relying on the plan below.</span></div>}
    <div className="comparison-grid">
      <div className="comparison-panel">
        <h3>Funding sources</h3>
        <p>Dates and amounts reported for each source. B’s suggested allocations appear only when a recommendation is available.</p>
        {sources.length ? <ul className="comparison-list">{sources.map((source) => <li key={source.id}>
          <strong>{source.kind.replaceAll("_", " ")}</strong>
          <dl>
            <div><dt>Reported amount</dt><dd>{money(source.amount, source.currency)}</dd></div>
            <div><dt>Available on</dt><dd>{date(source.available_on)}</dd></div>
            <div><dt>Receipt</dt><dd>{source.received ? "Received" : "Not received"}</dd></div>
            {allocationBySource.has(source.id) && <div><dt>B suggested allocation</dt><dd>{money(allocationBySource.get(source.id), source.currency)}</dd></div>}
          </dl>
          <details><summary>Source details</summary><dl>
            <div><dt>Certainty</dt><dd>{source.certainty || "Not supplied"}</dd></div>
            <div><dt>Opening balance</dt><dd>{source.already_in_opening ? "Already included" : "Not included"}</dd></div>
          </dl></details>
        </li>)}</ul> : <p className="comparison-empty">No funding sources returned by B.</p>}
      </div>
      <div className="comparison-panel">
        <h3>Suggested non-loan plan</h3>
        {plan ? <>
          <dl className="comparison-facts">
            <div><dt>Validation</dt><dd>{plan.validation ? explainCode(plan.validation) : "Not supplied"}</dd></div>
            <div><dt>Remaining gap</dt><dd>{money(plan.remaining_gap, "THB")}</dd></div>
            <div><dt>Suggested net borrowing</dt><dd>{money(recommendation?.result.recommended_borrowing_net, "THB")}</dd></div>
            <div><dt>Quote needed</dt><dd>{recommendation?.result.quote_required ? "Yes" : "No"}</dd></div>
            <div><dt>Recommendation final</dt><dd>{recommendation?.result.is_recommendation_final ? "Yes" : "No"}</dd></div>
            <div><dt>Affordability response</dt><dd>{plan.affordability ? explainCode(plan.affordability) : "Not supplied"}</dd></div>
          </dl>
          {plan.conditions.length > 0 && <details><summary>Conditions to review</summary><ul>{plan.conditions.map((condition, index) => <li key={index}>{explainCode(condition)}</li>)}</ul></details>}
          {plan.allocations.length > 0 && <details><summary>Suggested allocations from B</summary><ul>{plan.allocations.map((allocation, index) => <li key={index}>{allocation.source_id}: {money(allocation.amount, "THB")}</li>)}</ul></details>}
          <details><summary>Backend codes</summary><p>Validation: {plan.validation} · Affordability: {plan.affordability}</p>{plan.conditions.map((condition, index) => <p key={index}>{condition}</p>)}</details>
          <p className="comparison-note">B’s validation and conditions determine whether this plan is ready. Amounts here are displayed exactly as returned.</p>
          <button className="secondary" disabled={validationDisabled} onClick={onValidatePlan}>Check suggested funding plan</button>
          {savedPlan && !savedPlanCurrent && <p className="stale-banner" role="status">Saved plan needs updating. This validation belongs to earlier inputs.</p>}
          {savedPlan && <p role="status">Saved validation: {value(savedPlan.result.validation) ? explainCode(value(savedPlan.result.validation)!) : "Not supplied"} · Remaining gap: {money(savedPlan.result.remaining_gap, "THB")}</p>}
        </> : <p className="comparison-empty">Request a funding recommendation to see B’s proposed combination and remaining gap.</p>}
      </div>
    </div>
    <h3>Simulated loan quotes</h3>
    <p>Compare the terms B returned for each quote. This screen does not rank quotes or decide whether repayments are affordable.</p>
    {quotes.length ? <div className="comparison-grid quote-grid">{quotes.map((quote) => {
      const result = quote.result;
      const currency = value(result?.currency) ?? value(quote.inputs?.currency) ?? "THB";
      const repayments = Array.isArray(result?.repayments) ? result.repayments : Array.isArray(result?.schedule) ? result.schedule : null;
      const linkedApplication = application && (application.quote_id === quote.id || application.loan === quote.id) ? application : null;
      return <article className="comparison-panel quote-panel" key={quote.id} aria-label={`Loan quote ${quote.id}`}>
        <div className="quote-head"><strong>Quote {quote.id}</strong><span>Simulation</span></div>
        <dl className="comparison-facts">
          <div><dt>Fees</dt><dd>{money(quote.inputs?.fees ?? result?.fees, currency)}</dd></div>
          <div><dt>Net proceeds</dt><dd>{money(result?.net_proceeds, currency)}</dd></div>
          <div><dt>Total repayment</dt><dd>{money(result?.total_repayment, currency)}</dd></div>
          {linkedApplication && <div><dt>Application status</dt><dd>{explainCode(linkedApplication.status)}</dd></div>}
        </dl>
        <details><summary>All quote terms</summary><dl className="comparison-facts">
          <div><dt>Principal</dt><dd>{money(quote.inputs?.principal ?? result?.principal, currency)}</dd></div>
          <div><dt>Annual rate fraction</dt><dd>{value(quote.inputs?.annual_rate) ?? "Not supplied"}</dd></div>
          <div><dt>Repayment months</dt><dd>{quote.inputs?.months ?? "Not supplied"}</dd></div>
          <div><dt>First due date</dt><dd>{date(quote.inputs?.first_due_date)}</dd></div>
          <div><dt>Total interest</dt><dd>{money(result?.total_interest, currency)}</dd></div>
        </dl></details>
        {repayments && <details><summary>View B’s repayment schedule</summary><ul>{repayments.map((row, index) => {
          const payment = row as Record<string, unknown>;
          return <li key={index}>{date(payment.due_date)} · {money(payment.amount ?? payment.payment, currency)}</li>;
        })}</ul></details>}
        <button className="secondary" onClick={() => onReviewQuote(quote.id)}>Review this quote</button>
      </article>;
    })}</div> : <p className="comparison-empty">No loan quotes returned by B. Create a quote in Simulated application to compare its terms here.</p>}
  </section>;
}
