import { useToolRefresh, useEmbedded } from "../workspace/context";
import { ModulePresentation } from "../workspace/ModulePresentation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ModuleNav } from "../services/ModuleNav";
import { formatDate, formatMoney } from "../backend/presenters";
import { getAll } from "../backend/client";
import { intlLocale, useI18n, type MessageKey } from "../i18n";
import { TierBadge, TierLegend } from "../services/TierBadge";
import { SessionWalletClient, WalletApiError, type WalletClient } from "../wallet/client";
import { PanelAlert, PanelEmpty, PanelHero, PanelInfo, PanelPager, PanelSheet, PanelSkeleton, ToolPanel, usePage } from "../workspace/ToolPanel";
import { BarCompare, LevelBar, StepTrack } from "../workspace/PanelCharts";
import { createTrustPreview } from "./previewAdapter";
import type { AuditEvent, AuditPage, CreditProfile, LimitsSummary, TrustApproval } from "./types";
import "../services/services.css";
import "./trust.css";
import { CreditStatements } from "./CreditStatements";

const signInUrl = `/auth?next=${encodeURIComponent(window.location.origin + "/?trust=1")}`;
// Audit action prefixes with their own filter; everything else is grouped under "other".
const CATEGORIES = ["auth", "approval", "agent", "credit", "payment", "remittance", "wallet", "fx", "funding"] as const;
const NAMED_EVENTS = ["auth.step_up_granted", "auth.step_up_failed", "approval.requested", "approval.approved",
  "approval.rejected", "agent.action_confirmed", "agent.action_rejected", "credit.snapshot_created",
  "credit.statement_issued"] as const;
const LEVELS = ["AT_RISK", "BUILDING", "FAIR", "GOOD"] as const;
const FACTORS = ["ON_TIME_RECORDS", "LATE_RECORDS", "OVERDUE_RECORDS", "THIN_HISTORY"] as const;
const ACTIONS = ["payment.submit", "wallet.convert", "loan.repay", "remittance.submit"] as const;
const AUDIT_PAGE = 5;
const APPROVAL_PAGE = 2;

type Section<T> = { data: T | null; error: string };
type Tab = "levels" | "limits" | "activity";
const empty = <T,>(): Section<T> => ({ data: null, error: "" });

function categoryOf(action: string) {
  const prefix = action.split(".")[0];
  return (CATEGORIES as readonly string[]).includes(prefix) ? prefix : "other";
}

function percent(used: string, limit: string) {
  const u = Number(used), l = Number(limit);
  if (!Number.isFinite(u) || !Number.isFinite(l) || l <= 0) return 0;
  return Math.min(100, Math.round((u / l) * 100));
}

