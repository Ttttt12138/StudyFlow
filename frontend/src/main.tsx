import { WalletApp } from "./wallet/WalletApp";
import "./student-start.css";
import "./sprint4.css";
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Confirmation } from './confirmation/Confirmation';
import { loadAdmission } from './confirmation/adapter';
import type { Review, Scenario } from './confirmation/types';
import { Expenses } from './expenses/Expenses';
import { Budget } from './budget/Budget';
import { ConnectedApp } from './backend/ConnectedApp';
import type { ExpenseReview } from './expenses/types';
import './styles.css';

const steps = ['Confirm information', 'Complete expenses', 'Budget', 'Funding', 'Simulated application'];
function App() {
 const [step, setStep] = useState(0);
 const [scenario, setScenario] = useState<Scenario>('complete');
 const [review, setReview] = useState<Review>({ corrections: {}, confirmed: false });
 const [expenseReview, setExpenseReview] = useState<ExpenseReview>({ expenses: [], confirmed: false });
 const admission = loadAdmission(scenario);
 function changeConfirmation(next: Review) { setReview(next); setExpenseReview(previous => ({ ...previous, confirmed: false })); }
 function changeScenario(next: Scenario) { setScenario(next); setReview({ corrections: {}, confirmed: false }); setExpenseReview({ expenses: [], confirmed: false }); setStep(0); }
 return <div className="app"><aside><a className="brand" href="#" onClick={event => { event.preventDefault(); setStep(0); }}><span className="brand-icon">S</span>StudyFlow<span className="brand-dot">.</span></a><div className="journey-label">YOUR STUDY PLAN</div><nav aria-label="Study planning steps">{steps.map((name, i) => <button key={name} aria-current={step === i ? 'step' : undefined} disabled={i > 0 && !review.confirmed || i > 1 && !expenseReview.confirmed} onClick={() => setStep(i)} className={step === i ? 'active' : ''}><span className="step-number">{i === 0 && review.confirmed || i === 1 && expenseReview.confirmed ? '✓' : `0${i + 1}`}</span><span>{name}</span></button>)}</nav><div className="sidebar-note"><span>○</span><strong>A clearer path to studying abroad.</strong><p>One step at a time, starting with information you can trust.</p></div><div className="draft-label">FRONTEND DRAFT · MVP</div></aside><div className="workspace"><header><span>Admission planning <span className="header-slash">/</span> {steps[step]}</span><span className="avatar" aria-label="Student profile">ST</span></header><main><div className="demo-controls"><label htmlFor="scenario">Demo scenario</label><select id="scenario" value={scenario} onChange={event => changeScenario(event.target.value as Scenario)}><option value="complete">Complete extraction</option><option value="missing">Missing fee</option><option value="conflict">Conflicting tuition</option></select><span>Changes reset this session’s review.</span></div>{step === 0 ? <Confirmation key={scenario} admission={admission} review={review} onChange={changeConfirmation} onContinue={() => setStep(1)}/> : step === 1 ? <Expenses admission={admission} admissionReview={review} review={expenseReview} onChange={setExpenseReview} onBack={() => setStep(0)} onContinue={() => setStep(2)}/> : step === 2 ? <Budget admission={admission} admissionReview={review} expenseReview={expenseReview} onBack={() => setStep(1)}/> : <><span className="eyebrow">STEP 0{step + 1} / 05</span><h1>{steps[step]}</h1><section className="card placeholder"><span className="placeholder-icon">◇</span><h2>Placeholder · coming next</h2><p>This step is outside the current frontend draft.</p><p>Funding and simulated application are outside this task.</p><button className="primary" onClick={() => setStep(1)}>Back to expenses</button></section></>}</main><footer>StudyFlow · Your admission, thoughtfully organized.<span>Demo session · Changes are not saved</span></footer></div></div>;
}
function Root() {
 const [connected,setConnected]=useState(true);
 const [wallet,setWallet]=useState<null|boolean>(()=>new URLSearchParams(window.location.search).has('wallet') ? new URLSearchParams(window.location.search).get('wallet')==='preview' : null);
 const [journeyStarted,setJourneyStarted]=useState(()=>!new URLSearchParams(window.location.search).has("wallet"));
 // Keep the saved journey mounted while visiting the wallet so local edits/retry identities survive.
 return <><div hidden={wallet!==null}>{journeyStarted && (connected?<ConnectedApp onDemo={()=>setConnected(false)} onWallet={preview=>{setWallet(preview);history.replaceState(null,"",`${window.location.pathname}?wallet=${preview?"preview":"1"}`);}}/>:<><button className="backend-entry" onClick={()=>setConnected(true)}>Use saved student plan</button><App/></>)}</div>{wallet!==null&&<WalletApp preview={wallet} onExit={()=>{setJourneyStarted(true);setWallet(null);history.replaceState(null,'',window.location.pathname);}}/>}</>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Root/></React.StrictMode>);
