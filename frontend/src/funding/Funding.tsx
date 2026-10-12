import { useI18n, type MessageKey } from '../i18n';
import { money, summarize } from './logic';
import { mockCResponse } from './mockCResponse';
import type { FundingPlan } from './types';
import './funding.css';


/** Offline demo step 4: cover the budget gap with on-time money first, then a compared loan quote. */
export function Funding({ gap, scenarioName, plan, onChange, onBack, onContinue, onFinish }: {
 gap: number; scenarioName: string; plan: FundingPlan; onChange: (plan: FundingPlan) => void;
 onBack: () => void; onContinue: () => void; onFinish: () => void;
}) {
 const { t } = useI18n();
 const response = mockCResponse, c = response.currency;
 const summary = summarize(gap, plan, response);
 const edit = (next: Partial<FundingPlan>) => onChange({ ...plan, ...next, confirmed: false });
 const setAmount = (id: keyof FundingPlan['allocations'], value: string) => {
  const amount = /^\d*$/.test(value) ? Number(value || 0) : plan.allocations[id];
  edit({ allocations: { ...plan.allocations, [id]: amount } });
 };
 const uncertain = response.sources.filter(source => !source.late && (plan.allocations[source.id] ?? 0) > 0 && source.certainty !== 'estimated');
 return <>
 <div className="section-heading"><div><span className="eyebrow">{t('demo.stepOf', { n: '04' })}</span><h1>{t('flow.funding.title')}</h1><p>{t('flow.funding.lead')}</p></div><span className="tag">{t('flow.funding.tag')}</span></div>
 <div className="demo"><strong>{t('demo.demoData')}</strong><span>{t('flow.funding.demoText')}</span></div>

 <section className="card flow-card funding-gap" aria-labelledby="flow-gap-title"><div className="card-heading"><div><h2 id="flow-gap-title">{t('flow.funding.gapTitle')}</h2><p>{t('flow.funding.gapText', { scenario: scenarioName, date: response.dueDate })}</p></div><strong className="flow-gap-amount">{money(c, gap)}</strong></div></section>

 <section className="card flow-card" aria-labelledby="flow-sources-title"><div className="card-heading"><div><h2 id="flow-sources-title">{t('flow.sources.title')}</h2><p>{t('flow.sources.text')}</p></div>
  <button type="button" className="secondary" onClick={() => edit({ allocations: { ...response.suggestion.allocations }, lenderId: response.suggestion.lenderId })}>{t('flow.sources.useSuggestion')}</button></div>
  <div className="flow-sources">{response.sources.map(source => <div className="flow-source" key={source.id}>
   <div><strong>{t(`flow.source.${source.id}` as MessageKey)}</strong>
    <small>{t(`flow.certainty.${source.certainty}` as MessageKey)} · {t('flow.sources.upTo', { amount: money(c, source.max), date: source.availableOn })}</small>
    {source.late && <small className="flow-warn">{t('flow.sources.late', { date: response.dueDate })}</small>}</div>
   <label>{t('flow.sources.amount', { currency: c })}<input inputMode="numeric" aria-label={t('flow.sources.amountFor', { source: t(`flow.source.${source.id}` as MessageKey) })} value={String(plan.allocations[source.id] ?? 0)} onChange={event => setAmount(source.id, event.target.value)}/></label>
   {summary.overMax.includes(source.id) && <small className="error">{t('flow.sources.overMax', { amount: money(c, source.max) })}</small>}
  </div>)}</div>
 </section>

 <section className="card flow-card" aria-labelledby="flow-quotes-title"><div className="card-heading"><div><h2 id="flow-quotes-title">{t('flow.quotes.title')}</h2><p>{summary.loanNeeded > 0 ? t('flow.quotes.text', { amount: money(c, summary.loanNeeded) }) : t('flow.quotes.none')}</p></div></div>
  {summary.loanNeeded > 0 && <div className="flow-quotes" role="radiogroup" aria-label={t('flow.quotes.title')}>{response.lenders.map(lender => {
   const row = lender.rows.find(item => item.principal >= summary.loanNeeded);
   return <label key={lender.id} className={`flow-quote ${plan.lenderId === lender.id ? 'selected' : ''}`}>
    <input type="radio" name="flow-lender" value={lender.id} checked={plan.lenderId === lender.id} disabled={!row} onChange={() => edit({ lenderId: lender.id })}/>
    <span><strong>{lender.lender}</strong><small>{t('flow.quotes.terms', { rate: lender.annualRate, months: lender.months })}</small></span>
    {row ? <dl><div><dt>{t('flow.quotes.principal')}</dt><dd>{money(c, row.principal)}</dd></div><div><dt>{t('flow.quotes.monthly')}</dt><dd>{money(c, row.monthly)}</dd></div><div><dt>{t('flow.quotes.fees')}</dt><dd>{money(c, row.fees)}</dd></div><div><dt>{t('flow.quotes.totalCost')}</dt><dd>{money(c, row.totalCost)}</dd></div></dl> : <small className="error">{t('flow.quotes.tooLarge')}</small>}
   </label>;
  })}</div>}
  {summary.loanNeeded > 0 && <p className="flow-note">{t('flow.quotes.tier')}</p>}
 </section>

 <section className="card flow-card" aria-labelledby="flow-plan-title"><div className="card-heading"><div><h2 id="flow-plan-title">{t('flow.plan.title')}</h2></div></div>
  <dl className="flow-plan">
   <div><dt>{t('flow.plan.gap')}</dt><dd>{money(c, gap)}</dd></div>
   <div><dt>{t('flow.plan.onTime')}</dt><dd>{money(c, summary.onTime)}</dd></div>
   {summary.lateAmount > 0 && <div><dt>{t('flow.plan.late')}</dt><dd>{money(c, summary.lateAmount)}</dd></div>}
   <div><dt>{t('flow.plan.loan')}</dt><dd>{summary.row ? t('flow.plan.loanValue', { amount: money(c, summary.row.principal), lender: summary.lender.lender }) : summary.loanNeeded > 0 ? t('flow.plan.loanMissing') : t('flow.plan.noLoan')}</dd></div>
  </dl>
  <div className="confirmation"><div className="readiness" role="status">{summary.covered ? (summary.row ? t('flow.plan.coveredWithLoan') : t('flow.plan.coveredNoLoan')) : t('flow.plan.notCovered')}</div>
  {uncertain.length > 0 && <p className="flow-warn">{t('flow.plan.uncertain', { sources: uncertain.map(source => t(`flow.source.${source.id}` as MessageKey)).join(', ') })}</p>}
  <label className="check"><input type="checkbox" disabled={!summary.covered} checked={plan.confirmed} onChange={event => onChange({ ...plan, confirmed: event.target.checked })}/><span>{t('flow.plan.check')}<small>{t('flow.plan.checkNote')}</small></span></label></div>
  <div className="card-footer"><button type="button" className="secondary" onClick={onBack}>{t('flow.funding.back')}</button>
   {summary.row
    ? <button type="button" className="primary" disabled={!summary.covered || !plan.confirmed} onClick={onContinue}>{t('flow.funding.continue')}</button>
    : <button type="button" className="primary" disabled={!summary.covered || !plan.confirmed} onClick={onFinish}>{t('flow.funding.finish')}</button>}</div>
 </section>
 </>;
}
