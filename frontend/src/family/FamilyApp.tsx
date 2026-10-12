import { useToolRefresh, useToolActive, useClearWhenHidden, useWorkspace } from "../workspace/context";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ServiceShell, ServiceSection } from "../services/ServiceShell";
import { formatDate, formatMoney } from "../backend/presenters";
import { intlLocale, useI18n, type MessageKey } from "../i18n";
import { SessionWalletClient, WalletApiError, type WalletClient } from "../wallet/client";
import { loadFamily } from "./client";
import { amountProblem, canChange, canRevoke, CURRENCIES, newEconomicKey, requestStep, STEP_ORDER, statusTone } from "./logic";
import { createFamilyPreview } from "./previewAdapter";
import type { FamilySnapshot, SponsorRequest } from "./types";
import "../wallet/wallet.css";
import "./family.css";

const signInUrl = `/api/auth/login/?next=${encodeURIComponent(window.location.origin + "/?family=1")}`;
const initial: FamilySnapshot = { requests: [], errors: {} };
const lost = (reason: unknown) => reason instanceof WalletApiError && (reason.status === 0 || reason.status >= 500);
type Terms = { amount: string; currency: string; available_on: string; purpose: string };
const inTwoWeeks = () => new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
const termsOf = (r: SponsorRequest): Terms => ({ amount: r.source.amount, currency: r.source.currency, available_on: r.source.available_on, purpose: r.purpose });

