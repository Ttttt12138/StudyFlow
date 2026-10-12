import { translate, useI18n, type Lang } from "../i18n";
import type { Application, LoanQuote } from "./contracts";
import { explainCode, formatDate, formatMoney } from "./presenters";

function quoteFacts(quote: LoanQuote, lang: Lang) {
  const currency = quote.inputs?.currency ?? (typeof quote.result?.currency === "string" ? quote.result.currency : "THB");
  return [
    [translate(lang, "pv.app.received"), formatMoney(quote.result?.net_proceeds, currency, lang)],
    [translate(lang, "fund.quote.fees"), formatMoney(quote.inputs?.fees ?? quote.result?.fees, currency, lang)],
    [translate(lang, "pv.app.totalRepay"), formatMoney(quote.result?.total_repayment, currency, lang)],
    [translate(lang, "pv.app.firstRepayment"), formatDate(quote.inputs?.first_due_date, lang)],
  ];
}

export function PreviewApplication({ application, quotes, selectedQuoteId, onBack }: { application: Application | null; quotes: LoanQuote[]; selectedQuoteId: string; onBack: () => void }) {
  const { lang, t } = useI18n();
  const applicationQuote = quotes.find(quote => quote.id === (application?.quote_id ?? application?.loan));
  const comparisonQuote = quotes.find(quote => quote.id === selectedQuoteId && quote.id !== applicationQuote?.id);
  return <div className="preview-story">
    <section className="card preview-story-hero" aria-labelledby="preview-application-title"><span className="eyebrow">{t("pv.app.eyebrow")}</span><h2 id="preview-application-title">{application ? explainCode(application.status, lang) : t("pv.app.none")}</h2><p>{application?.status === "UNDER_REVIEW" ? t("pv.app.underReview") : t("pv.app.sample")}</p><div className="preview-application-status"><span>{t("pv.app.assessment")}</span><strong>{application?.assessment?.status ? explainCode(application.assessment.status, lang) : t("pv.app.noAssessment")}</strong></div><button className="primary" onClick={onBack}>{t("pv.app.back")} <span aria-hidden="true">→</span></button></section>
    <section className="card preview-story-panel" aria-labelledby="preview-application-quote"><span className="eyebrow">{t("pv.app.quoteEyebrow")}</span><h2 id="preview-application-quote">{t("pv.app.quoteTitle")}</h2>{applicationQuote ? <><p>{t("pv.app.quoteText")}</p><dl className="preview-quote-facts">{quoteFacts(applicationQuote, lang).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><details><summary>{t("pv.app.datesSummary")}</summary>{Array.isArray(applicationQuote.result?.repayments) ? <><p>{t("pv.app.datesText")}</p><ul>{applicationQuote.result.repayments.map((row, index) => { const payment = row as Record<string, unknown>; return <li key={index}>{formatDate(payment.due_date, lang)} · {formatMoney(payment.amount ?? payment.payment, applicationQuote.inputs?.currency ?? "THB", lang)}</li>; })}</ul></> : <p>{t("pv.app.noDates")}</p>}</details></> : <p>{t("pv.app.noQuote")}</p>}</section>
    {comparisonQuote && <section className="card preview-story-panel preview-comparison-note" aria-labelledby="preview-other-quote"><span className="eyebrow">{t("pv.app.otherEyebrow")}</span><h2 id="preview-other-quote">{t("pv.app.otherTitle")}</h2><p>{t("pv.app.otherText")}</p><strong>{t("pv.app.compareLine", { net: formatMoney(comparisonQuote.result?.net_proceeds, comparisonQuote.inputs?.currency ?? "THB", lang), total: formatMoney(comparisonQuote.result?.total_repayment, comparisonQuote.inputs?.currency ?? "THB", lang) })}</strong></section>}
  </div>;
}
