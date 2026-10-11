import { useEffect, useState } from "react";
import { explainCode, formatDate, formatTimestampDate, formatMoney } from "../backend/presenters";
import { computedFrom } from "./freshness";
import { loadDashboardPreview } from "./mockAdapter";
import type { DashboardData, DashboardScenario } from "./types";

const scenarios: Array<{ value: DashboardScenario; label: string }> = [
  { value: "attention", label: "Needs attention" },
  { value: "clear", label: "All clear" },
  { value: "empty", label: "New student" },
  { value: "stale", label: "Outdated summary" },
  { value: "error", label: "Request error" },
  { value: "signed_out", label: "Signed out" },
];
const journey = ["Confirm information", "Complete expenses", "Budget", "Funding", "Simulated application"];

function actionStep(kind: string) {
  if (kind.includes("document") || kind.includes("profile")) return 0;
  if (kind.includes("missing") || kind.includes("expense")) return 1;
  if (kind.includes("funding") || kind.includes("sponsor")) return 3;
  if (kind.includes("loan") || kind.includes("application")) return 4;
  return 2;
}
function displayKind(kind: string) {
  return kind.replaceAll("_", " ").replace(/^\w/, (letter) => letter.toUpperCase());
}
function DashboardContent({ data, onJourney, onRefresh }: { data: DashboardData; onJourney: (step: number) => void; onRefresh: () => void }) {
  const { briefing, calendar, notifications, reviews } = data;
  const stale = !computedFrom(briefing, data.current) || !computedFrom(calendar, data.current);
  const status = briefing.status === "NEEDS_INFORMATION" ? "More information needed" : briefing.status === "AT_RISK" ? "Review your plan" : briefing.status === "SAFE" ? "Plan is up to date" : explainCode(briefing.status);
  const next = briefing.next_obligation;
  return <>
    {stale && <div className="stale-banner" role="status"><strong>Update needed</strong><span>This demo briefing or calendar uses an older backend version. Refresh results before relying on it.</span><button className="secondary" onClick={onRefresh}>Refresh preview</button></div>}
    <section className="dashboard-hero card" aria-labelledby="dashboard-status">
      <div><span className="eyebrow">YOUR FINANCIAL BRIEFING</span><h2 id="dashboard-status">{status}</h2><p>{briefing.status === "NEEDS_INFORMATION" ? "Check the information below to make your plan more complete." : briefing.status === "SAFE" ? "The demo backend reports no current attention items." : "Review the backend's current status and next actions."}</p><small>Reported as of {formatDate(briefing.as_of)} · {briefing.is_simulated ? "Simulated financial data" : "Backend reported data"}</small></div>
      <div className="dashboard-hero-action"><button className="primary" onClick={() => onJourney(briefing.data_issues.length ? 1 : 0)}>Resume study plan <span aria-hidden="true">→</span></button></div>
    </section>
    <div className="dashboard-grid">
      <section className="card dashboard-panel" aria-labelledby="dashboard-obligation"><div className="dashboard-panel-head"><span className="dashboard-icon" aria-hidden="true">◷</span><span className="count">From backend briefing</span></div><h2 id="dashboard-obligation">Next obligation</h2>{next ? <><strong className="dashboard-feature-value">{next.label}</strong><p>{formatDate(next.date)} · {formatMoney(next.amount, next.currency)}</p><span className="calendar-pill">{displayKind(next.status)}</span></> : <p>No upcoming obligation was returned. Add or confirm dated costs in your study plan.</p>}<button className="dashboard-link" onClick={() => onJourney(2)}>View payment calendar <span aria-hidden="true">→</span></button></section>
      <section className="card dashboard-panel" aria-labelledby="dashboard-attention"><div className="dashboard-panel-head"><span className="dashboard-icon" aria-hidden="true">◇</span><span className="count">Backend actions</span></div><h2 id="dashboard-attention">Needs your attention</h2>{briefing.data_issues.length || briefing.actions.length ? <ul className="dashboard-list">{briefing.data_issues.map((issue, n) => <li key={`${issue}-${n}`}><span>{explainCode(issue)}</span><button className="dashboard-link" onClick={() => onJourney(actionStep(issue))}>Review <span aria-hidden="true">→</span></button></li>)}{briefing.actions.map((action, index) => <li key={`${action.kind}-${index}`}><span>{displayKind(action.kind)}</span><button className="dashboard-link" onClick={() => onJourney(actionStep(action.kind))}>Open step <span aria-hidden="true">→</span></button></li>)}</ul> : <p>No attention items were returned in this demo state.</p>}</section>
    </div>
    <div className="dashboard-grid dashboard-lower">
      <section className="card dashboard-panel" aria-labelledby="dashboard-calendar"><div className="dashboard-panel-head"><span className="eyebrow">DATES AHEAD</span><span className="count">{formatDate(calendar.as_of)}</span></div><h2 id="dashboard-calendar">Upcoming dates</h2>{calendar.calendar.length ? <ul className="dashboard-list">{calendar.calendar.slice(0, 3).map((item) => <li key={item.id}><span><strong>{item.label}</strong><small>{formatDate(item.date)} · {displayKind(item.status)}</small></span><span>{formatMoney(item.amount, item.currency)}</span></li>)}</ul> : <p>No dated obligations were returned yet.</p>}<button className="dashboard-link" onClick={() => onJourney(2)}>Open full calendar <span aria-hidden="true">→</span></button></section>
      <section className="card dashboard-panel" aria-labelledby="dashboard-notifications"><div className="dashboard-panel-head"><span className="eyebrow">UPDATES</span><span className="count">{notifications.unread_count} unread</span></div><h2 id="dashboard-notifications">Notifications</h2>{notifications.data.length ? <ul className="dashboard-list">{notifications.data.map((item) => <li key={item.id}><span><strong>{displayKind(item.payload.kind ?? "Plan update")}</strong><small>{displayKind(item.transition)} · {formatTimestampDate(item.created_at)}{item.read_at ? " · Read" : " · Unread"}</small></span><button className="dashboard-link" onClick={() => onJourney(actionStep(item.payload.kind ?? ""))}>View <span aria-hidden="true">→</span></button></li>)}</ul> : <p>No notifications to show.</p>}<small>Preview only: marking notifications read requires Django.</small></section>
    </div>
    <section className="card dashboard-panel dashboard-reviews" aria-labelledby="dashboard-reviews"><div className="dashboard-panel-head"><span className="eyebrow">REVIEW QUEUE</span><span className="count">{reviews.data.count} item{reviews.data.count === 1 ? "" : "s"}</span></div><h2 id="dashboard-reviews">Items to review</h2>{reviews.data.items.length ? <ul className="dashboard-list">{reviews.data.items.map((item) => <li key={item.id}><span><strong>{typeof item.details.label === "string" ? item.details.label : displayKind(item.kind)}</strong><small>{displayKind(item.status)} · Updated {formatTimestampDate(item.updated_at)}</small></span><button className="dashboard-link" onClick={() => onJourney(actionStep(item.kind))}>Go to step <span aria-hidden="true">→</span></button></li>)}</ul> : <p>No review items were returned. New document conflicts or checks may appear here later.</p>}<small>Review actions are not simulated in this read-only preview.</small></section>
    <section className="dashboard-next" aria-label="Explore later student services"><h2>Beyond your admission plan</h2><p>These areas are planned for later frontend work. The dashboard does not perform money actions.</p><div><span>Spending activity and CSV review</span><span>Wallet and transfers</span><span>Sponsors and loan accounts</span></div></section>
  </>;
}

