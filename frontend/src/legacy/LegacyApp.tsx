import { useState } from 'react';
import { useI18n, type MessageKey } from '../i18n';
import { Confirmation } from '../confirmation/Confirmation';
import { loadAdmission } from '../confirmation/adapter';
import type { Review, Scenario } from '../confirmation/types';
import { Expenses } from '../expenses/Expenses';
import { Budget } from '../budget/Budget';
import { inputVersion, mockBResponse } from '../budget/mockBResponse';
import { Funding } from '../funding/Funding';
import { Application } from '../funding/Application';
import { wholeAmount } from '../funding/logic';
import { mockCResponse } from '../funding/mockCResponse';
import type { ApplicationState, FundingPlan } from '../funding/types';
import type { ExpenseReview } from '../expenses/types';

const stepKeys = ['demo.step.confirm', 'demo.step.expenses', 'demo.step.budget', 'demo.step.funding', 'demo.step.application'] as const;
const newPlan = (): FundingPlan => ({ scenarioId: 'standard', allocations: { family: 0, scholarship: 0, work: 0 }, lenderId: mockCResponse.suggestion.lenderId, confirmed: false });
const newApplication = (): ApplicationState => ({ inputs: { income: '', living: '', other: '' }, consent: false, decision: null });

/**
 * The original fully client-side five-step demo, kept at /?legacy=1 outside the main navigation.
 * No backend and no sign-in; everything comes from the fixed mock responses.
 */
export function LegacyApp() {
 const { lang, t } = useI18n();
 const steps = stepKeys.map(key => t(key));
 const [step, setStep] = useState(0);
 const [scenario, setScenario] = useState<Scenario>('complete');
 const [review, setReview] = useState<Review>({ corrections: {}, confirmed: false });
 const [expenseReview, setExpenseReview] = useState<ExpenseReview>({ expenses: [], confirmed: false });
 const [plan, setPlan] = useState<FundingPlan>(newPlan);
 const [application, setApplication] = useState<ApplicationState>(newApplication);
 const admission = loadAdmission(scenario, lang);
 const chosen = mockBResponse.scenarios.find(item => item.id === plan.scenarioId);
 const gap = wholeAmount(chosen?.fundingGap) ?? 0;
 // Funding builds on the budget's gap, so it stays closed while that budget is out of date.
 const budgetStale = mockBResponse.inputVersion !== inputVersion(admission, review, expenseReview);
 const scenarioName = chosen ? t(`demo.b.${chosen.id === 'standard' ? 'standard' : chosen.id === 'lower' ? 'lower' : 'unknown'}` as MessageKey) : '';
 // Earlier answers invalidate later confirmations, as each step builds on the one before.
 function resetLater() { setPlan(previous => ({ ...previous, confirmed: false })); setApplication(newApplication()); }
 function changeConfirmation(next: Review) { setReview(next); setExpenseReview(previous => ({ ...previous, confirmed: false })); resetLater(); }
 function changeExpenses(next: ExpenseReview) { setExpenseReview(next); resetLater(); }
 function changePlan(next: FundingPlan) { setPlan(next); setApplication(newApplication()); }
 function restart() { changeScenario('complete'); }
 function changeScenario(next: Scenario) { setScenario(next); setReview({ corrections: {}, confirmed: false }); setExpenseReview({ expenses: [], confirmed: false }); setPlan(newPlan()); setApplication(newApplication()); setStep(0); }
 return <div className="app"><aside><a className="brand" href="#" onClick={event => { event.preventDefault(); setStep(0); }}><span className="brand-icon">S</span>StudyFlow<span className="brand-dot">.</span></a><div className="journey-label">{t('demo.journeyLabel')}</div><nav aria-label={t('demo.stepsNav')}>{steps.map((name, i) => <button key={stepKeys[i]} aria-current={step === i ? 'step' : undefined} disabled={i > 0 && !review.confirmed || i > 1 && !expenseReview.confirmed || i > 2 && budgetStale || i > 3 && !plan.confirmed} onClick={() => setStep(i)} className={step === i ? 'active' : ''}><span className="step-number">{i === 0 && review.confirmed || i === 1 && expenseReview.confirmed || i === 2 && plan.confirmed && !budgetStale || i === 3 && plan.confirmed || i === 4 && application.decision ? '✓' : `0${i + 1}`}</span><span>{name}</span></button>)}</nav><div className="sidebar-note"><span>○</span><strong>{t('demo.sidebarTitle')}</strong><p>{t('demo.sidebarText')}</p></div><div className="draft-label">{t('demo.draftLabel')}</div></aside><div className="workspace"><header><span>{t('demo.headerTitle')} <span className="header-slash">/</span> {steps[step]}</span><span className="avatar" aria-label={t('demo.studentProfile')}>ST</span></header><main><div className="demo-controls"><label htmlFor="scenario">{t('demo.scenario')}</label><select id="scenario" value={scenario} onChange={event => changeScenario(event.target.value as Scenario)}><option value="complete">{t('demo.scenario.complete')}</option><option value="missing">{t('demo.scenario.missing')}</option><option value="conflict">{t('demo.scenario.conflict')}</option></select><span>{t('demo.scenarioReset')}</span></div>{step === 0 ? <Confirmation key={scenario} admission={admission} review={review} onChange={changeConfirmation} onContinue={() => setStep(1)}/> : step === 1 ? <Expenses admission={admission} admissionReview={review} review={expenseReview} onChange={changeExpenses} onBack={() => setStep(0)} onContinue={() => setStep(2)}/> : step === 2 ? <Budget admission={admission} admissionReview={review} expenseReview={expenseReview} onBack={() => setStep(1)} selected={plan.scenarioId} onSelect={id => changePlan({ ...plan, scenarioId: id, confirmed: false })} onContinue={() => setStep(3)}/> : step === 3 ? <Funding gap={gap} scenarioName={scenarioName} plan={plan} onChange={changePlan} onBack={() => setStep(2)} onContinue={() => setStep(4)} onFinish={() => setStep(4)}/> : <Application gap={gap} scenarioName={scenarioName} plan={plan} state={application} onChange={setApplication} onBack={() => setStep(3)} onRestart={restart}/>}</main><footer>{t('common.footer')}<span>{t('demo.footerNote')}</span></footer></div></div>;
}
