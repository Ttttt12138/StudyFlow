import { useToolRefresh, useEmbedded } from "../workspace/context";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ServiceShell } from "../services/ServiceShell";
import { formatDate, formatMoney } from "../backend/presenters";
import { intlLocale, useI18n, type MessageKey } from "../i18n";
import { SessionWalletClient, WalletApiError, type WalletClient } from "../wallet/client";
import { PanelAlert, PanelEmpty, PanelFacts, PanelHero, PanelInfo, PanelPager, PanelSheet, PanelSkeleton, ToolPanel } from "../workspace/ToolPanel";
import { StackBar, StepTrack } from "../workspace/PanelCharts";
import { loadFamily } from "./client";
import { amountProblem, canChange, canRevoke, CURRENCIES, newEconomicKey, requestStep, STEP_ORDER, statusTone } from "./logic";
import { createFamilyPreview } from "./previewAdapter";
import type { FamilySnapshot, SponsorRequest } from "./types";
import "../wallet/wallet.css";
import "./family.css";

const signInUrl = `/auth?next=${encodeURIComponent(window.location.origin + "/?family=1")}`;
const initial: FamilySnapshot = { requests: [], errors: {} };
const lost = (reason: unknown) => reason instanceof WalletApiError && (reason.status === 0 || reason.status >= 500);
type Terms = { amount: string; currency: string; available_on: string; purpose: string };
type Tab = "requests" | "supported" | "invite";
const inTwoWeeks = () => new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
const termsOf = (r: SponsorRequest): Terms => ({ amount: r.source.amount, currency: r.source.currency, available_on: r.source.available_on, purpose: r.purpose });
// Requests the family has confirmed (or that were received) count as support; the rest are still being asked.
const isSupported = (r: SponsorRequest) => r.status === "CONFIRMED" || r.status === "RECEIVED";
const RANK: Record<string, number> = { PENDING: 0, CONFIRMED: 0, EXPIRED: 1, REJECTED: 1, RECEIVED: 1, REVOKED: 2 };
const ordered = (rows: SponsorRequest[]) => [...rows].sort((a, b) => (RANK[a.status] ?? 3) - (RANK[b.status] ?? 3) || b.created_at.localeCompare(a.created_at));