export function TrustApp({ preview, onExit }: { preview: boolean; onExit: () => void }) {
  const { lang, t } = useI18n();
  const embedded = useEmbedded();
  const client = useMemo<WalletClient>(() => preview ? createTrustPreview() : new SessionWalletClient(), [preview]);
  const [credit, setCredit] = useState<Section<CreditProfile>>(empty);
  const [limits, setLimits] = useState<Section<LimitsSummary>>(empty);
  const [approvals, setApprovals] = useState<Section<TrustApproval[]>>(empty);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [auditError, setAuditError] = useState("");
  const [nextPage, setNextPage] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [category, setCategory] = useState("all");
  const [signedOut, setSignedOut] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("levels");
  const [sheet, setSheet] = useState<"evidence" | "share" | null>(null);
  const [currency, setCurrency] = useState("");
  const [auditPage, setAuditPage] = useState(0);
  const [approvalPage, setApprovalPage] = useState(0);

  const text = useCallback((error: unknown) => {
    if (error instanceof WalletApiError && [401, 403].includes(error.status)) setSignedOut(true);
    return error instanceof WalletApiError ? `HTTP ${error.status}: ${error.message}` : error instanceof Error ? error.message : t("trust.err.generic");
  }, [t]);

  const load = useCallback(async () => {
    setLoading(true); setSignedOut(false);
    const [c, l, a, e] = await Promise.allSettled([
      client.get<CreditProfile>("credit/profile/"),
      client.get<LimitsSummary>("policy/limits/"),
      getAll<TrustApproval>(client, "approvals/"),
      client.get<AuditPage>("audit/"),
    ]);
    setCredit(c.status === "fulfilled" ? { data: c.value, error: "" } : { data: null, error: text(c.reason) });
    setLimits(l.status === "fulfilled" ? { data: l.value, error: "" } : { data: null, error: text(l.reason) });
    setApprovals(a.status === "fulfilled" ? { data: a.value, error: "" } : { data: null, error: text(a.reason) });
    if (e.status === "fulfilled") {
      setEvents(e.value.results); setNextPage(e.value.next); setTotal(e.value.count); setAuditError("");
    } else { setEvents([]); setNextPage(null); setAuditError(text(e.reason)); }
    setLoading(false);
    return { errors: [c, l, a, e].some(result => result.status === "rejected") ? { refresh: "failed" } : {} };
  }, [client, text]);

  useEffect(() => { void load(); }, [load]);

  async function loadMore() {
    if (!nextPage) return;
    setBusy(true);
    try {
      const url = new URL(nextPage, window.location.origin);
      // Same-origin pagination only, as in getAll().
      if (url.host !== window.location.host || !url.pathname.startsWith("/api/v2/")) throw new Error(t("trust.err.pagination"));
      const page = await client.get<AuditPage>(url.pathname.slice("/api/v2/".length) + url.search);
      setEvents((rows) => rows.concat(page.results)); setNextPage(page.next);
    } catch (error) { setAuditError(text(error)); } finally { setBusy(false); }
  }

  const money = (value: unknown, code: string) => formatMoney(value, code, lang);
  const when = (value: string | null | undefined) => value
    ? new Date(value).toLocaleString(intlLocale(lang), { dateStyle: "medium", timeStyle: "short" }) : "—";
  const levelName = (level: string) => (LEVELS as readonly string[]).includes(level) ? t(`trust.level.${level}` as MessageKey) : level;
  const categoryName = (name: string) => t(`trust.category.${name}` as MessageKey);
  const eventName = (action: string) => (NAMED_EVENTS as readonly string[]).includes(action)
    ? t(`trust.event.${action}` as MessageKey) : categoryName(categoryOf(action));
  const actionName = (action: string) => (ACTIONS as readonly string[]).includes(action) ? t(`trust.action.${action}` as MessageKey) : action;
  const shown = category === "all" ? events : events.filter((event) => categoryOf(event.action) === category);
  const auditRows = usePage(shown, AUDIT_PAGE, auditPage);
  const approvalRows = usePage(approvals.data ?? [], APPROVAL_PAGE, approvalPage);

  function eventDetails(event: AuditEvent) {
    const d = event.details ?? {};
    const parts: string[] = [];
    if (typeof d.action === "string") parts.push(actionName(d.action));
    if (typeof d.amount === "string" && typeof d.currency === "string") parts.push(formatMoney(d.amount, d.currency));
    if (typeof d.level === "string") parts.push(t("trust.credit.levelShort", { level: d.level }));
    if (typeof d.actor_id === "number" || typeof d.actor_id === "string") parts.push(t("trust.audit.actor", { id: String(d.actor_id) }));
    return parts.join(" · ");
  }

  const profile = credit.data;
  const limitRows = limits.data?.limits ?? [];
  const limitRow = limitRows.find((row) => row.currency === currency) ?? limitRows[0];
  // Counts per audit category among the events loaded so far (the API count covers all pages).
  const categories = Object.entries(events.reduce<Record<string, number>>((acc, event) => {
    const name = categoryOf(event.action); acc[name] = (acc[name] ?? 0) + 1; return acc;
  }, {})).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const retry = preview ? undefined : () => void load();
  const simulatedTag = <span className="panel-tag">{t("common.simulatedMoney")}</span>;

  const nextLevel = profile && (profile.next_level ? <p className="panel-note">{t("trust.credit.next", { level: levelName(profile.next_level.level) })}{" "}
    {typeof profile.next_level.on_time_needed === "number" && t("trust.credit.needOnTime", { count: profile.next_level.on_time_needed })}
    {profile.next_level.late_records_must_age_out && ` ${t("trust.credit.ageOut")}`}
    {profile.next_level.action === "RESOLVE_OVERDUE" && t("trust.credit.resolveOverdue")}
    {profile.next_level.action === "WAIT_FOR_LATE_RECORDS_TO_AGE_OUT" && t("trust.credit.ageOut")}</p>
    : <p className="panel-note">{t("trust.credit.top")}</p>);

  const staleStatus = useToolRefresh(() => load());
  const notices = (staleStatus || (signedOut && !preview)) && <>
    {staleStatus}
    {signedOut && !preview && <div className="panel-note trust-signin" role="alert"><p>{t("trust.signedOut")}</p><a className="primary" href={signInUrl}>{t("common.signIn")}</a></div>}
  </>;

  const footer = tab === "levels" ? <>
      {profile && profile.evidence.length > 0 && <button type="button" className="panel-link panel-footer-note" onClick={() => setSheet("evidence")}>{t("trust.credit.evidence", { count: profile.evidence.length })} →</button>}
      {(preview || !signedOut) && <button type="button" className="primary" onClick={() => setSheet("share")}>{t("trust.p.share")}</button>}
    </>
    : tab === "activity" ? <>
      <span className="panel-footer-note">{t("trust.audit.count", { shown: events.length, total })}</span>
      {nextPage && <button className="secondary" disabled={busy} onClick={() => void loadMore()}>{t("trust.audit.more")}</button>}
    </> : null;

  const evidenceSheet = sheet === "evidence" && profile && <PanelSheet title={t("trust.credit.evidence", { count: profile.evidence.length })} onClose={() => setSheet(null)}>
    {profile.factors.length > 0 && <><h4 className="panel-section-title">{t("trust.p.factors")}</h4>
      <ul className="panel-rows">{profile.factors.map((factor) => <li key={factor.code}>
        <span>{(FACTORS as readonly string[]).includes(factor.code) ? t(`trust.factor.${factor.code}` as MessageKey, { count: factor.count }) : `${factor.code} (${factor.count})`}</span>
        <span className={`status-chip status-${factor.effect === "positive" ? "ok" : factor.effect === "negative" ? "failed" : "draft"}`}>{factor.count}</span>
      </li>)}</ul></>}
    <table className="panel-table">
      <thead><tr><th>{t("trust.credit.source")}</th><th>{t("trust.credit.due")}</th><th>{t("trust.credit.completed")}</th><th>{t("trust.credit.status")}</th></tr></thead>
      <tbody>{profile.evidence.map((item) => <tr key={`${item.source}:${item.id}`}>
        <td>{t(`trust.source.${item.source}` as MessageKey)}</td><td>{formatDate(item.due_on, lang)}</td>
        <td>{item.completed_on ? formatDate(item.completed_on, lang) : "—"}</td><td>{t(`trust.evidence.${item.status}` as MessageKey)}</td>
      </tr>)}</tbody>
    </table>
    <p className="panel-muted">{t("trust.credit.disclaimer")}</p>
  </PanelSheet>;

  const content = <ToolPanel label={t("trust.title")} numbered={false} active={tab} onSelect={(key) => { setTab(key); setSheet(null); }}
    steps={[{ key: "levels", label: t("trust.tab.levels") }, { key: "limits", label: t("trust.tab.limits") }, { key: "activity", label: t("trust.tab.activity") }]}
    notices={notices} footer={footer}
    sheet={<>{evidenceSheet}<CreditStatements client={client} preview={preview} open={sheet === "share"} onClose={() => setSheet(null)} /></>}>
    {!embedded && <h1 className="sr-only">{t("trust.title")}</h1>}

    <div className="panel-view" hidden={tab !== "levels"}>
      <section id="trust-credit" className="panel-card" aria-labelledby="trust-credit-title">
        <div className="panel-card-head"><h2 id="trust-credit-title">{t("trust.credit.title")}</h2>{simulatedTag}</div>
        {loading && !profile ? <PanelSkeleton rows={3} /> : credit.error ? <PanelAlert message={credit.error} onRetry={retry} /> : profile && <>
          <PanelHero label={t("trust.credit.level")} value={levelName(profile.level)}>
            <span className="panel-muted">{t("trust.p.multiplier", { multiplier: profile.limit_multiplier })} · {t("trust.p.asOf", { date: formatDate(profile.as_of, lang) })}</span>
          </PanelHero>
          <StepTrack steps={LEVELS.map(levelName)} current={(LEVELS as readonly string[]).indexOf(profile.level)} failed={profile.level === "AT_RISK"} label={t("trust.p.ladder")} />
          <div className="trust-counts">
            <div className="panel-tile"><span>{t("trust.credit.onTime")}</span><strong>{profile.on_time}</strong></div>
            <div className="panel-tile"><span>{t("trust.credit.late")}</span><strong>{profile.late}</strong></div>
            <div className={`panel-tile${profile.overdue > 0 ? " is-warn" : ""}`}><span>{t("trust.credit.overdue")}</span><strong>{profile.overdue}</strong></div>
          </div>
          {nextLevel}
          <p className="panel-muted">{t("trust.credit.multiplierText", { multiplier: profile.limit_multiplier })}</p>
        </>}
      </section>
      <section id="trust-tiers" className="panel-card trust-tiers" aria-labelledby="trust-tiers-title">
        <div className="trust-head"><h3 id="trust-tiers-title" className="panel-section-title">{t("trust.tiers.title")}</h3><PanelInfo>{t("trust.tiers.text")}</PanelInfo></div>
        <TierLegend compact />
      </section>
    </div>

    <div className="panel-view" hidden={tab !== "limits"}>
      <section id="trust-limits" className="panel-card" aria-labelledby="trust-limits-title">
        <div className="panel-card-head"><h2 id="trust-limits-title">{t("trust.limits.title")}</h2>
          {limitRows.length > 1 ? <div className="panel-chips" role="group" aria-label={t("trust.limits.currency")}>{limitRows.map((row) =>
            <button key={row.currency} type="button" aria-pressed={row === limitRow} onClick={() => setCurrency(row.currency)}>{row.currency}</button>)}</div> : simulatedTag}</div>
        {loading && !limits.data ? <PanelSkeleton rows={3} /> : limits.error ? <PanelAlert message={limits.error} onRetry={retry} /> : limits.data && (!limitRow
          ? <p className="panel-note is-warn">{t("trust.limits.none")}</p> : <>
            <PanelHero label={t("trust.p.perTransaction", { currency: limitRow.currency })} value={money(limitRow.effective.per_transaction, limitRow.currency)}>
              <span className="panel-muted">{t("trust.limits.base", { amount: money(limitRow.base.per_transaction, limitRow.currency) })}</span></PanelHero>
            <ul className="trust-usage">{(["daily", "monthly"] as const).map((window) => {
              const pct = percent(limitRow.usage[window], limitRow.effective[window]);
              return <li key={window}>
                <div className="panel-row"><span>{t(`trust.limits.${window}` as MessageKey)}</span>
                  <strong>{t("trust.p.usage", { used: money(limitRow.usage[window], limitRow.currency), limit: money(limitRow.effective[window], limitRow.currency) })}</strong></div>
                <LevelBar value={Number(limitRow.usage[window]) || 0} after={Number(limitRow.usage[window]) || 0} max={Number(limitRow.effective[window]) || 0} tone={pct >= 90 ? "warn" : undefined} />
                <small>{t("trust.p.percent", { pct })} · {t("trust.limits.base", { amount: money(limitRow.base[window], limitRow.currency) })}</small>
              </li>;
            })}</ul>
            <p className="panel-muted">{t("trust.limits.text", { multiplier: limits.data.limit_multiplier, zone: limits.data.window_zone })}</p>
          </>)}
        <p className="panel-muted trust-rule"><TierBadge tier="T2" /> {t("trust.limits.within")} <TierBadge tier="T3" /> {t("trust.limits.over")}</p>
      </section>
      <section id="trust-approvals" className="panel-card" aria-labelledby="trust-approvals-title">
        <div className="panel-card-head"><div className="trust-head"><h3 id="trust-approvals-title" className="panel-section-title"><TierBadge tier="T3" /> {t("trust.approvals.title")}</h3>
          <PanelInfo>{t("trust.approvals.text")}</PanelInfo></div>
          <PanelPager index={approvalRows.index} count={approvalRows.pages} onChange={setApprovalPage} label={t("trust.p.approvalsPager")} /></div>
        {loading && !approvals.data ? <PanelSkeleton rows={1} /> : approvals.error ? <PanelAlert message={approvals.error} onRetry={retry} /> : approvals.data && (approvals.data.length === 0
          ? <p className="panel-muted">{t("trust.approvals.none")}</p>
          : <ul className="panel-rows">{approvalRows.rows.map((row) => <li key={row.id}>
            <span><strong>{actionName(row.action)} · {money(row.amount, row.currency)}</strong>
              <small>{row.reason ? `${row.reason} · ` : ""}{t("trust.p.expires", { date: when(row.expires_at) })}</small></span>
            <span className={`status-chip status-${row.status.toLowerCase()}`}>{t(`approval.${row.status}` as MessageKey)}</span>
          </li>)}</ul>)}
      </section>
    </div>

    <section id="trust-audit" className="panel-view" hidden={tab !== "activity"} aria-labelledby="trust-audit-title">
      <div className="panel-card-head"><div className="trust-head"><h2 id="trust-audit-title">{t("trust.audit.title")}</h2><PanelInfo>{t("trust.audit.text")}</PanelInfo></div>
        <label className="trust-filter">{t("trust.audit.filter")}
          <select value={category} onChange={(event) => { setCategory(event.target.value); setAuditPage(0); }}>
            <option value="all">{t("trust.audit.all")}</option>
            {CATEGORIES.map((name) => <option key={name} value={name}>{categoryName(name)}</option>)}
            <option value="other">{categoryName("other")}</option>
          </select>
        </label>
      </div>
      {auditError && <PanelAlert message={auditError} onRetry={retry} />}
      {loading && events.length === 0 ? <PanelSkeleton rows={4} /> : <>
        {events.length > 0 && <div className="trust-activity-top">
          <PanelHero label={t("trust.p.events")} value={String(total)} />
          <BarCompare label={t("trust.p.byCategory")} rows={categories.map(([name, count], index) => ({ key: name, label: categoryName(name), value: count, display: count, best: index === 0 }))} />
        </div>}
        {shown.length === 0 ? <PanelEmpty title={t("trust.audit.none")} /> : <table className="panel-table trust-audit-table">
          <thead><tr><th>{t("trust.audit.event")}</th><th>{t("trust.audit.time")}</th></tr></thead>
          <tbody>{auditRows.rows.map((event) => <tr key={event.id}>
            <td><strong>{eventName(event.action)}</strong><small>{eventDetails(event) || <code>{event.action}</code>}</small></td>
            <td>{when(event.created_at)}</td>
          </tr>)}</tbody>
        </table>}
        <div className="trust-pager"><PanelPager index={auditRows.index} count={auditRows.pages} onChange={setAuditPage} label={t("trust.p.pager")} /></div>
      </>}
    </section>
  </ToolPanel>;

  return <ModulePresentation className="trust-app" fullPage={(<div className="app connected service-app trust-app">
      <aside>
        <a className="brand" href="#" onClick={(event) => { event.preventDefault(); onExit(); }}><span className="brand-icon">S</span>StudyFlow<span className="brand-dot">.</span></a>
        <ModuleNav />
        <div className="journey-label">{t("trust.side.label")}</div>
        <nav aria-label={t("trust.side.nav")}>
          {(["levels", "limits", "activity"] as const).map((key) => <a key={key} href="#" aria-current={tab === key ? "page" : undefined}
            onClick={(event) => { event.preventDefault(); setTab(key); }}>{t(`trust.tab.${key}` as MessageKey)}</a>)}
        </nav>
        <div className="sidebar-note"><strong>{t("trust.side.noteTitle")}</strong><p>{t("trust.side.noteText")}</p></div>
        {!embedded && !preview && <button className="secondary" disabled={loading} onClick={() => void load()}>{t("common.refresh")}</button>}
        <button className="secondary" onClick={onExit}>{t("common.backToPlan")}</button>
      </aside>
      <div className="workspace">
        <header><span>StudyFlow / {t("trust.title")}</span><span className="avatar">ST</span></header>
        <main className="trust-full">{content}</main>
        <footer>{t("common.footer")}<span>{t("common.simulatedFooter")}</span></footer>
      </div>
    </div>)}>{content}</ModulePresentation>;
}