export function DashboardPreview({ onExit, onJourney }: { onExit: () => void; onJourney: (step: number) => void }) {
  const [scenario, setScenario] = useState<DashboardScenario>("attention");
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [showNav, setShowNav] = useState(false);
  useEffect(() => {
    if (scenario === "signed_out") { setData(null); setError(""); setLoading(false); return; }
    let active = true;
    setData(null); setError(""); setLoading(true);
    loadDashboardPreview(scenario).then((result) => { if (active) setData(result); }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "Could not load dashboard."); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [scenario, reload]);
  return <div className="app connected dashboard-app"><aside><a className="brand" href="#" onClick={(event) => { event.preventDefault(); onExit(); }}><span className="brand-icon">S</span>StudyFlow<span className="brand-dot">.</span></a><div className="journey-label">YOUR STUDY PLAN</div><button className="mobile-step-toggle secondary" aria-expanded={showNav} aria-controls="dashboard-preview-nav" onClick={() => setShowNav(!showNav)}>Dashboard <span aria-hidden="true">{showNav ? "−" : "+"}</span></button><nav id="dashboard-preview-nav" className={showNav ? "steps-open" : ""} aria-label="Dashboard navigation"><button className="active" aria-current="page"><span className="step-number">⌂</span>Dashboard</button>{journey.map((label, index) => <button key={label} onClick={() => onJourney(index)}><span className="step-number">0{index + 1}</span>{label}</button>)}</nav><div className="sidebar-note"><strong>A clearer view of what comes next.</strong><p>These figures are fixed demo responses for UI review.</p></div><button className="secondary" onClick={onExit}>Back to setup</button></aside><div className="workspace"><header><span>StudyFlow / Dashboard preview</span><span className="avatar">ST</span></header><main><div className="section-heading"><div><span className="eyebrow">YOUR STUDENT HOME</span><h1>Dashboard</h1><p>A simple view of your next dates and what needs your attention.</p></div></div><div className="preview-banner" role="status"><strong>Demo data · read-only</strong><span>Fixed backend-shaped examples. No Django account is connected and no financial result is calculated here.</span></div><div className="dashboard-controls"><label htmlFor="dashboard-scenario">Preview a state</label><select id="dashboard-scenario" value={scenario} onChange={(event) => setScenario(event.target.value as DashboardScenario)}>{scenarios.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select><button className="secondary" onClick={() => scenario === "stale" ? setScenario("attention") : setReload((value) => value + 1)} disabled={scenario === "signed_out"}>Refresh preview</button></div>{scenario === "signed_out" ? <section className="card dashboard-state" role="status"><h2>Connect to see your plan</h2><p>This preview is showing the signed-out state. A real dashboard would ask you to sign in before requesting student information.</p><button className="primary" onClick={onExit}>Return to setup</button></section> : loading ? <section className="card dashboard-state" role="status"><span className="activity-dot" aria-hidden="true"/><h2>Loading your dashboard…</h2><p>Collecting the briefing, calendar, notifications, and review items.</p></section> : error ? <section className="card dashboard-state" role="alert"><h2>We could not load the dashboard</h2><p>{error}</p><button className="primary" onClick={() => setReload((value) => value + 1)}>Try again</button></section> : data && <DashboardContent data={data} onJourney={onJourney} onRefresh={() => setScenario("attention")}/>}</main><footer>StudyFlow · Student dashboard preview<span>Demo responses only</span></footer></div></div>;
}
