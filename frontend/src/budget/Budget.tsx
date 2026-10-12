import type { Admission, Review } from '../confirmation/types';
import { documentedExpenses } from '../expenses/adapter';
import type { ExpenseReview } from '../expenses/types';
import { useI18n, type MessageKey } from '../i18n';
import { inputVersion, mockBResponse } from './mockBResponse';
// The mock B response is English fixture data; known phrases are shown in the interface language.
const bText: Record<string, MessageKey> = {
 'Standard arrival': 'demo.b.standard', 'Lower living estimate': 'demo.b.lower', 'Unpriced arrival': 'demo.b.unknown',
 'One academic term': 'demo.b.oneTerm', 'Sample family funds supplied to B': 'demo.b.familyFunds',
 'Housing and living costs are illustrative estimates': 'demo.b.illustrative', 'Lower illustrative living estimate': 'demo.b.lowerLiving',
 'Insurance remains unknown': 'demo.b.insuranceUnknown', 'Tuition and school fees': 'demo.b.tuitionFees',
 'Housing and daily expenses': 'demo.b.housingDaily', 'Insurance': 'demo.b.insurance',
};
export function Budget({ admission, admissionReview, expenseReview, onBack }: { admission: Admission; admissionReview: Review; expenseReview: ExpenseReview; onBack: () => void }) {
 const { lang, t } = useI18n();
 const b = (text: string) => bText[text] ? t(bText[text]) : text;
 const word = (prefix: 'status' | 'recurrence' | 'origin' | 'calc', value: string) => t(`demo.${prefix}.${value}` as MessageKey);
 const stale = mockBResponse.inputVersion !== inputVersion(admission, admissionReview, expenseReview);
 const inputLines = [...documentedExpenses(admission, admissionReview, lang), ...expenseReview.expenses];
 const missing = inputLines.some(e => e.status === 'missing');
 return <><div className="section-heading"><div><span className="eyebrow">{t('demo.stepOf', { n: '03' })}</span><h1>{t('demo.budget.title')}</h1><p>{t('demo.budget.lead')}</p></div><span className="tag">{t('demo.budget.tag')}</span></div>
 <div className="demo"><strong>{t('demo.budget.demoTitle')}</strong><span>{t('demo.budget.demoText')}</span></div>
 {stale && <div className="stale-banner" role="status"><strong>{t('demo.budget.staleTitle')}</strong><span>{t('demo.budget.staleText')}</span><button disabled title={t('demo.budget.notConnected')}>{t('demo.budget.recalculate')}</button></div>}
 {missing && <div className="incomplete-banner" role="status"><strong>{t('demo.budget.incompleteTitle')}</strong><span>{t('demo.budget.incompleteText')}</span></div>}
 <section className="card budget-inputs"><div className="card-heading"><div><h2>{t('demo.budget.inputs')}</h2><p>{t('demo.budget.inputsText')}</p></div></div><div className="budget-input-list">{inputLines.map(e => <div className="budget-input-row" key={e.id}><div><strong>{e.label || t('demo.budget.unnamed')}</strong><small>{word('origin', e.origin)} · {e.recurrence === 'once' ? e.dueDate || t('demo.budget.dateUnknown') : word('recurrence', e.recurrence)}</small></div><span className={`status ${e.status}`}>{word('status', e.status)}</span><strong>{e.status === 'missing' ? t('demo.budget.amountUnknown') : `${e.currency} ${e.amount}`}</strong></div>)}</div></section>
 <div className="budget-title"><h2>{t('demo.budget.scenarios')}</h2><span>{stale ? t('demo.budget.versionDiffers') : t('demo.budget.versionMatches')}</span></div><div className={`scenario-grid ${stale ? 'stale' : ''}`}>{mockBResponse.scenarios.map(result => <article className="scenario-card" key={result.id}><div className="scenario-head"><span className="eyebrow">{t('demo.budget.scenarioEyebrow')}</span><h3>{b(result.name)}</h3><span className="scenario-currency">{result.currency}</span></div><div className="scenario-status"><span>{stale ? t('demo.budget.staleResult') : missing || result.completenessStatus === 'incomplete' ? t('demo.budget.incomplete') : t('demo.budget.complete')}</span><span>{t('demo.budget.calculation', { status: word('calc', result.calculationStatus) })}</span></div><div className="scenario-values"><div><span>{t('demo.budget.reportedCosts')}</span><strong>{result.reportedCosts === null ? t('demo.notSupplied') : `${result.currency} ${result.reportedCosts}`}</strong></div><div><span>{t('demo.budget.availableFunds')}</span><strong>{result.availableFunds === null ? t('demo.notSupplied') : `${result.currency} ${result.availableFunds}`}</strong></div><div><span>{t('demo.budget.remainingOrGap')}</span><strong>{result.remainingBalance !== null ? t('demo.budget.remaining', { amount: `${result.currency} ${result.remainingBalance}` }) : result.fundingGap !== null ? t('demo.budget.gap', { amount: `${result.currency} ${result.fundingGap}` }) : t('demo.budget.notReported')}</strong></div></div><div className="scenario-sub"><strong>{t('demo.budget.reportedByB')}</strong>{result.lines.map(line => <div key={line.label}><span>{b(line.label)} <em className={`status ${line.status}`}>{word('status', line.status)}</em></span><span>{line.value === null ? t('demo.missingValue') : `${line.currency} ${line.value}`}</span></div>)}</div><div className="scenario-sub assumptions"><strong>{t('demo.budget.assumptions')}</strong><ul>{result.assumptions.map(item => <li key={item}>{b(item)}</li>)}</ul></div></article>)}</div><div className="budget-actions"><button type="button" className="secondary" onClick={onBack}>{t('demo.budget.back')}</button><span>{t('demo.budget.fundingPlaceholder')}</span></div></>;
}
