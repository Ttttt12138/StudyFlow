import { useEffect, useState } from "react";
import { explainCode, formatDate, formatTimestampDate, formatMoney } from "../backend/presenters";
import { useI18n } from "../i18n";
import { computedFrom } from "./freshness";
import { loadDashboardPreview } from "./mockAdapter";
import type { DashboardData, DashboardScenario } from "./types";

const scenarios: DashboardScenario[] = ["attention", "clear", "empty", "stale", "error", "signed_out"];
const journey = [0, 1, 2, 3, 4] as const;

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
  const { lang, t } = useI18n();
  const { briefing, calendar, notifications, reviews } = data;
  const stale = !computedFrom(briefing, data.current) || !computedFrom(calendar, data.current);
  const status = briefing.status === "NEEDS_INFORMATION" ? t("dash.status.needsInfo") : briefing.status === "AT_RISK" ? t("dash.status.atRisk") : briefing.status === "SAFE" ? t("dash.status.safePreview") : explainCode(briefing.status, lang);
  const next = briefing.next_obligation;
  return <>
    {stale && <div className="stale-banner" role="status"><strong>{t("dash.updateNeeded")}</strong><span>{t("dash.prev.stale")}</span><button className="secondary" onClick={onRefresh}>{t("dash.prev.refresh")}</button></div>}
    <section className="dashboard-hero card" aria-labelledby="dashboard-status">
      <div><span className="eyebrow">{t("dash.eyebrowBriefing")}</span><h2 id="dashboard-status">{status}</h2><p>{briefing.status === "NEEDS_INFORMATION" ? t("dash.prev.needsInfoText") : briefing.status === "SAFE" ? t("dash.prev.safeText") : t("dash.prev.otherText")}</p><small>{t("dash.prev.reportedAsOf", { date: formatDate(briefing.as_of, lang), source: briefing.is_simulated ? t("dash.simulatedData") : t("dash.backendData") })}</small></div>
      <div className="dashboard-hero-action"><button className="primary" onClick={() => onJourney(briefing.data_issues.length ? 1 : 0)}>{t("dash.resume")} <span aria-hidden="true">→</span></button></div>
    </section>
    <div className="dashboard-grid">
      <section className="card dashboard-panel" aria-labelledby="dashboard-obligation"><div className="dashboard-panel-head"><span className="dashboard-icon" aria-hidden="true">◷</span><span className="count">{t("dash.prev.fromBriefing")}</span></div><h2 id="dashboard-obligation">{t("dash.nextObligation")}</h2>{next ? <><strong className="dashboard-feature-value">{next.label}</strong><p>{formatDate(next.date, lang)} · {formatMoney(next.amount, next.currency, lang)}</p><span className="calendar-pill">{displayKind(next.status)}</span></> : <p>{t("dash.prev.noObligation")}</p>}<button className="dashboard-link" onClick={() => onJourney(2)}>{t("dash.viewCalendar")} <span aria-hidden="true">→</span></button></section>
      <section className="card dashboard-panel" aria-labelledby="dashboard-attention"><div className="dashboard-panel-head"><span className="dashboard-icon" aria-hidden="true">◇</span><span className="count">{t("dash.prev.backendActions")}</span></div><h2 id="dashboard-attention">{t("dash.needsAttention")}</h2>{briefing.data_issues.length || briefing.actions.length ? <ul className="dashboard-list">{briefing.data_issues.map((issue, n) => <li key={`${issue}-${n}`}><span>{explainCode(issue, lang)}</span><button className="dashboard-link" onClick={() => onJourney(actionStep(issue))}>{t("dash.prev.review")} <span aria-hidden="true">→</span></button></li>)}{briefing.actions.map((action, index) => <li key={`${action.kind}-${index}`}><span>{displayKind(action.kind)}</span><button className="dashboard-link" onClick={() => onJourney(actionStep(action.kind))}>{t("dash.prev.openStep")} <span aria-hidden="true">→</span></button></li>)}</ul> : <p>{t("dash.prev.noAttention")}</p>}</section>
    </div>
    <div className="dashboard-grid dashboard-lower">
      <section className="card dashboard-panel" aria-labelledby="dashboard-calendar"><div className="dashboard-panel-head"><span className="eyebrow">{t("dash.prev.datesAhead")}</span><span className="count">{formatDate(calendar.as_of, lang)}</span></div><h2 id="dashboard-calendar">{t("dash.upcomingDates")}</h2>{calendar.calendar.length ? <ul className="dashboard-list">{calendar.calendar.slice(0, 3).map((item) => <li key={item.id}><span><strong>{item.label}</strong><small>{formatDate(item.date, lang)} · {displayKind(item.status)}</small></span><span>{formatMoney(item.amount, item.currency, lang)}</span></li>)}</ul> : <p>{t("dash.noDated")}</p>}<button className="dashboard-link" onClick={() => onJourney(2)}>{t("dash.openCalendar")} <span aria-hidden="true">→</span></button></section>
      <section className="card dashboard-panel" aria-labelledby="dashboard-notifications"><div className="dashboard-panel-head"><span className="eyebrow">{t("dash.prev.updates")}</span><span className="count">{t("dash.prev.unreadCount", { count: notifications.unread_count })}</span></div><h2 id="dashboard-notifications">{t("dash.notifications")}</h2>{notifications.data.length ? <ul className="dashboard-list">{notifications.data.map((item) => <li key={item.id}><span><strong>{displayKind(item.payload.kind ?? t("dash.prev.planUpdate"))}</strong><small>{displayKind(item.transition)} · {formatTimestampDate(item.created_at, lang)}{" · "}{item.read_at ? t("dash.read") : t("dash.unread")}</small></span><button className="dashboard-link" onClick={() => onJourney(actionStep(item.payload.kind ?? ""))}>{t("dash.prev.view")} <span aria-hidden="true">→</span></button></li>)}</ul> : <p>{t("dash.noNotifications")}</p>}<small>{t("dash.prev.markReadNote")}</small></section>
    </div>
    <section className="card dashboard-panel dashboard-reviews" aria-labelledby="dashboard-reviews"><div className="dashboard-panel-head"><span className="eyebrow">{t("dash.prev.reviewQueue")}</span><span className="count">{t(reviews.data.count === 1 ? "dash.itemCount" : "dash.itemsCount", { count: reviews.data.count })}</span></div><h2 id="dashboard-reviews">{t("dash.itemsToReview")}</h2>{reviews.data.items.length ? <ul className="dashboard-list">{reviews.data.items.map((item) => <li key={item.id}><span><strong>{typeof item.details.label === "string" ? item.details.label : displayKind(item.kind)}</strong><small>{displayKind(item.status)} · {t("dash.updated", { date: formatTimestampDate(item.updated_at, lang) })}</small></span><button className="dashboard-link" onClick={() => onJourney(actionStep(item.kind))}>{t("dash.prev.goToStep")} <span aria-hidden="true">→</span></button></li>)}</ul> : <p>{t("dash.prev.noReviews")}</p>}<small>{t("dash.prev.reviewNotSimulated")}</small></section>
    <section className="dashboard-next" aria-label={t("dash.prev.exploreLabel")}><h2>{t("dash.prev.beyond")}</h2><p>{t("dash.prev.beyondText")}</p><div><span>{t("dash.prev.service.spending")}</span><span>{t("dash.prev.service.wallet")}</span><span>{t("dash.prev.service.sponsors")}</span></div></section>
  </>;
}