export function FamilyApp({ preview, onExit }: { preview: boolean; onExit: () => void }) {
  const { lang, t } = useI18n();
  const toolActive = useToolActive();
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
      await refresh();
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

  const steps = (request: SponsorRequest) => {
    const step = requestStep(request);
    const at = STEP_ORDER.indexOf(step === "expired" ? "family" : step);
    return <ol className="family-steps" aria-label={t("family.steps.label")}>
      {STEP_ORDER.map((s, n) => <li key={s} className={at < 0 ? "" : n < at || step === "received" ? "done" : n === at ? "current" : ""} aria-current={n === at && step !== "received" ? "step" : undefined}>
        {t(`family.step.${s}` as MessageKey)}</li>)}
    </ol>;
  };

  const sections = [
    { id: "family-requests", label: t("family.requests.title") }, { id: "family-create", label: t("family.create.title") },
    { id: "family-how", label: t("family.how.title") },
  ];

  const staleStatus = useToolRefresh(() => refresh());
  return (
    <ServiceShell className="family-app" eyebrow={t("family.eyebrow")} title={t("family.title")} intro={t("family.intro")} sideLabel={t("family.side.label")}
      sections={sections} noteTitle={t("family.side.noteTitle")} noteText={t("family.side.noteText")} preview={preview}
      previewTitle={t("family.preview.title")} previewText={t("family.preview.text")} bannerText={t("family.banner.text")}
      signedOut={signedOut} signInUrl={signInUrl} signedOutText={t("family.signedOut")} onExit={onExit}
      onRefresh={() => void refresh()} refreshing={loading || busy}>
      {staleStatus}
      {loading && <div className="activity" role="status"><span className="activity-dot" aria-hidden="true" />{t("common.loading")}</div>}
      {error && <div className="stale-banner" role="alert">{error}</div>}
      {notice && <div className="demo" role="status">{notice}</div>}

      <ServiceSection id="family-requests" title={t("family.requests.title")} text={t("family.requests.text")}>
        {snapshot.errors.requests && !signedOut && <p className="error">{snapshot.errors.requests}</p>}
        {snapshot.requests.length === 0 ? <p>{t("family.requests.none")}</p> : <div className="family-stack">
          {snapshot.requests.map((request) => {
            const step = requestStep(request);
            return <article key={request.id} className="family-item" aria-labelledby={`req-${request.id}`}>
              <div className="service-title-row">
                <h3 id={`req-${request.id}`}>{request.purpose}</h3>
                {chip(request.status)}
              </div>
              <dl className="comparison-facts">
                <div><dt>{t("family.req.amount")}</dt><dd>{money(request.source.amount, request.source.currency)}</dd></div>
                <div><dt>{t("family.req.availableOn")}</dt><dd>{date(request.source.available_on)}</dd></div>
                <div><dt>{t("family.req.counts")}</dt><dd>{t(request.source.received ? "family.req.countsReceived" : request.source.certainty === "confirmed" ? "family.req.countsConfirmed" : "family.req.countsEstimate")}</dd></div>
                <div><dt>{t("family.req.terms")}</dt><dd>{t("family.req.termsValue", { version: request.terms_version })}</dd></div>
                <div><dt>{t("family.req.linkExpires")}</dt><dd>{when(request.token_expires_at)}</dd></div>
                <div><dt>{t("family.req.confirmedAt")}</dt><dd>{when(request.confirmed_at)}</dd></div>
                <div><dt>{t("family.req.reference")}</dt><dd><code>{request.source.economic_key}</code></dd></div>
              </dl>
              {steps(request)}
              <p className={step === "rejected" || step === "expired" ? "service-alert" : "service-notice"}>{t(`family.next.${step}` as MessageKey)}</p>
              {canChange(request) && editId !== request.id && revokeId !== request.id && <div className="service-actions">
                <button className="secondary" disabled={preview || busy} onClick={() => startEdit(request)}>{t("family.revise.button")}</button>
                {canRevoke(request) && <button className="secondary" disabled={preview || busy} onClick={() => { setRevokeId(request.id); setEditId(""); }}>{t("family.revoke.button")}</button>}
              </div>}
              {!canChange(request) && <p className="service-muted">{t("family.req.immutable")}</p>}
              {editId === request.id && <form className="service-policy" aria-label={t("family.revise.label")} onSubmit={(e) => { e.preventDefault(); void revise(request, "revise"); }}>
                <h4>{t("family.revise.title")}</h4>
                <p>{t("family.revise.text")}</p>
                <div className="wallet-form-row family-form">{fields(edit, setEdit, `edit-${request.id}`)}</div>
                <label className="wallet-confirm"><input type="checkbox" checked={reviseCheck} disabled={preview} onChange={(e) => setReviseCheck(e.target.checked)} />{t("family.revise.check")}</label>
                <div className="service-actions">
                  <button type="submit" className="primary" disabled={preview || busy || !reviseCheck}>{t("family.revise.submit")}</button>
                  <button type="button" className="secondary" disabled={busy} onClick={() => setEditId("")}>{t("family.cancel")}</button>
                </div>
              </form>}
              {revokeId === request.id && <div className="service-policy" role="group" aria-label={t("family.revoke.label")}>
                <p>{t("family.revoke.confirm")}</p>
                <div className="service-actions">
                  <button className="primary" disabled={preview || busy} onClick={() => void revise(request, "revoke")}>{t("family.revoke.yes")}</button>
                  <button className="secondary" disabled={busy} onClick={() => setRevokeId("")}>{t("family.cancel")}</button>
                </div>
              </div>}
            </article>;
          })}
        </div>}
      </ServiceSection>

      <ServiceSection id="family-create" title={t("family.create.title")} text={t("family.create.text")}>
        <form className="wallet-form-row family-form" onSubmit={(event) => { event.preventDefault(); void create(); }}>
          {fields(form, setForm, "new")}
          <button type="submit" className="primary" disabled={preview || busy}>{t("family.create.button")}</button>
        </form>
        <p className="service-muted">{t("family.create.hint")}{form.currency === "JPY" && ` ${t("family.create.jpy")}`}</p>
      </ServiceSection>

      <ServiceSection id="family-how" title={t("family.how.title")}>
        <ol className="family-how">
          <li>{t("family.how.1")}</li><li>{t("family.how.2")}</li><li>{t("family.how.3")}</li><li>{t("family.how.4")}</li>
        </ol>
      </ServiceSection>
    </ServiceShell>
  );
}
