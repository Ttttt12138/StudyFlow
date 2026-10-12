import { useToolRefresh, useToolActive, useClearWhenHidden, useWorkspace } from "../workspace/context";
import { ModulePresentation } from "../workspace/ModulePresentation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ModuleNav } from "../services/ModuleNav";
import { formatDate, formatMoney } from "../backend/presenters";
import { getAll } from "../backend/client";
import { intlLocale, useI18n, type MessageKey } from "../i18n";
import { TierBadge, TierLegend } from "../services/TierBadge";
import { SessionWalletClient, WalletApiError, type WalletClient } from "../wallet/client";
import { createTrustPreview } from "./previewAdapter";
import type { AuditEvent, AuditPage, CreditProfile, LimitsSummary, TrustApproval } from "./types";
import "../services/services.css";
import { CreditStatements } from "./CreditStatements";

const signInUrl = `/api/auth/login/?next=${encodeURIComponent(window.location.origin + "/?trust=1")}`;
// Audit action prefixes with their own filter; everything else is grouped under "other".
const CATEGORIES = ["auth", "approval", "agent", "credit", "payment", "remittance", "wallet", "fx", "funding"] as const;
const NAMED_EVENTS = ["auth.step_up_granted", "auth.step_up_failed", "approval.requested", "approval.approved",
  "approval.rejected", "agent.action_confirmed", "agent.action_rejected", "credit.snapshot_created",
  "credit.statement_issued"] as const;
const LEVELS = ["AT_RISK", "BUILDING", "FAIR", "GOOD"] as const;
const FACTORS = ["ON_TIME_RECORDS", "LATE_RECORDS", "OVERDUE_RECORDS", "THIN_HISTORY"] as const;
const ACTIONS = ["payment.submit", "wallet.convert", "loan.repay", "remittance.submit"] as const;