export function DashboardPreview({ onExit, onJourney, embedded = false }: { onExit: () => void; onJourney: (step: number) => void; embedded?: boolean }) {
  const { lang, t } = useI18n();
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
    loadDashboardPreview(scenario, lang).then((result) => { if (active) setData(result); }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : t("dash.prev.loadError")); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [scenario, reload]);
  const content = <><div className="section-heading"><div><span className="eyebrow">{t("dash.eyebrowHome")}</span><h1>{t("dash.title")}</h1><p>{t("dash.prev.subtitle")}</p></div></div><div className="preview-banner" role="status"><strong>{t("dash.prev.bannerTitle")}</strong><span>{t("dash.prev.bannerText")}</span></div><div className="dashboard-controls"><label htmlFor="dashboard-scenario">{t("dash.prev.previewState")}</label><select id="dashboard-scenario" value={scenario} onChange={(event) => setScenario(event.target.value as DashboardScenario)}>{scenarios.map((value) => <option value={value} key={value}>{t(`dash.scenario.${value}`)}</option>)}</select><button className="secondary" onClick={() => scenario === "stale" ? setScenario("attention") : setReload((value) => value + 1)} disabled={scenario === "signed_out"}>{t("dash.prev.refresh")}</button></div>{scenario === "signed_out" ? <section className="card dashboard-state" role="status"><h2>{t("dash.prev.connectTitle")}</h2><p>{t("dash.prev.signedOutText")}</p><button className="primary" onClick={onExit}>{t("dash.prev.returnToSetup")}</button></section> : loading ? <section className="card dashboard-state" role="status"><span className="activity-dot" aria-hidden="true"/><h2>{t("dash.prev.loadingTitle")}</h2><p>{t("dash.prev.loadingText")}</p></section> : error ? <section className="card dashboard-state" role="alert"><h2>{t("dash.prev.errorTitle")}</h2><p>{error}</p><button className="primary" onClick={() => setReload((value) => value + 1)}>{t("dash.prev.tryAgain")}</button></section> : data && <DashboardContent data={data} onJourney={onJourney} onRefresh={() => setScenario("attention")}/>}</>;
  if (embedded) return <div className="dashboard-app dashboard-preview-embedded">{content}</div>;
  return <div className="app connected dashboard-app"><aside><a className="brand" href="#" onClick={(event) => { event.preventDefault(); onExit(); }}><span className="brand-icon">S</span>StudyFlow<span className="brand-dot">.</span></a><div className="journey-label">{t("dash.prev.journeyLabel")}</div><button className="mobile-step-toggle secondary" aria-expanded={showNav} aria-controls="dashboard-preview-nav" onClick={() => setShowNav(!showNav)}>{t("dash.title")} <span aria-hidden="true">{showNav ? "−" : "+"}</span></button><nav id="dashboard-preview-nav" className={showNav ? "steps-open" : ""} aria-label={t("dash.prev.navLabel")}><button className="active" aria-current="page"><span className="step-number">⌂</span>{t("dash.title")}</button>{journey.map((index) => <button key={index} onClick={() => onJourney(index)}><span className="step-number">0{index + 1}</span>{t(`dash.journey.${index}`)}</button>)}</nav><div className="sidebar-note"><strong>{t("dash.prev.sidebarTitle")}</strong><p>{t("dash.prev.sidebarText")}</p></div><button className="secondary" onClick={onExit}>{t("dash.prev.backToSetup")}</button></aside><div className="workspace"><header><span>{t("dash.prev.crumb")}</span><span className="avatar">ST</span></header><main>{content}</main><footer>{t("dash.prev.footer")}<span>{t("dash.prev.footerNote")}</span></footer></div></div>;
}
