import { useEffect, useState } from 'react';
import { ApiError, DjangoClient } from '../backend/client';
import type { BackendState } from '../backend/contracts';
import { explainCode, formatDate, formatMoney } from '../backend/presenters';
import type { Briefing, Calendar, Notifications, Reviews, Versions } from './types';
type Data = { state: BackendState; briefing: Briefing; calendar: Calendar; notifications: Notifications; reviews: Reviews['data'] };
type Result<T> = {data?: T; error?: string; loading: boolean; auth?: boolean; noSemester?: boolean};
type Results = {[K in keyof Data]: Result<Data[K]>};
const paths = {state:'readiness/state/',briefing:'readiness/briefing/',calendar:'readiness/calendar/',notifications:'readiness/notifications/',reviews:'review-queue/'};
const initial = (): Results => ({state:{loading:true},briefing:{loading:true},calendar:{loading:true},notifications:{loading:true},reviews:{loading:true}});
function matches(a: Versions,b: BackendState) {return a.state_version===b.state_version&&a.budget_version===b.budget_version&&(b.analysis_version==null||a.analysis_version===b.analysis_version);}
function stepFor(kind: string): number|null {
 if(/material|document|profile|protected_cost|conflict/i.test(kind)) return 0;
 if(/missing|expense|spending|data_stale/i.test(kind)) return 1;
 if(/funding|sponsor/i.test(kind)) return 3;
 if(/loan|application|repayment/i.test(kind)) return 4;
 if(/gap|budget|obligation/i.test(kind)) return 2;
 return null;
}
export function LiveDashboard({api,dirty,onJourney}: {api:DjangoClient;dirty:boolean;onJourney:(step:number)=>void}) {
 const [results,setResults]=useState<Results>(initial),[reload,setReload]=useState(0);
 useEffect(()=>{
  let active=true; setResults(initial());
  (Object.keys(paths) as Array<keyof Data>).forEach(key=>{
   const promise=key==='notifications'?api.rawGet<Data[typeof key]>(paths[key]):api.get<Data[typeof key]>(paths[key]);
   promise.then(data=>{if(active)setResults(old=>({...old,[key]:{data,loading:false}}));}).catch((error:unknown)=>{
    const auth=error instanceof ApiError&&[401,403].includes(error.status);
    const noSemester=error instanceof ApiError&&error.status===400&&JSON.stringify(error.details).includes('NO_ACTIVE_SEMESTER');
    if(active)setResults(old=>({...old,[key]:{loading:false,auth,noSemester,error:error instanceof Error?error.message:'Request failed'}}));
   });
  });return()=>{active=false;};
 },[api,reload]);
 const refresh=()=>setReload(x=>x+1);
 const state=results.state.data,briefing=results.briefing.data,calendar=results.calendar.data,notifications=results.notifications.data,reviews=results.reviews.data;
 const stale=dirty||!!briefing&&!!calendar&&briefing.as_of!==calendar.as_of||!!state&&[briefing,calendar].some(r=>r&&!matches(r,state));
 function feedback(key:keyof Data) {const r=results[key];return r.loading?<p role="status">Loading {key}…</p>:r.noSemester?<p>Create a semester to see this information.</p>:r.error?<div role="alert"><p>Could not load {key}.</p><details><summary>View backend response</summary><pre className="backend-json">{r.error}</pre></details><button className="secondary" onClick={refresh}>Retry {key}</button></div>:null;}
 function link(kind:string) {const step=stepFor(kind);return step===null?<small>Read-only status · this service screen is not connected yet.</small>:<button className="dashboard-link" onClick={()=>onJourney(step)}>Review in study plan →</button>;}
 function versions(row:Versions&{as_of:string}) {return <small>As of {formatDate(row.as_of)} · State {row.state_version} · Budget {row.budget_version} · Analysis {row.analysis_version}</small>;}
 return <div className="dashboard-app"><div className="section-heading"><div><span className="eyebrow">YOUR STUDENT HOME</span><h1>Dashboard</h1><p>Your saved plan, dates and updates from StudyFlow.</p></div><button className="secondary" onClick={refresh}>Refresh dashboard</button></div>
 {Object.values(results).some(r=>r.auth)?<section className="card" role="alert"><h2>Sign in again</h2><p>Your account could not be authenticated.</p><a className="primary" href={`/api/auth/login/?next=${encodeURIComponent(window.location.origin+'/')}`}>Sign in to StudyFlow</a></section>:<>
 {results.state.noSemester&&<section className="card" role="status"><h2>Start your semester</h2><p>No active semester was returned.</p><button className="primary" onClick={()=>onJourney(0)}>Create a semester</button></section>}
 {stale&&<div className="stale-banner" role="status"><strong>Update needed</strong><span>{dirty?'You have unsaved study plan edits. These results describe the saved inputs.':'The briefing or calendar uses older backend versions. Refresh before relying on it.'}</span><button className="secondary" onClick={refresh}>Refresh dashboard results</button></div>}
 {!results.state.noSemester&&(!state||results.briefing.loading||results.calendar.loading)&&<p role="status">Freshness is not yet verified. Waiting for authoritative state, briefing and calendar.</p>}
 {!results.state.noSemester&&feedback('state')}
 <section className="dashboard-hero card"><div><span className="eyebrow">YOUR FINANCIAL BRIEFING</span>{feedback('briefing')}{briefing&&<><h2>{briefing.status==='NEEDS_INFORMATION'?'More information needed':briefing.status==='AT_RISK'?'Review your plan':briefing.status==='SAFE'?'Backend reports a safe plan':explainCode(briefing.status)}</h2>{versions(briefing)}<p>{briefing.is_simulated?'Simulated financial data':'Backend reported data'}</p></>}</div><button className="primary" onClick={()=>onJourney(0)}>Resume study plan →</button></section>
 <div className="dashboard-grid">
 <section className="card dashboard-panel"><h2>Next obligation</h2>{briefing?briefing.next_obligation?<><strong>{briefing.next_obligation.label}</strong><p>{formatDate(briefing.next_obligation.date)} · {formatMoney(briefing.next_obligation.amount,briefing.next_obligation.currency)}</p><p>{explainCode(briefing.next_obligation.status)}</p></>:<p>No upcoming obligation was returned yet.</p>:feedback('briefing')}<button className="dashboard-link" onClick={()=>onJourney(2)}>View payment calendar →</button></section>
 <section className="card dashboard-panel"><h2>Needs your attention</h2>{briefing?<><ul className="dashboard-list">{briefing.data_issues.map((code,i)=><li key={i}><span>{explainCode(code)}<details><summary>Backend code</summary>{code}</details></span>{link(code)}</li>)}{briefing.actions.map((action,i)=><li key={i}><span>{explainCode(action.kind)}<details><summary>Backend details</summary><pre className="backend-json">{JSON.stringify(action,null,2)}</pre></details></span>{link(action.kind)}</li>)}</ul>{!briefing.data_issues.length&&!briefing.actions.length&&<p>No attention items were returned.</p>}</>:feedback('briefing')}</section>
 <section className="card dashboard-panel"><h2>Upcoming dates</h2>{feedback('calendar')}{calendar&&<>{versions(calendar)}{calendar.calendar.length?<ul className="dashboard-list">{calendar.calendar.slice(0,5).map(item=><li key={item.id}><span><strong>{item.label}</strong><small>{formatDate(item.date)} · {explainCode(item.status)}</small></span><span>{formatMoney(item.amount,item.currency)}</span></li>)}</ul>:<p>No dated obligations were returned yet.</p>}<button className="dashboard-link" onClick={()=>onJourney(2)}>Open full calendar →</button></>}</section>
 <section className="card dashboard-panel"><h2>Notifications</h2>{feedback('notifications')}{notifications&&<><p>{notifications.unread_count} unread · {notifications.count} total</p>{notifications.data.length?<ul className="dashboard-list">{notifications.data.map(item=><li key={item.id}><span>{explainCode(item.payload.kind??item.transition)}<small>{formatDate(item.created_at.slice(0,10))} · {item.read_at?'Read':'Unread'}</small></span>{link(item.payload.kind??'')}</li>)}</ul>:<p>No notifications to show.</p>}{notifications.next&&<p>Showing the first page of notifications.</p>}</>}</section>
 </div><section className="card dashboard-panel"><h2>Items to review</h2>{feedback('reviews')}{reviews&&<><p>{reviews.count} items</p>{reviews.items.length?<ul className="dashboard-list">{reviews.items.map(item=><li key={item.id}><span>{explainCode(item.kind)}<small>{explainCode(item.status)} · Updated {formatDate(item.updated_at.slice(0,10))}</small><details><summary>Backend details</summary><pre className="backend-json">{JSON.stringify(item.details,null,2)}</pre></details></span>{link(item.kind)}</li>)}</ul>:<p>No review items were returned.</p>}{reviews.next&&<p>Showing the first page of review items.</p>}</>}<small>Read-only queue. Operator decisions and notification read actions are not available here.</small></section>
 </>}</div>;
}
