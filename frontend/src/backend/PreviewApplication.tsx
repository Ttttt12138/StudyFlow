import type { Application, LoanQuote } from "./contracts";
import { explainCode, formatDate, formatMoney } from "./presenters";

function quoteFacts(quote: LoanQuote) {
  const currency = quote.inputs?.currency ?? (typeof quote.result?.currency === "string" ? quote.result.currency : "THB");
  return [
    ["Amount received if disbursed", formatMoney(quote.result?.net_proceeds, currency)],
    ["Fees", formatMoney(quote.inputs?.fees ?? quote.result?.fees, currency)],
    ["Total to repay", formatMoney(quote.result?.total_repayment, currency)],
    ["First repayment", formatDate(quote.inputs?.first_due_date)],
  ];
}

export function PreviewApplication({ application, quotes, selectedQuoteId, onBack }: { application: Application | null; quotes: LoanQuote[]; selectedQuoteId: string; onBack: () => void }) {
  const applicationQuote = quotes.find(quote => quote.id === (application?.quote_id ?? application?.loan));
  const comparisonQuote = quotes.find(quote => quote.id === selectedQuoteId && quote.id !== applicationQuote?.id);
  return <div className="preview-story">
    <section className="card preview-story-hero" aria-labelledby="preview-application-title"><span className="eyebrow">SIMULATED APPLICATION · DEMO</span><h2 id="preview-application-title">{application ? explainCode(application.status) : "No application was returned"}</h2><p>{application?.status === "UNDER_REVIEW" ? "A review is still in progress. This is not an approval, and no money has entered a wallet." : "The status and assessment shown here come from the sample backend response. No money moves in this preview."}</p><div className="preview-application-status"><span>Backend assessment</span><strong>{application?.assessment?.status ? explainCode(application.assessment.status) : "No assessment returned"}</strong></div><button className="primary" onClick={onBack}>Back to funding options <span aria-hidden="true">→</span></button></section>
    <section className="card preview-story-panel" aria-labelledby="preview-application-quote"><span className="eyebrow">QUOTE ON THIS APPLICATION</span><h2 id="preview-application-quote">Review the terms</h2>{applicationQuote ? <><p>These values belong to the quote linked to the sample application. They are not an approval or a payment.</p><dl className="preview-quote-facts">{quoteFacts(applicationQuote).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><details><summary>See repayment dates supplied in this demo</summary>{Array.isArray(applicationQuote.result?.repayments) ? <><p>This mock quote includes only the dates shown below. A full schedule must come from B.</p><ul>{applicationQuote.result.repayments.map((row, index) => { const payment = row as Record<string, unknown>; return <li key={index}>{formatDate(payment.due_date)} · {formatMoney(payment.amount ?? payment.payment, applicationQuote.inputs?.currency ?? "THB")}</li>; })}</ul></> : <p>No repayment dates were returned.</p>}</details></> : <p>The sample application does not link to a quote available in this preview.</p>}</section>
    {comparisonQuote && <section className="card preview-story-panel preview-comparison-note" aria-labelledby="preview-other-quote"><span className="eyebrow">OPENED FROM FUNDING</span><h2 id="preview-other-quote">A different quote is selected</h2><p>You opened a separate quote for comparison. The application above still refers to its original quote. Reviewing another quote does not change or submit an application.</p><strong>{formatMoney(comparisonQuote.result?.net_proceeds, comparisonQuote.inputs?.currency ?? "THB")} net proceeds · {formatMoney(comparisonQuote.result?.total_repayment, comparisonQuote.inputs?.currency ?? "THB")} total repayment</strong></section>}
  </div>;
}
