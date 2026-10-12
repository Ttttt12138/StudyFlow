import { WalletApp } from "./wallet/WalletApp";
import { AgentApp } from "./agent/AgentApp";
import { TrustApp } from "./trust/TrustApp";
import { SimulatedStrip } from "./services/SimulatedStrip";
import { AppBackdrop } from "./services/AppBackdrop";
import { ModuleNavContext, type Module } from "./services/ModuleNav";
import { useI18n } from "./i18n";
import "./student-start.css";
import "./sprint4.css";
import React, { Suspense, lazy, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Confirmation } from './confirmation/Confirmation';
import { loadAdmission } from './confirmation/adapter';
import type { Review, Scenario } from './confirmation/types';
import { Expenses } from './expenses/Expenses';
import { Budget } from './budget/Budget';
import { ConnectedApp, type InitialPreview } from './backend/ConnectedApp';
import type { ExpenseReview } from './expenses/types';
import './styles.css';
import '@fontsource-variable/space-grotesk';
import '@fontsource/chakra-petch/400.css';
import '@fontsource/chakra-petch/500.css';
import '@fontsource/chakra-petch/600.css';
import '@fontsource/jetbrains-mono/400.css';
import './theme.css';
import { AuthApp } from './auth/AuthApp';

const stepKeys = ['demo.step.confirm', 'demo.step.expenses', 'demo.step.budget', 'demo.step.funding', 'demo.step.application'] as const;
function App() {
 const { lang, t } = useI18n();
 const steps = stepKeys.map(key => t(key));
 const [step, setStep] = useState(0);
 const [scenario, setScenario] = useState<Scenario>('complete');
 const [review, setReview] = useState<Review>({ corrections: {}, confirmed: false });
 const [expenseReview, setExpenseReview] = useState<ExpenseReview>({ expenses: [], confirmed: false });
 const admission = loadAdmission(scenario, lang);
 function changeConfirmation(next: Review) { setReview(next); setExpenseReview(previous => ({ ...previous, confirmed: false })); }
 function changeScenario(next: Scenario) { setScenario(next); setReview({ corrections: {}, confirmed: false }); setExpenseReview({ expenses: [], confirmed: false }); setStep(0); }
 return <div className="app"><aside><a className="brand" href="#" onClick={event => { event.preventDefault(); setStep(0); }}><span className="brand-icon">S</span>StudyFlow<span className="brand-dot">.</span></a><div className="journey-label">{t('demo.journeyLabel')}</div><nav aria-label={t('demo.stepsNav')}>{steps.map((name, i) => <button key={stepKeys[i]} aria-current={step === i ? 'step' : undefined} disabled={i > 0 && !review.confirmed || i > 1 && !expenseReview.confirmed} onClick={() => setStep(i)} className={step === i ? 'active' : ''}><span className="step-number">{i === 0 && review.confirmed || i === 1 && expenseReview.confirmed ? '✓' : `0${i + 1}`}</span><span>{name}</span></button>)}</nav><div className="sidebar-note"><span>○</span><strong>{t('demo.sidebarTitle')}</strong><p>{t('demo.sidebarText')}</p></div><div className="draft-label">{t('demo.draftLabel')}</div></aside><div className="workspace"><header><span>{t('demo.headerTitle')} <span className="header-slash">/</span> {steps[step]}</span><span className="avatar" aria-label={t('demo.studentProfile')}>ST</span></header><main><div className="demo-controls"><label htmlFor="scenario">{t('demo.scenario')}</label><select id="scenario" value={scenario} onChange={event => changeScenario(event.target.value as Scenario)}><option value="complete">{t('demo.scenario.complete')}</option><option value="missing">{t('demo.scenario.missing')}</option><option value="conflict">{t('demo.scenario.conflict')}</option></select><span>{t('demo.scenarioReset')}</span></div>{step === 0 ? <Confirmation key={scenario} admission={admission} review={review} onChange={changeConfirmation} onContinue={() => setStep(1)}/> : step === 1 ? <Expenses admission={admission} admissionReview={review} review={expenseReview} onChange={setExpenseReview} onBack={() => setStep(0)} onContinue={() => setStep(2)}/> : step === 2 ? <Budget admission={admission} admissionReview={review} expenseReview={expenseReview} onBack={() => setStep(1)}/> : <><span className="eyebrow">{t('demo.stepOf', { n: `0${step + 1}` })}</span><h1>{steps[step]}</h1><section className="card placeholder"><span className="placeholder-icon">◇</span><h2>{t('demo.placeholderTitle')}</h2><p>{t('demo.placeholderText')}</p><p>{t('demo.placeholderScope')}</p><button className="primary" onClick={() => setStep(1)}>{t('demo.backToExpensesPlain')}</button></section></>}</main><footer>{t('common.footer')}<span>{t('demo.footerNote')}</span></footer></div></div>;
}
type Service = "wallet" | "agent" | "trust";
// ?wallet=1, ?agent=1, ?trust=1 open a signed-in service; =preview opens its read-only synthetic preview.
function serviceFromUrl(): { kind: Service; preview: boolean } | null {
 const query = new URLSearchParams(window.location.search);
 for (const kind of ["wallet", "agent", "trust"] as const) if (query.has(kind)) return { kind, preview: query.get(kind) === "preview" };
 return null;
}
// ?journey=preview&step=budget|funding|calendar opens the five-step tour read-only at that step (linked from /intro).
const journeySteps: Record<string, InitialPreview> = { confirm: { step: 0, calendar: false }, expenses: { step: 1, calendar: false }, budget: { step: 2, calendar: false }, calendar: { step: 2, calendar: true }, funding: { step: 3, calendar: false }, application: { step: 4, calendar: false } };
function journeyFromUrl(): InitialPreview | null {
 const query = new URLSearchParams(window.location.search);
 if (query.get("journey") !== "preview") return null;
 return journeySteps[query.get("step") ?? ""] ?? journeySteps.confirm;
}
function Root() {
 const { t } = useI18n();
 const [connected,setConnected]=useState(true);
 const [initialPreview]=useState(()=>{const preview=journeyFromUrl();if(preview)history.replaceState(null,"",window.location.pathname);return preview;});
 const [service,setService]=useState(serviceFromUrl);
 const [journeyStarted,setJourneyStarted]=useState(()=>serviceFromUrl()===null);
 const open=(kind:Service)=>(preview:boolean)=>{setService({kind,preview});history.replaceState(null,"",`${window.location.pathname}?${kind}=${preview?"preview":"1"}`);};
 const exit=()=>{setJourneyStarted(true);setService(null);history.replaceState(null,"",window.location.pathname);};
 // Service pages switch between modules in place, keeping the session's preview or signed-in mode.
 const moduleNav={current:(service?.kind??"journey") as Module,preview:service?.preview??false,open:(module:Module,preview:boolean)=>{if(module==="journey")exit();else{open(module)(preview);window.scrollTo(0,0);}}};
 // Keep the saved journey mounted while visiting a service so local edits/retry identities survive.
 return <ModuleNavContext.Provider value={moduleNav}><AppBackdrop/><SimulatedStrip/><div hidden={service!==null}>{journeyStarted && (connected?<ConnectedApp initialPreview={initialPreview} onDemo={()=>setConnected(false)} onWallet={open("wallet")} onAgent={open("agent")} onTrust={open("trust")}/>:<><button className="backend-entry" onClick={()=>setConnected(true)}>{t("demo.useSavedPlan")}</button><App/></>)}</div>{service?.kind==="wallet"&&<WalletApp preview={service.preview} onExit={exit}/>}{service?.kind==="agent"&&<AgentApp preview={service.preview} onExit={exit}/>}{service?.kind==="trust"&&<TrustApp preview={service.preview} onExit={exit}/>}</ModuleNavContext.Provider>;
}
// /intro is the product introduction; it loads as its own chunk so the app bundle stays unchanged.
const IntroApp = lazy(() => import('./intro/IntroApp').then(module => ({ default: module.IntroApp })));
const isIntro = /^\/intro\/?$/.test(window.location.pathname);
const isAuth = /^\/auth\/?$/.test(window.location.pathname);
createRoot(document.getElementById('root')!).render(<React.StrictMode>{isIntro ? <Suspense fallback={null}><IntroApp/></Suspense> : isAuth ? <><AppBackdrop/><SimulatedStrip/><AuthApp/></> : <Root/>}</React.StrictMode>);