export function FamilyApp({ preview, onExit }: { preview: boolean; onExit: () => void }) {
  const { lang, t } = useI18n();
  const embedded = useEmbedded();
  const client = useMemo<WalletClient>(() => preview ? createFamilyPreview() : new SessionWalletClient(), [preview]);
  const [snapshot, setSnapshot] = useState<FamilySnapshot>(initial);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState<Terms>(() => ({ amount: "", currency: "CNY", available_on: inTwoWeeks(), purpose: "" }));
  const [editId, setEditId] = useState("");
  const [edit, setEdit] = useState<Terms>({ amount: "", currency: "THB", available_on: "", purpose: "" });
  const [reviseCheck, setReviseCheck] = useState(false);
  const [revokeId, setRevokeId] = useState("");
  const [tab, setTab] = useState<Tab>("requests");
  const [openId, setOpenId] = useState("");
  const [supportId, setSupportId] = useState("");
  // Kept until Django confirms the request, so a retry after a lost response reuses the same reference.
  const pendingKey = useRef("");

  const money = (value: unknown, currency: string) => formatMoney(value, currency, lang);
  const date = (value: unknown) => formatDate(value, lang);
  const when = (value: string | null) => value ? new Date(value).toLocaleString(intlLocale(lang), { dateStyle: "medium", timeStyle: "short" }) : "—";
  const message = (reason: unknown) => reason instanceof Error ? reason.message : t("shell.err.generic");
  const signedOut = !preview && /^HTTP (401|403):/.test(snapshot.errors.requests ?? "") && snapshot.requests.length === 0;

  const refresh = useCallback(async (api = client) => {
    setLoading(true);
    const result = await loadFamily(api);
    setSnapshot(result); setLoading(false);
    return result;
  }, [client]);

  useEffect(() => {
    setError(""); setNotice("");
    void refresh().catch((reason: unknown) => { setError(message(reason)); setLoading(false); });
  }, [refresh]);

  async function perform(action: () => Promise<void>) {
    if (preview) return;
    setBusy(true); setError(""); setNotice("");
    try { await action(); }
    catch (reason) {
      if (reason instanceof WalletApiError && reason.status === 409) {
        await refresh().catch(() => {});
        setError(t("shell.err.changed"));
      } else if (reason instanceof WalletApiError && reason.code === "RECEIVED_SUPPORT_IS_IMMUTABLE") {
        await refresh().catch(() => {}); setEditId(""); setRevokeId("");
        setError(`${reason.message} ${t("family.err.received")}`);
      } else setError(message(reason));
    } finally { setBusy(false); }
  }

  function problem(terms: Terms) {
    const amount = amountProblem(terms.amount, terms.currency);
    if (amount) return t(`family.err.amount.${amount}` as MessageKey);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(terms.available_on)) return t("family.err.date");
    if (!terms.purpose.trim() || terms.purpose.trim().length > 500) return t("family.err.purpose");
    return "";
  }

  async function create() {
    const invalid = problem(form);
    if (invalid) { setError(invalid); setNotice(""); return; }
    if (!pendingKey.current) pendingKey.current = newEconomicKey(form.purpose);
    const economic_key = pendingKey.current;
    const body = { economic_key, amount: form.amount.trim(), currency: form.currency, available_on: form.available_on, purpose: form.purpose.trim() };
    await perform(async () => {
      try { await client.post<SponsorRequest>("sponsor-requests/", body, "sponsor-request"); }
      catch (reason) {
        // The reference is unique per student, so after a lost response it finds the request if Django stored it.
        if (lost(reason)) {
          const found = (await refresh()).requests.some((r) => r.source.economic_key === economic_key);
          if (!found) { setError(t("shell.err.lost")); return; }
        } else throw reason;
      }
      pendingKey.current = "";
      const result = await refresh();
      const created = result.requests.find((r) => r.source.economic_key === economic_key);
      if (created) { setOpenId(created.id); setTab("requests"); }
      setForm({ amount: "", currency: form.currency, available_on: inTwoWeeks(), purpose: "" });
      setNotice(t("family.notice.created", { reference: economic_key }));
    });
  }

  function startEdit(request: SponsorRequest) { setEditId(request.id); setEdit(termsOf(request)); setReviseCheck(false); setRevokeId(""); }

  async function revise(request: SponsorRequest, action: "revise" | "revoke") {
    if (action === "revise") { const invalid = problem(edit); if (invalid) { setError(invalid); setNotice(""); return; } }
    const body = action === "revise"
      ? { terms_version: request.terms_version, action, amount: edit.amount.trim(), currency: edit.currency, available_on: edit.available_on, purpose: edit.purpose.trim() }
      : { terms_version: request.terms_version, action };
    await perform(async () => {
      try { await client.post<SponsorRequest>(`sponsor-requests/${request.id}/revise/`, body, `sponsor-${action}:${request.id}:${request.terms_version}`); }
      catch (reason) {
        // A stored revision bumps terms_version, which the refresh shows.
        if (!(lost(reason) && (await refresh()).requests.some((r) => r.id === request.id && r.terms_version > request.terms_version))) throw reason;
      }
      await refresh(); setEditId(""); setRevokeId(""); setReviseCheck(false);
      // A revised request asks again, so it is followed back to the requests tab.
      if (action === "revise") { setOpenId(request.id); setTab("requests"); }
      setNotice(t(action === "revise" ? "family.notice.revised" : "family.notice.revoked"));
    });
  }

  const chip = (status: string) => <span className={`status-chip status-${statusTone(status)}`}>{t(`family.status.${status}` as MessageKey)}</span>;
  const currencyOptions = (current: string) => [...new Set([...CURRENCIES, current])].map((c) => <option key={c} value={c}>{c}</option>);
  const fields = (terms: Terms, set: (next: Terms) => void, prefix: string) => <>
    <label>{t("family.form.amount")}<input id={`${prefix}-amount`} inputMode="decimal" value={terms.amount} disabled={preview} placeholder={terms.currency === "JPY" ? "100000" : "5000.00"}
      onChange={(e) => set({ ...terms, amount: e.target.value })} /></label>
    <label>{t("family.form.currency")}<select value={terms.currency} disabled={preview} onChange={(e) => set({ ...terms, currency: e.target.value })}>{currencyOptions(terms.currency)}</select></label>
    <label>{t("family.form.availableOn")}<input type="date" value={terms.available_on} disabled={preview} onChange={(e) => set({ ...terms, available_on: e.target.value })} /></label>
    <label className="family-wide">{t("family.form.purpose")}<input value={terms.purpose} maxLength={500} disabled={preview} onChange={(e) => set({ ...terms, purpose: e.target.value })} /></label>
  </>;

  /** Where the request stands: done steps in mint, a declined/expired/withdrawn request stops in red. */
  const track = (request: SponsorRequest) => {
    const step = requestStep(request);
    const current = step === "received" ? STEP_ORDER.length
      : step === "rejected" || step === "expired" ? 1
      : step === "revoked" ? (request.token_expires_at ? 1 : 0) : STEP_ORDER.indexOf(step);
    return <StepTrack steps={STEP_ORDER.map((s) => t(`family.step.${s}` as MessageKey))} current={current}
      failed={step === "rejected" || step === "expired" || step === "revoked"} label={t("family.steps.label")} />;
  };

  const card = (request: SponsorRequest, compact: boolean) => {
    const step = requestStep(request);
    return <article className="panel-card family-card" aria-labelledby={`req-${request.id}`}>
      <div className="panel-card-head"><h3 id={`req-${request.id}`}>{request.purpose}</h3>{chip(request.status)}</div>
      <PanelHero label={t("family.p.amount")} value={money(request.source.amount, request.source.currency)} />
      {track(request)}
      <p className={`panel-note${step === "rejected" || step === "expired" ? " is-warn" : ""}`}>{t(`family.next.${step}` as MessageKey)}</p>
      <PanelFacts items={[
        [t("family.req.availableOn"), date(request.source.available_on)],
        [t("family.req.counts"), t(request.source.received ? "family.req.countsReceived" : request.source.certainty === "confirmed" ? "family.req.countsConfirmed" : "family.req.countsEstimate")],
        ...(compact ? [] : [[t("family.req.linkExpires"), when(request.token_expires_at)], [t("family.req.confirmedAt"), when(request.confirmed_at)]] as [ReactNode, ReactNode][]),
      ]} />
      <small className="panel-muted family-ref">{t("family.p.reference", { reference: request.source.economic_key, version: request.terms_version })}</small>
      {!canChange(request) && <p className="panel-muted">{t("family.req.immutable")}</p>}
      {revokeId === request.id && <p className="panel-note is-warn" role="group" aria-label={t("family.revoke.label")}>{t("family.revoke.confirm")}</p>}
    </article>;
  };

  const actions = (request: SponsorRequest | undefined) => !request || !canChange(request) ? null : revokeId === request.id ? <>
      <button className="secondary" disabled={busy} onClick={() => setRevokeId("")}>{t("family.cancel")}</button>
      <button className="primary" disabled={preview || busy} onClick={() => void revise(request, "revoke")}>{t("family.revoke.yes")}</button>
    </> : <>
      {canRevoke(request) && <button className="secondary" disabled={preview || busy} onClick={() => { setRevokeId(request.id); setEditId(""); }}>{t("family.revoke.button")}</button>}
      <button className="primary" disabled={preview || busy} onClick={() => startEdit(request)}>{t("family.revise.button")}</button>
    </>;

  const open = ordered(snapshot.requests.filter((r) => !isSupported(r)));
  const supported = ordered(snapshot.requests.filter(isSupported));
  const openShown = open.find((r) => r.id === openId) ?? open[0];
  const supportShown = supported.find((r) => r.id === supportId) ?? supported[0];
  const editing = snapshot.requests.find((r) => r.id === editId);

  // Per currency, the amounts asked, confirmed and received as Django reports them; currencies are never mixed.
  const totals = new Map<string, { awaiting: number; confirmed: number; received: number }>();
  for (const r of snapshot.requests) {
    if (r.status === "REJECTED" || r.status === "REVOKED") continue;
    const row = totals.get(r.source.currency) ?? { awaiting: 0, confirmed: 0, received: 0 };
    const amount = Number(r.source.amount) || 0;
    if (r.status === "RECEIVED" || r.source.received) row.received += amount;
    else if (r.status === "CONFIRMED") row.confirmed += amount;
    else row.awaiting += amount;
    totals.set(r.source.currency, row);
  }
  const fixed = (currency: string, n: number) => money(currency === "JPY" ? n.toFixed(0) : n.toFixed(2), currency);

  const footer = tab === "requests" ? <>
      {open.length === 0 && <button type="button" className="primary" onClick={() => setTab("invite")}>{t("family.tab.invite")}</button>}
      {actions(openShown)}
    </>
    : tab === "supported" ? actions(supportShown)
    : <button type="submit" form="family-create-form" className="primary" disabled={preview || busy}>{t("family.create.button")}</button>;

  const reviseSheet = editing && <PanelSheet title={t("family.revise.title")} onClose={() => setEditId("")}
    footer={<><button type="button" className="secondary" disabled={busy} onClick={() => setEditId("")}>{t("family.cancel")}</button>
      <button type="submit" form="family-revise-form" className="primary" disabled={preview || busy || !reviseCheck}>{t("family.revise.submit")}</button></>}>
    <form id="family-revise-form" className="panel-sheet-stack" aria-label={t("family.revise.label")} onSubmit={(e) => { e.preventDefault(); void revise(editing, "revise"); }}>
      <p className="panel-muted">{t("family.revise.text")}</p>
      <div className="panel-form family-form">{fields(edit, setEdit, `edit-${editing.id}`)}</div>
      <label className="panel-check"><input type="checkbox" checked={reviseCheck} disabled={preview} onChange={(e) => setReviseCheck(e.target.checked)} />{t("family.revise.check")}</label>
      {error && <p className="panel-note is-warn" role="alert">{error}</p>}
    </form>
  </PanelSheet>;

  const listError = snapshot.errors.requests && !signedOut && <PanelAlert message={snapshot.errors.requests} onRetry={preview ? undefined : () => void refresh()} />;
  const simulatedTag = <span className="panel-tag">{t("common.simulatedMoney")}</span>;

  const staleStatus = useToolRefresh(() => refresh());
  return (
    <ServiceShell className="family-app" eyebrow={t("family.eyebrow")} title={t("family.title")} intro={t("family.intro")} sideLabel={t("family.side.label")}
      sections={[]} noteTitle={t("family.side.noteTitle")} noteText={t("family.side.noteText")} preview={preview}
      previewTitle={t("family.preview.title")} previewText={t("family.preview.text")} bannerText={t("family.banner.text")}
      signedOut={signedOut} signInUrl={signInUrl} signedOutText={t("family.signedOut")} onExit={onExit}
      onRefresh={embedded ? undefined : () => void refresh()} refreshing={loading || busy}>
      {staleStatus}
      <ToolPanel label={t("family.title")} numbered={false} active={tab} onSelect={(key) => { setTab(key); setRevokeId(""); }}
        steps={[{ key: "requests", label: t("family.tab.requests") }, { key: "supported", label: t("family.tab.supported") }, { key: "invite", label: t("family.tab.invite") }]}
        notices={((error && !editing) || notice) && <>
          {error && !editing && <div className="stale-banner" role="alert">{error}</div>}
          {notice && <div className="demo" role="status">{notice}</div>}</>}
        footer={footer} sheet={reviseSheet}>

        <section id="family-requests" className="panel-view" hidden={tab !== "requests"} aria-labelledby="family-requests-title">
          <div className="panel-card-head"><div className="family-head"><h2 id="family-requests-title">{t("family.requests.title")}</h2><PanelInfo>{t("family.requests.text")}</PanelInfo></div>
            <PanelPager index={openShown ? open.indexOf(openShown) : 0} count={open.length} onChange={(n) => { setOpenId(open[n].id); setRevokeId(""); }} label={t("family.p.pager")} /></div>
          {listError}
          {loading && snapshot.requests.length === 0 ? <PanelSkeleton rows={4} /> : openShown ? card(openShown, false)
            : <PanelEmpty title={snapshot.requests.length === 0 ? t("family.requests.none") : t("family.p.noneOpen")} text={t("family.p.noneOpenText")} />}
        </section>

        <section id="family-supported" className="panel-view" hidden={tab !== "supported"} aria-labelledby="family-supported-title">
          <div className="panel-card-head"><h2 id="family-supported-title">{t("family.p.supportedTitle")}</h2>
            {supported.length > 1 ? <PanelPager index={supportShown ? supported.indexOf(supportShown) : 0} count={supported.length} onChange={(n) => { setSupportId(supported[n].id); setRevokeId(""); }} label={t("family.p.pager")} /> : simulatedTag}</div>
          {listError}
          {loading && snapshot.requests.length === 0 ? <PanelSkeleton rows={4} /> : supportShown ? card(supportShown, true)
            : <PanelEmpty title={t("family.p.noneSupported")} text={t("family.p.noneSupportedText")} />}
          {totals.size > 0 && <div className="family-totals">
            <h3 className="panel-section-title">{t("family.p.byCurrency")}</h3>
            {[...totals].map(([currency, row]) => <div key={currency} className="family-total">
              <strong>{currency}</strong>
              <StackBar label={t("family.p.stack", { currency })} parts={[
                { key: "received", value: row.received, tone: "mint" as const, label: t("family.p.received", { amount: fixed(currency, row.received) }) },
                { key: "confirmed", value: row.confirmed, tone: "muted" as const, label: t("family.p.confirmed", { amount: fixed(currency, row.confirmed) }) },
                { key: "awaiting", value: row.awaiting, tone: "gold" as const, label: t("family.p.awaiting", { amount: fixed(currency, row.awaiting) }) },
              ].filter((part) => part.value > 0)} />
            </div>)}
          </div>}
        </section>

        <section id="family-create" className="panel-view" hidden={tab !== "invite"} aria-labelledby="family-create-title">
          <div className="panel-card-head"><div className="family-head"><h2 id="family-create-title">{t("family.create.title")}</h2><PanelInfo>{t("family.create.text")}</PanelInfo></div>{simulatedTag}</div>
          <form id="family-create-form" className="panel-form family-form" onSubmit={(event) => { event.preventDefault(); void create(); }}>
            {fields(form, setForm, "new")}
          </form>
          <p className="panel-muted">{t("family.create.hint")}{form.currency === "JPY" && ` ${t("family.create.jpy")}`}</p>
          <div className="family-how-block">
            <h3 className="panel-section-title">{t("family.how.title")}</h3>
            <ol className="family-how">
              <li>{t("family.how.1")}</li><li>{t("family.how.2")}</li><li>{t("family.how.3")}</li><li>{t("family.how.4")}</li>
            </ol>
          </div>
        </section>
      </ToolPanel>
    </ServiceShell>
  );
}