type Section<T> = { data: T | null; error: string };
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
  const toolActive = useToolActive();
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

  const when = (value: string | null | undefined) => value
    ? new Date(value).toLocaleString(intlLocale(lang), { dateStyle: "medium", timeStyle: "short" }) : "—";
  const eventName = (action: string) => (NAMED_EVENTS as readonly string[]).includes(action)
    ? t(`trust.event.${action}` as MessageKey) : t(`trust.category.${categoryOf(action)}` as MessageKey);
  const actionName = (action: string) => (ACTIONS as readonly string[]).includes(action) ? t(`trust.action.${action}` as MessageKey) : action;
  const shown = category === "all" ? events : events.filter((event) => categoryOf(event.action) === category);

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
  const staleStatus = useToolRefresh(() => load());
  const content = <>{staleStatus}
          <div className="section-heading"><div>
            <span className="eyebrow">{t("trust.eyebrow")}</span>
            <h1>{t("trust.title")}</h1>
            <p>{t("trust.intro")}</p>
          </div>
          {!preview && <button className="secondary" disabled={loading} onClick={() => void load()}>{t("common.refresh")}</button>}
          </div>
          <div className="preview-banner" role="status">
            <strong>{preview ? t("trust.preview.title") : t("common.simulatedMoney")}</strong>
            <span>{preview ? t("trust.preview.text") : t("trust.banner.text")}</span>
          </div>
          {signedOut && !preview && <div className="card service-card"><div className="service-card-body service-empty">
            <p>{t("trust.signedOut")}</p><a className="primary" href={signInUrl}>{t("common.signIn")}</a>
          </div></div>}

          <section className="card service-card" id="trust-tiers" aria-labelledby="trust-tiers-title">
            <div className="service-card-body">
              <h2 id="trust-tiers-title">{t("trust.tiers.title")}</h2>
              <p className="service-muted">{t("trust.tiers.text")}</p>
              <TierLegend />
            </div>
          </section>

          <section className="card service-card" id="trust-credit" aria-labelledby="trust-credit-title">
            <div className="service-card-body">
              <h2 id="trust-credit-title">{t("trust.credit.title")}</h2>
              {loading && !profile ? <p className="service-muted">{t("common.loading")}</p> : credit.error ? <p className="error">{credit.error}</p> : profile && <>
                <div className="trust-stats">
                  <div className={`trust-stat level-${profile.level.toLowerCase()}`}><span>{t("trust.credit.level")}</span><strong>{(LEVELS as readonly string[]).includes(profile.level) ? t(`trust.level.${profile.level}` as MessageKey) : profile.level}</strong></div>
                  <div className="trust-stat"><span>{t("trust.credit.multiplier")}</span><strong>×{profile.limit_multiplier}</strong></div>
                  <div className="trust-stat"><span>{t("trust.credit.onTime")}</span><strong>{profile.on_time}</strong></div>
                  <div className="trust-stat"><span>{t("trust.credit.late")}</span><strong>{profile.late}</strong></div>
                  <div className="trust-stat"><span>{t("trust.credit.overdue")}</span><strong>{profile.overdue}</strong></div>
                </div>
                <p className="service-muted">{t("trust.credit.multiplierText", { multiplier: profile.limit_multiplier })}</p>
                {profile.factors.length > 0 && <ul className="trust-factors">{profile.factors.map((factor) => <li key={factor.code} className={`factor-${factor.effect}`}>
                  {(FACTORS as readonly string[]).includes(factor.code) ? t(`trust.factor.${factor.code}` as MessageKey, { count: factor.count }) : `${factor.code} (${factor.count})`}
                </li>)}</ul>}
                {profile.next_level ? <p className="service-next">{t("trust.credit.next", { level: t(`trust.level.${profile.next_level.level}` as MessageKey) })}{" "}
                  {typeof profile.next_level.on_time_needed === "number" && t("trust.credit.needOnTime", { count: profile.next_level.on_time_needed })}
                  {profile.next_level.late_records_must_age_out && ` ${t("trust.credit.ageOut")}`}
                  {profile.next_level.action === "RESOLVE_OVERDUE" && t("trust.credit.resolveOverdue")}
                  {profile.next_level.action === "WAIT_FOR_LATE_RECORDS_TO_AGE_OUT" && t("trust.credit.ageOut")}</p>
                  : <p className="service-next">{t("trust.credit.top")}</p>}
                {profile.evidence.length > 0 && <details><summary>{t("trust.credit.evidence", { count: profile.evidence.length })}</summary>
                  <div className="table-scroll"><table className="service-table">
                    <thead><tr><th>{t("trust.credit.source")}</th><th>{t("trust.credit.due")}</th><th>{t("trust.credit.completed")}</th><th>{t("trust.credit.status")}</th></tr></thead>
                    <tbody>{profile.evidence.map((item) => <tr key={`${item.source}:${item.id}`}>
                      <td>{t(`trust.source.${item.source}` as MessageKey)}</td><td>{formatDate(item.due_on)}</td>
                      <td>{item.completed_on ? formatDate(item.completed_on) : "—"}</td><td>{t(`trust.evidence.${item.status}` as MessageKey)}</td>
                    </tr>)}</tbody>
                  </table></div>
                </details>}
                <p className="service-disclaimer">{t("trust.credit.disclaimer")}</p>
              </>}
            </div>
          </section>

          <CreditStatements client={client} preview={preview} />

          <section className="card service-card" id="trust-limits" aria-labelledby="trust-limits-title">
            <div className="service-card-body">
              <h2 id="trust-limits-title">{t("trust.limits.title")}</h2>
              {loading && !limits.data ? <p className="service-muted">{t("common.loading")}</p> : limits.error ? <p className="error">{limits.error}</p> : limits.data && <>
                <p className="service-muted">{t("trust.limits.text", { multiplier: limits.data.limit_multiplier, zone: limits.data.window_zone })}</p>
                {limits.data.limits.length === 0 ? <p>{t("trust.limits.none")}</p> : <div className="table-scroll"><table className="service-table">
                  <thead><tr><th>{t("trust.limits.currency")}</th><th>{t("trust.limits.perTransaction")}</th><th>{t("trust.limits.daily")}</th><th>{t("trust.limits.monthly")}</th></tr></thead>
                  <tbody>{limits.data.limits.map((row) => <tr key={row.currency}>
                    <th scope="row">{row.currency}</th>
                    <td><strong>{formatMoney(row.effective.per_transaction, row.currency)}</strong><small>{t("trust.limits.base", { amount: formatMoney(row.base.per_transaction, row.currency) })}</small></td>
                    {(["daily", "monthly"] as const).map((window) => <td key={window}>
                      <strong>{formatMoney(row.usage[window], row.currency)} / {formatMoney(row.effective[window], row.currency)}</strong>
                      <meter min={0} max={100} low={70} high={90} optimum={0} value={percent(row.usage[window], row.effective[window])} aria-label={t("trust.limits.used", { window: t(`trust.limits.${window}` as MessageKey), currency: row.currency })} />
                      <small>{t("trust.limits.base", { amount: formatMoney(row.base[window], row.currency) })}</small>
                    </td>)}
                  </tr>)}</tbody>
                </table></div>}
                <p className="service-muted"><TierBadge tier="T2" /> {t("trust.limits.within")} <TierBadge tier="T3" /> {t("trust.limits.over")}</p>
              </>}
            </div>
          </section>

          <section className="card service-card" id="trust-approvals" aria-labelledby="trust-approvals-title">
            <div className="service-card-body">
              <h2 id="trust-approvals-title"><TierBadge tier="T3" /> {t("trust.approvals.title")}</h2>
              <p className="service-muted">{t("trust.approvals.text")}</p>
              {loading && !approvals.data ? <p className="service-muted">{t("common.loading")}</p> : approvals.error ? <p className="error">{approvals.error}</p> : approvals.data && (approvals.data.length === 0
                ? <p>{t("trust.approvals.none")}</p>
                : <div className="table-scroll"><table className="service-table">
                  <thead><tr><th>{t("trust.approvals.action")}</th><th>{t("trust.approvals.amount")}</th><th>{t("trust.approvals.status")}</th><th>{t("trust.approvals.expires")}</th></tr></thead>
                  <tbody>{approvals.data.map((row) => <tr key={row.id}>
                    <td>{actionName(row.action)}{row.reason && <small>{row.reason}</small>}</td>
                    <td>{formatMoney(row.amount, row.currency)}</td>
                    <td><span className={`status-chip status-${row.status.toLowerCase()}`}>{t(`approval.${row.status}` as MessageKey)}</span></td>
                    <td>{when(row.expires_at)}</td>
                  </tr>)}</tbody>
                </table></div>)}
            </div>
          </section>

          <section className="card service-card" id="trust-audit" aria-labelledby="trust-audit-title">
            <div className="service-card-body">
              <div className="service-title-row">
                <h2 id="trust-audit-title">{t("trust.audit.title")}</h2>
                <label className="service-inline-field">{t("trust.audit.filter")}
                  <select value={category} onChange={(event) => setCategory(event.target.value)}>
                    <option value="all">{t("trust.audit.all")}</option>
                    {CATEGORIES.map((name) => <option key={name} value={name}>{t(`trust.category.${name}` as MessageKey)}</option>)}
                    <option value="other">{t("trust.category.other")}</option>
                  </select>
                </label>
              </div>
              <p className="service-muted">{t("trust.audit.text")}</p>
              {auditError && <p className="error">{auditError}</p>}
              {loading && events.length === 0 ? <p className="service-muted">{t("common.loading")}</p> : shown.length === 0 ? <p>{t("trust.audit.none")}</p> :
                <div className="table-scroll"><table className="service-table">
                  <thead><tr><th>{t("trust.audit.time")}</th><th>{t("trust.audit.event")}</th><th>{t("trust.audit.details")}</th></tr></thead>
                  <tbody>{shown.map((event) => <tr key={event.id}>
                    <td>{when(event.created_at)}</td>
                    <td><strong>{eventName(event.action)}</strong><small><code>{event.action}</code></small></td>
                    <td>{eventDetails(event) || <code>{event.entity_id.slice(0, 8)}</code>}</td>
                  </tr>)}</tbody>
                </table></div>}
              <div className="service-actions">
                <span className="service-muted">{t("trust.audit.count", { shown: events.length, total })}</span>
                {nextPage && <button className="secondary" disabled={busy} onClick={() => void loadMore()}>{t("trust.audit.more")}</button>}
              </div>
            </div>
          </section>
        </>;
  return <ModulePresentation className="trust-app" fullPage={(<div className="app connected service-app trust-app">
      <aside>
        <a className="brand" href="#" onClick={(event) => { event.preventDefault(); onExit(); }}><span className="brand-icon">S</span>StudyFlow<span className="brand-dot">.</span></a>
        <ModuleNav />
        <div className="journey-label">{t("trust.side.label")}</div>
        <nav aria-label={t("trust.side.nav")}>
          <a href="#trust-tiers">{t("trust.tiers.title")}</a>
          <a href="#trust-credit">{t("trust.credit.title")}</a>
          <a href="#trust-limits">{t("trust.limits.title")}</a>
          <a href="#trust-approvals">{t("trust.approvals.title")}</a>
          <a href="#trust-audit">{t("trust.audit.title")}</a>
        </nav>
        <div className="sidebar-note"><strong>{t("trust.side.noteTitle")}</strong><p>{t("trust.side.noteText")}</p></div>
        <button className="secondary" onClick={onExit}>{t("common.backToPlan")}</button>
      </aside>
      <div className="workspace">
        <header><span>StudyFlow / {t("trust.title")}</span><span className="avatar">ST</span></header>
        <main>{content}</main>
        <footer>{t("common.footer")}<span>{t("common.simulatedFooter")}</span></footer>
      </div>
    </div>)}>{content}</ModulePresentation>;
}
