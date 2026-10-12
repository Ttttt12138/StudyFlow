import { useEffect, useState } from 'react';
import { ApiError, DjangoClient } from '../backend/client';
import type { BackendState } from '../backend/contracts';
import { explainCode, formatDate, formatTimestampDate, formatMoney } from '../backend/presenters';
import { useI18n } from '../i18n';
import { computedFrom } from './freshness';
import type { Briefing, Calendar, Notifications, Reviews, Versions } from './types';
type Data = { state: BackendState; briefing: Briefing; calendar: Calendar; notifications: Notifications; reviews: Reviews['data'] };
type Result<T> = {data?: T; error?: string; loading: boolean; auth?: boolean; noSemester?: boolean};
type Results = {[K in keyof Data]: Result<Data[K]>};
const paths = {state:'readiness/state/',briefing:'readiness/briefing/',calendar:'readiness/calendar/',notifications:'readiness/notifications/',reviews:'review-queue/'};
const initial = (): Results => ({state:{loading:true},briefing:{loading:true},calendar:{loading:true},notifications:{loading:true},reviews:{loading:true}});
function stepFor(kind: string): number|null {
 if(/material|document|profile|protected_cost|conflict/i.test(kind)) return 0;
 if(/missing|expense|spending|data_stale/i.test(kind)) return 1;
 if(/funding|sponsor/i.test(kind)) return 3;
 if(/loan|application|repayment/i.test(kind)) return 4;
 if(/gap|budget|obligation/i.test(kind)) return 2;
 return null;
}
export function LiveDashboard({api,dirty,onJourney}: {api:DjangoClient;dirty:boolean;onJourney:(step:number)=>void}) {
 const {lang,t}=useI18n();
 const [results,setResults]=useState<Results>(initial),[reload,setReload]=useState(0);
 useEffect(()=>{
  let active=true; setResults(initial());
  (Object.keys(paths) as Array<keyof Data>).forEach(key=>{
   const promise=key==='notifications'?api.rawGet<Data[typeof key]>(paths[key]):api.get<Data[typeof key]>(paths[key]);
   promise.then(data=>{if(active)setResults(old=>({...old,[key]:{data,loading:false}}));}).catch((error:unknown)=>{
    const auth=error instanceof ApiError&&[401,403].includes(error.status);
    const noSemester=error instanceof ApiError&&error.status===400&&JSON.stringify(error.details).includes('NO_ACTIVE_SEMESTER');
    if(active)setResults(old=>({...old,[key]:{loading:false,auth,noSemester,error:error instanceof Error?error.message:t('dash.requestFailed')}}));
   });
  });return()=>{active=false;};
 },[api,reload]);
 const refresh=()=>setReload(x=>x+1);
 const state=results.state.data,briefing=results.briefing.data,calendar=results.calendar.data,notifications=results.notifications.data,reviews=results.reviews.data;
 const stale=dirty||!!briefing&&!!calendar&&briefing.as_of!==calendar.as_of||!!state&&[briefing,calendar].some(r=>r&&!computedFrom(r,state));
 function feedback(key:keyof Data) {const r=results[key],name=t(`dash.key.${key}`);return r.loading?<p role="status">{t('dash.loadingKey',{key:name})}</p>:r.noSemester?<p>{t('dash.createSemesterInfo')}</p>:r.error?<div role="alert"><p>{t('dash.couldNotLoad',{key:name})}</p><details><summary>{t('dash.viewBackendResponse')}</summary><pre className="backend-json">{r.error}</pre></details><button className="secondary" onClick={refresh}>{t('dash.retryKey',{key:name})}</button></div>:null;}
 function briefingPending() {return results.briefing.loading?<p role="status">{t('dash.loadingBriefing')}</p>:results.briefing.noSemester?<p>{t('dash.createSemesterInfo')}</p>:<p>{t('dash.briefingUnavailable')}</p>;}
 function link(kind:string) {const step=stepFor(kind);return step===null?<small>{t('dash.readOnlyStatus')}</small>:<button className="dashboard-link" onClick={()=>onJourney(step)}>{t('dash.reviewInPlan')}</button>;}
 function versions(row:Versions&{as_of:string}) {return <small>{t('dash.versions',{date:formatDate(row.as_of,lang),state:row.state_version,budget:row.budget_version,analysis:row.analysis_version??''})}</small>;}
 return <div className="dashboard-app"><div className="section-heading"><div><span className="eyebrow">{t('dash.eyebrowHome')}</span><h1>{t('dash.title')}</h1><p>{t('dash.live.subtitle')}</p></div><button className="secondary" onClick={refresh}>{t('dash.refreshDashboard')}</button></div>
 {Object.values(results).some(r=>r.auth)?<section className="card" role="alert"><h2>{t('dash.signInAgain')}</h2><p>{t('dash.notAuthenticated')}</p><a className="primary" href={`/api/auth/login/?next=${encodeURIComponent(window.location.origin+'/')}`}>{t('common.signIn')}</a></section>:<>
 {results.state.noSemester&&<section className="card" role="status"><h2>{t('dash.startSemester')}</h2><p>{t('dash.noActiveSemester')}</p><button className="primary" onClick={()=>onJourney(0)}>{t('dash.createSemester')}</button></section>}
 {stale&&<div className="stale-banner" role="status"><strong>{t('dash.updateNeeded')}</strong><span>{dirty?t('dash.unsavedEdits'):t('dash.olderVersions')}</span><button className="secondary" onClick={refresh}>{t('dash.refreshResults')}</button></div>}
 {!results.state.noSemester&&(!state||results.briefing.loading||results.calendar.loading)&&<p role="status">{t('dash.freshnessPending')}</p>}
 {!results.state.noSemester&&feedback('state')}
 <section className="dashboard-hero card"><div><span className="eyebrow">{t('dash.eyebrowBriefing')}</span>{feedback('briefing')}{briefing&&<><h2>{briefing.status==='NEEDS_INFORMATION'?t('dash.status.needsInfo'):briefing.status==='AT_RISK'?t('dash.status.atRisk'):briefing.status==='SAFE'?t('dash.status.safeLive'):explainCode(briefing.status,lang)}</h2>{versions(briefing)}<p>{briefing.is_simulated?t('dash.simulatedData'):t('dash.backendData')}</p></>}</div><button className="primary" onClick={()=>onJourney(0)}>{t('dash.resume')} →</button></section>
 <div className="dashboard-grid">
 <section className="card dashboard-panel"><h2>{t('dash.nextObligation')}</h2>{briefing?briefing.next_obligation?<><strong>{briefing.next_obligation.label}</strong><p>{formatDate(briefing.next_obligation.date,lang)} · {formatMoney(briefing.next_obligation.amount,briefing.next_obligation.currency,lang)}</p><p>{explainCode(briefing.next_obligation.status,lang)}</p></>:<p>{t('dash.noObligationLive')}</p>:briefingPending()}<button className="dashboard-link" onClick={()=>onJourney(2)}>{t('dash.viewCalendar')} →</button></section>
 <section className="card dashboard-panel"><h2>{t('dash.needsAttention')}</h2>{briefing?<><ul className="dashboard-list">{briefing.data_issues.map((code,i)=><li key={i}><span>{explainCode(code,lang)}<details><summary>{t('dash.backendCode')}</summary>{code}</details></span>{link(code)}</li>)}{briefing.actions.map((action,i)=><li key={i}><span>{explainCode(action.kind,lang)}<details><summary>{t('dash.backendDetails')}</summary><pre className="backend-json">{JSON.stringify(action,null,2)}</pre></details></span>{link(action.kind)}</li>)}</ul>{!briefing.data_issues.length&&!briefing.actions.length&&<p>{t('dash.noAttentionLive')}</p>}</>:briefingPending()}</section>
 <section className="card dashboard-panel"><h2>{t('dash.upcomingDates')}</h2>{feedback('calendar')}{calendar&&<>{versions(calendar)}{calendar.calendar.length?<ul className="dashboard-list">{calendar.calendar.slice(0,5).map(item=><li key={item.id}><span><strong>{item.label}</strong><small>{formatDate(item.date,lang)} · {explainCode(item.status,lang)}</small></span><span>{formatMoney(item.amount,item.currency,lang)}</span></li>)}</ul>:<p>{t('dash.noDated')}</p>}<button className="dashboard-link" onClick={()=>onJourney(2)}>{t('dash.openCalendar')} →</button></>}</section>
 <section className="card dashboard-panel"><h2>{t('dash.notifications')}</h2>{feedback('notifications')}{notifications&&<><p>{t('dash.notifCounts',{unread:notifications.unread_count,total:notifications.count})}</p>{notifications.data.length?<ul className="dashboard-list">{notifications.data.map(item=><li key={item.id}><span>{explainCode(item.payload.kind??item.transition,lang)}<small>{formatTimestampDate(item.created_at,lang)} · {item.read_at?t('dash.read'):t('dash.unread')}</small></span>{link(item.payload.kind??'')}</li>)}</ul>:<p>{t('dash.noNotifications')}</p>}{notifications.next&&<p>{t('dash.firstPageNotifications')}</p>}</>}</section>
 </div><section className="card dashboard-panel"><h2>{t('dash.itemsToReview')}</h2>{feedback('reviews')}{reviews&&<><p>{t('dash.itemsCount',{count:reviews.count})}</p>{reviews.items.length?<ul className="dashboard-list">{reviews.items.map(item=><li key={item.id}><span>{explainCode(item.kind,lang)}<small>{explainCode(item.status,lang)} · {t('dash.updated',{date:formatTimestampDate(item.updated_at,lang)})}</small><details><summary>{t('dash.backendDetails')}</summary><pre className="backend-json">{JSON.stringify(item.details,null,2)}</pre></details></span>{link(item.kind)}</li>)}</ul>:<p>{t('dash.noReviewsLive')}</p>}{reviews.next&&<p>{t('dash.firstPageReviews')}</p>}</>}<small>{t('dash.readOnlyQueue')}</small></section>
 </>}</div>;
}
