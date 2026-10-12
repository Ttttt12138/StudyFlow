import { useI18n, type MessageKey } from '../i18n';
import { assess, money, summarize } from './logic';
import { mockCResponse } from './mockCResponse';
import type { ApplicationState, FundingPlan } from './types';
import './funding.css';


/** Offline demo step 5: a simulated loan application for the planned quote, then the journey summary. */
export function Application({ gap, scenarioName, plan, state, onChange, onBack, onRestart }: {
 gap: number; scenarioName: string; plan: FundingPlan; state: ApplicationState;
 onChange: (state: ApplicationState) => void; onBack: () => void; onRestart: () => void;
}) {
 const { t } = useI18n();
 const c = mockCResponse.currency;
 const summary = summarize(gap, plan, mockCResponse);
 const row = summary.row;
 const setInput = (key: keyof ApplicationState['inputs'], value: string) => {
  if (/^\d*$/.test(value)) onChange({ ...state, inputs: { ...state.inputs, [key]: value }, decision: null });
 };
 const result = row && state.decision ? assess(state.inputs, row) : null;
 const steps = [
  t('flow.summary.confirmed'), t('flow.summary.expenses'), t('flow.summary.budget', { scenario: scenarioName, amount: money(c, gap) }),
  t('flow.summary.funding', { amount: money(c, summary.onTime) }) + (row ? ` ${t('flow.summary.loan', { amount: money(c, row.principal), lender: summary.lender.lender })}` : ''),
 ];
 return <>
 <div className="section-heading"><div><span className="eyebrow">{t('demo.stepOf', { n: '05' })}</span><h1>{t('flow.app.title')}</h1><p>{row ? t('flow.app.lead') : t('flow.app.leadNoLoan')}</p></div><span className="tag">{t('flow.app.tag')}</span></div>
 <div className="demo"><strong>{t('demo.demoData')}</strong><span>{t('flow.app.demoText')}</span></div>

 {row && <section className="card flow-card" aria-labelledby="flow-app-quote"><div className="card-heading"><div><h2 id="flow-app-quote">{t('flow.app.quoteTitle', { lender: summary.lender.lender })}</h2><p>{t('flow.quotes.terms', { rate: summary.lender.annualRate, months: summary.lender.months })}</p></div></div>
  <dl className="flow-plan"><div><dt>{t('flow.quotes.principal')}</dt><dd>{money(c, row.principal)}</dd></div><div><dt>{t('flow.quotes.monthly')}</dt><dd>{money(c, row.monthly)}</dd></div><div><dt>{t('flow.quotes.fees')}</dt><dd>{money(c, row.fees)}</dd></div><div><dt>{t('flow.app.totalRepayment')}</dt><dd>{money(c, row.totalRepayment)}</dd></div></dl>
 </section>}

 {row && <section className="card flow-card" aria-labelledby="flow-app-afford"><div className="card-heading"><div><h2 id="flow-app-afford">{t('flow.app.affordTitle')}</h2><p>{t('flow.app.affordText')}</p></div></div>
  <div className="flow-inputs">{(['income', 'living', 'other'] as const).map(key => <label key={key}>{t(`flow.app.${key}` as MessageKey, { currency: c })}<input inputMode="numeric" value={state.inputs[key]} onChange={event => setInput(key, event.target.value)}/></label>)}</div>
  <div className="confirmation"><label className="check"><input type="checkbox" checked={state.consent} onChange={event => onChange({ ...state, consent: event.target.checked, decision: null })}/><span>{t('flow.app.consent')}<small>{t('flow.app.consentNote')}</small></span></label></div>
  <div className="card-footer"><button type="button" className="secondary" onClick={onBack}>{t('flow.app.back')}</button><button type="button" className="primary" disabled={!state.consent} onClick={() => onChange({ ...state, decision: assess(state.inputs, row).decision })}>{t('flow.app.submit')}</button></div>
 </section>}

 {result && <section className={`card flow-card flow-decision decision-${result.decision.toLowerCase()}`} aria-labelledby="flow-app-decision" role="status">
  <div className="card-heading"><div><span className="eyebrow">{t('flow.app.decisionEyebrow')}</span><h2 id="flow-app-decision">{t(`flow.decision.${result.decision}` as MessageKey)}</h2>
   <p>{t(`flow.decision.${result.decision}.text` as MessageKey, { monthly: money(c, row!.monthly), disposable: result.disposable === null ? '—' : money(c, result.disposable) })}</p></div></div>
  <p className="flow-note">{t('flow.app.rule')}</p>
 </section>}

 {(!row || result) && <section className="card flow-card flow-summary" aria-labelledby="flow-summary-title"><div className="card-heading"><div><h2 id="flow-summary-title">{t('flow.summary.title')}</h2><p>{t('flow.summary.text')}</p></div></div>
  <ol>{steps.map(text => <li key={text}>{text}</li>)}{result && <li>{t(`flow.summary.decision.${result.decision}` as MessageKey)}</li>}</ol>
  <p className="flow-note">{t('flow.summary.next')}</p>
  <div className="card-footer">{!row && <button type="button" className="secondary" onClick={onBack}>{t('flow.app.back')}</button>}<button type="button" className="primary" onClick={onRestart}>{t('flow.summary.restart')}</button></div>
 </section>}
 </>;
}
