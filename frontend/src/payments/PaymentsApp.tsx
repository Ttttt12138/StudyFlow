import { FocusDialog } from "../workspace/FocusDialog";
import { useToolRefresh, useToolActive, useClearWhenHidden, useWorkspace } from "../workspace/context";
import { ModulePresentation } from "../workspace/ModulePresentation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ModuleNav } from "../services/ModuleNav";
import { Amount } from "../services/Amount";
import { TierBadge } from "../services/TierBadge";
import { formatDate, formatMoney } from "../backend/presenters";
import { intlLocale, useI18n, type MessageKey } from "../i18n";
import { SessionWalletClient, WalletApiError, type WalletClient } from "../wallet/client";
import { loadPayments } from "./client";
import { currentPlan, invoiceOf, MILESTONES, payability, paymentApproval, paymentAudit, paymentStage, railState } from "./logic";
import { createPaymentsPreview, previewStatuses, type PaymentPreviewScenario } from "./previewAdapter";
import type { Payment, PaymentApproval, PaymentsSnapshot } from "./types";
import "../wallet/wallet.css";
import "../services/services.css";
import "./payments.css";

const signInUrl = `/auth?next=${encodeURIComponent(window.location.origin + "/?payments=1")}`;
const initial: PaymentsSnapshot = { state: null, plans: [], beneficiaries: [], payments: [], approvals: [], ledger: [], audit: [], errors: {} };
const KNOWN_EVENTS = ["payment.created", "payment.authorized", "payment.authorization_revoked", "payment.mock_submitted",
  "payment.mock_settled", "payment.mock_failed", "payment.mock_unknown", "payment.reconciled", "payment.invoice_mismatch",
  "auth.step_up_granted", "auth.step_up_failed", "approval.requested", "approval.approved", "approval.rejected"];

export function PaymentsApp({ preview, onExit }: { preview: boolean; onExit: () => void }) {
  const { lang, t } = useI18n();
  const toolActive = useToolActive();
  const [scenario, setScenario] = useState<PaymentPreviewScenario>("draft");
  const client = useMemo<WalletClient>(() => preview ? createPaymentsPreview(scenario) : new SessionWalletClient(), [preview, scenario]);
  const [snapshot, setSnapshot] = useState<PaymentsSnapshot>(initial);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [eventId, setEventId] = useState("");
  const [checked, setChecked] = useState(false);
  const [policy, setPolicy] = useState<"" | "STEP_UP_REQUIRED" | "APPROVAL_REQUIRED">("");
  const [lostSubmit, setLostSubmit] = useState(false);
  const [reason, setReason] = useState(() => t("pay.policy.reasonDefault"));
  const passwordRef = useRef<HTMLInputElement>(null);
  const policyRef = useRef<HTMLDivElement>(null);

  const currency = snapshot.state?.assets.currency ?? "THB";
  const money = (value: unknown, code = currency) => formatMoney(value, code, lang);
  const date = (value: unknown) => formatDate(value, lang);
  const when = (value: string | null | undefined) => value
    ? new Date(value).toLocaleString(intlLocale(lang), { dateStyle: "medium", timeStyle: "short" }) : "—";
  const message = (reason: unknown) => reason instanceof Error ? reason.message : t("pay.err.generic");
  const signedOut = !preview && /^HTTP (401|403):/.test(snapshot.errors.state ?? snapshot.errors.payments ?? "") && !snapshot.state;

  const plan = currentPlan(snapshot.plans, snapshot.state);
  const costs = snapshot.state?.estimated_expenses ?? [];
  const obligations = snapshot.state?.confirmed_obligations ?? [];
  const selected = snapshot.payments.find((p) => p.id === selectedId) ?? snapshot.payments[0] ?? null;
  const stage = selected ? paymentStage(selected) : null;
  const approval: PaymentApproval | null = selected ? paymentApproval(selected, snapshot.approvals) : null;
  const payee = (id: string | undefined) => snapshot.beneficiaries.find((b) => b.id === id);
  const obligationFor = (payment: Payment) => obligations.find((o) => o.id === payment.event_id);
  const label = (id: string) => obligations.find((o) => o.id === id)?.label ?? id;

  const refresh = useCallback(async (api = client) => {
    setLoading(true);
    const result = await loadPayments(api);
    setSnapshot(result);
    setSelectedId((prior) => result.payments.some((p) => p.id === prior) ? prior : result.payments[0]?.id ?? "");
    setLoading(false);
    return result;
  }, [client]);

  useEffect(() => {
    setError(""); setNotice(""); setPolicy(""); setLostSubmit(false); setChecked(false);
    void refresh().catch((reason: unknown) => { setError(message(reason)); setLoading(false); });
  }, [refresh]);
  // The policy panel opens below the payment; move focus there for keyboard and screen-reader users.
  useEffect(() => {
    if (toolActive && policy === "STEP_UP_REQUIRED") passwordRef.current?.focus();
    else if (toolActive && policy === "APPROVAL_REQUIRED") policyRef.current?.focus();
  }, [policy]);

  useClearWhenHidden(() => { if (passwordRef.current) passwordRef.current.value = ""; setPolicy(""); });
  async function perform(action: () => Promise<void>) {
    if (preview) return;
    setBusy(true); setError(""); setNotice("");
    try { await action(); }
    catch (reason) {
      if (reason instanceof WalletApiError && reason.status === 409) {
        await refresh().catch(() => {});
        setError(t("pay.err.changed"));
      } else setError(message(reason));
    } finally { setBusy(false); }
  }

  function select(id: string) {
    setSelectedId(id); setChecked(false); setPolicy(""); setLostSubmit(false);
  }

  async function createPayment() {
    const event = obligations.find((o) => o.id === eventId);
    if (!plan.plan || plan.issue || !event?.beneficiary_id) return;
    await perform(async () => {
      const body = { readiness_plan_id: plan.plan!.id, event_id: event.id, beneficiary_id: event.beneficiary_id };
      let created: Payment;
      try { created = await client.post<Payment>("payments/", body, `create-payment:${plan.plan!.id}:${event.id}`); }
      catch (reason) {
        // A lost response may still have created it; the active-payment-per-expense rule makes the lookup exact.
        if (reason instanceof WalletApiError && (reason.status === 0 || reason.status >= 500)) {
          const result = await refresh();
          const existing = result.payments.find((p) => p.event_id === event.id && !["failed", "cancelled", "expired"].includes(p.status));
          if (existing) { select(existing.id); setNotice(t("pay.notice.created")); return; }
        }
        throw reason;
      }
      await refresh(); select(created.id); setEventId("");
      setNotice(t("pay.notice.created"));
    });
  }

  async function authorize(payment: Payment) {
    if (!snapshot.state) return;
    const version = snapshot.state.state_version;
    await perform(async () => {
      await client.post<Payment>(`payments/${payment.id}/authorize/`, { state_version: version, expires_in_seconds: 900 }, `authorize-payment:${payment.id}:${version}`);
      await refresh(); setChecked(false);
      setNotice(t("pay.notice.authorized"));
    });
  }

  async function cancel(payment: Payment) {
    await perform(async () => {
      await client.post<Payment>(`payments/${payment.id}/cancel/`, {}, `cancel-payment:${payment.id}`);
      await refresh(); setPolicy("");
      setNotice(t("pay.notice.cancelled"));
    });
  }

  async function sendSubmit(payment: Payment, token = "") {
    const updated = await client.post<Payment>(`payments/${payment.id}/submit/`, {}, `submit-payment:${payment.id}`, token ? { "X-Step-Up-Token": token } : {});
    await refresh();
    setPolicy(""); setLostSubmit(false); setChecked(false);
    setNotice(t("pay.notice.submitted", { status: t(`pay.status.${updated.status}` as MessageKey) }));
  }

  function policyDenial(reason: unknown) {
    if (!(reason instanceof WalletApiError)) return false;
    if (reason.code === "APPROVAL_REQUIRED") { setPolicy("APPROVAL_REQUIRED"); setError(t("pay.err.approvalRequired")); return true; }
    if (["STEP_UP_REQUIRED", "STEP_UP_INVALID"].includes(reason.code)) { setPolicy("STEP_UP_REQUIRED"); setError(t("pay.err.stepUpRequired")); return true; }
    if (reason.status === 0 || reason.status >= 500) { setLostSubmit(true); setError(t("pay.err.lostSubmit")); return true; }
    return false;
  }

  async function submit(payment: Payment) {
    await perform(async () => {
      try { await sendSubmit(payment); }
      catch (reason) { if (!policyDenial(reason)) throw reason; }
    });
  }

  async function stepUpAndSubmit(payment: Payment) {
    const password = passwordRef.current?.value ?? "";
    if (!password) { setError(t("pay.err.password")); return; }
    passwordRef.current!.value = "";
    await perform(async () => {
      const grant = await client.post<{ token: string }>("auth/step-up/", { password, action: "payment.submit", target_id: payment.id, amount: payment.amount, currency }, `step-up:${payment.id}`);
      // The single-use grant lives only in this call stack, never in React state or storage.
      try { await sendSubmit(payment, grant.token); }
      catch (reason) {
        if (reason instanceof WalletApiError && (reason.status === 0 || reason.status >= 500)) { setLostSubmit(true); setError(t("pay.err.lostStepUp")); return; }
        throw reason;
      }
    });
  }

  async function requestApproval(payment: Payment) {
    await perform(async () => {
      await client.post<PaymentApproval>("approvals/", { action: "payment.submit", target_id: payment.id, amount: payment.amount, currency, reason }, `approval:${payment.id}`);
      setPolicy(""); await refresh(); setNotice(t("pay.notice.approvalRequested"));
    });
  }

  async function reconcile(payment: Payment) {
    await perform(async () => {
      const updated = await client.post<Payment>(`payments/${payment.id}/reconcile/`, {}, `reconcile-payment:${payment.id}`);
      await refresh();
      setNotice(t(updated.status === "reconciled" ? "pay.notice.reconciled" : "pay.notice.exception"));
    });
  }

  const auditName = (action: string) => KNOWN_EVENTS.includes(action) ? t(`pay.event.${action}` as MessageKey) : action;
  const actor = (details: Record<string, unknown>) => typeof details.actor_id === "number" || typeof details.actor_id === "string"
    ? t("pay.audit.actor", { id: String(details.actor_id) }) : "";
  const ledgerRow = selected ? snapshot.ledger.find((entry) => entry.payment === selected.id) : undefined;
  const trail = selected ? paymentAudit(selected, snapshot.audit, snapshot.approvals) : [];
  const states = obligations.map((o) => payability(o, costs, snapshot.beneficiaries, snapshot.payments));
  const readyEvents = states.filter((state) => state === "READY");
  const unpaid = states.some((state) => state !== "SETTLED" && state !== "HAS_PAYMENT");

  const staleStatus = useToolRefresh(() => refresh());
  const content = <>{staleStatus}
          <div className="section-heading"><div>
            <span className="eyebrow">{t("pay.eyebrow")}</span>
            <h1>{t("pay.title")}</h1>
            <p>{t("pay.intro")}</p>
          </div>
          {!preview && <button className="secondary" disabled={loading || busy} onClick={() => void refresh()}>{t("common.refresh")}</button>}
          </div>
          <div className="preview-banner" role="status">
            <strong>{preview ? t("pay.preview.title") : t("common.simulatedMoney")}</strong>
            <span>{preview ? t("pay.preview.text") : t("pay.banner.text")}</span>
          </div>
          {preview && <div className="wallet-controls"><label htmlFor="pay-scenario">{t("pay.preview.status")}</label>
            <select id="pay-scenario" value={scenario} onChange={(event) => setScenario(event.target.value as PaymentPreviewScenario)}>
              {previewStatuses.map((value) => <option key={value} value={value}>{t(`pay.status.${value}` as MessageKey)}</option>)}
            </select></div>}
          {loading && <div className="activity" role="status"><span className="activity-dot" aria-hidden="true" />{t("common.loading")}</div>}
          {error && !policy && <div className="stale-banner" role="alert">{error}</div>}
          {notice && <div className="demo" role="status">{notice}</div>}
          {signedOut && <div className="card service-card"><div className="service-card-body service-empty">
            <p>{t("pay.signedOut")}</p><a className="primary" href={signInUrl}>{t("common.signIn")}</a>
          </div></div>}

          <section className="card service-card" id="pay-bills" aria-labelledby="pay-bills-title">
            <div className="service-card-body">
              <div className="service-title-row">
                <h2 id="pay-bills-title"><TierBadge tier="T1" /> {t("pay.bills.title")}</h2>
                {snapshot.state?.assets.wallet_balance != null && <span className="service-muted">{t("pay.bills.balance", { amount: money(snapshot.state.assets.wallet_balance) })}</span>}
              </div>
              <p className="service-muted">{t("pay.bills.text")}</p>
              {snapshot.errors.state && !signedOut && <p className="error">{snapshot.errors.state}</p>}
              {/* Settling a payment bumps the state version, so the plan notice only matters while a bill is unpaid. */}
              {snapshot.state && unpaid && <p className={plan.issue ? "service-alert" : "service-notice"}>
                {plan.issue ? t(`pay.plan.${plan.issue}` as MessageKey) : t("pay.plan.ok", { date: when(plan.plan!.created_at) })}
              </p>}
              {snapshot.state && (obligations.length === 0 ? <p>{t("pay.bills.none")}</p> : <div className="table-scroll"><table className="service-table">
                <thead><tr><th>{t("pay.bills.bill")}</th><th>{t("pay.bills.amount")}</th><th>{t("pay.bills.due")}</th><th>{t("pay.bills.payee")}</th><th>{t("pay.bills.state")}</th></tr></thead>
                <tbody>{obligations.map((o) => {
                  const status = payability(o, costs, snapshot.beneficiaries, snapshot.payments);
                  const invoice = invoiceOf(o, costs);
                  return <tr key={o.id}>
                    <td><label className="pay-choice"><input type="radio" name="pay-bill" value={o.id} disabled={status !== "READY" || preview} checked={eventId === o.id} onChange={() => setEventId(o.id)} />
                      <span><strong>{o.label ?? o.id}</strong>{invoice && <small>{t("pay.bills.invoice", { id: invoice.invoice_id, issuer: invoice.issuer })}</small>}</span></label></td>
                    <td>{money(o.amount)}</td>
                    <td>{date(o.date)}</td>
                    <td>{payee(o.beneficiary_id)?.name ?? "—"}</td>
                    <td><span className={`status-chip status-${status === "READY" ? "ok" : status === "SETTLED" || status === "HAS_PAYMENT" ? "used" : "pending"}`}>{t(`pay.payability.${status}` as MessageKey)}</span></td>
                  </tr>;
                })}</tbody>
              </table></div>)}
              <div className="service-actions">
                <button className="primary" disabled={preview || busy || !eventId || !!plan.issue} onClick={() => void createPayment()}>{t("pay.bills.create")}</button>
                {!preview && readyEvents.length === 0 && snapshot.state && <span className="service-muted">{t("pay.bills.noneReady")}</span>}
              </div>
            </div>
          </section>

          <section className="card service-card" id="pay-detail" aria-labelledby="pay-detail-title">
            <div className="service-card-body">
              <h2 id="pay-detail-title">{t("pay.detail.title")}</h2>
              {!selected ? <p>{loading ? t("common.loading") : t("pay.detail.none")}</p> : <>
                <div className="service-title-row">
                  <h3>{label(selected.event_id)} · <Amount text={money(selected.amount)} /></h3>
                  <span className={`status-chip status-${selected.status}`}>{t(`pay.status.${selected.status}` as MessageKey)}</span>
                </div>
                <ol className="pay-rail" aria-label={t("pay.detail.progress")}>
                  {MILESTONES.map((step, n) => {
                    const state = railState(selected, n);
                    return <li key={step} className={`pay-step pay-step-${state}`} aria-current={state === "current" ? "step" : undefined}>
                      <span aria-hidden="true">{state === "done" ? "✓" : state === "stopped" ? "!" : n + 1}</span>{t(`pay.milestone.${step}` as MessageKey)}
                    </li>;
                  })}
                </ol>
                <p className="pay-stage">{t(`pay.stage.${stage}` as MessageKey)}</p>
                <dl className="comparison-facts">
                  <div><dt>{t("pay.detail.payee")}</dt><dd>{payee(selected.beneficiary)?.name ?? selected.beneficiary.slice(0, 8)}{payee(selected.beneficiary)?.verified && <small> · {t("pay.detail.verified")}</small>}</dd></div>
                  <div><dt>{t("pay.detail.invoice")}</dt><dd>{selected.invoice_snapshot.invoice_id ? `${selected.invoice_snapshot.invoice_id} · ${selected.invoice_snapshot.issuer ?? ""}` : "—"}</dd></div>
                  <div><dt>{t("pay.detail.due")}</dt><dd>{date(selected.due_on)}</dd></div>
                  <div><dt>{t("pay.detail.authorizedUntil")}</dt><dd>{when(selected.authorized_until)}</dd></div>
                  <div><dt>{t("pay.detail.submittedAt")}</dt><dd>{when(selected.submitted_at)}</dd></div>
                  <div><dt>{t("pay.detail.reference")}</dt><dd><code>{selected.id.slice(0, 8)}</code></dd></div>
                </dl>

                {stage === "authorize" && <div className="service-policy">
                  <h4><TierBadge tier="T1" /> {t("pay.authorize.title")}</h4>
                  <p>{t("pay.authorize.text", { amount: money(selected.amount), payee: payee(selected.beneficiary)?.name ?? "—" })}</p>
                  {obligationFor(selected)?.amount && obligationFor(selected)!.amount !== selected.amount && <p className="error">{t("pay.authorize.changed")}</p>}
                  <label className="wallet-confirm"><input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} />{t("pay.authorize.check")}</label>
                  <div className="service-actions">
                    <button className="primary" disabled={preview || busy || !checked || !snapshot.state} onClick={() => void authorize(selected)}>{t("pay.authorize.button")}</button>
                    <button className="secondary" disabled={preview || busy} onClick={() => void cancel(selected)}>{t("pay.cancel")}</button>
                  </div>
                </div>}

                {stage === "submit" && <div className="service-policy">
                  <h4><TierBadge tier="T2" /> {t("pay.submit.title")}</h4>
                  <p>{t("pay.submit.text")}</p>
                  {approval && <p>{t("pay.approval.label")} <strong>{t(`approval.${approval.status}` as MessageKey)}</strong> · {t("pay.policy.expires", { date: when(approval.expires_at) })}</p>}
                  <div className="service-actions">
                    <button className="primary" disabled={preview || busy} onClick={() => approval?.status === "APPROVED" ? setPolicy("STEP_UP_REQUIRED") : void submit(selected)}>{t("pay.submit.button")}</button>
                    {lostSubmit && <button className="secondary" disabled={preview || busy} onClick={() => void submit(selected)}>{t("pay.submit.retry")}</button>}
                    <button className="secondary" disabled={preview || busy} onClick={() => void cancel(selected)}>{t("pay.cancel")}</button>
                  </div>
                  {policy === "APPROVAL_REQUIRED" && <FocusDialog title={t("ws.confirm")} busy={busy} onClose={() => setPolicy("")}><p>{money(selected.amount)} · {selected.id.slice(0, 8)}</p>{error && <p role="alert" className="error">{error}</p>}<div className="wallet-policy" ref={policyRef} tabIndex={-1}>
                    <h4><TierBadge tier="T3" /> {t("pay.policy.approvalTitle")}</h4>
                    <p>{t("pay.policy.approvalText")}</p>
                    {(!approval || ["REJECTED", "EXPIRED"].includes(approval.status)) && <>
                      <label className="service-field">{t("pay.policy.reason")}<input value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} /></label>
                      <button className="secondary" disabled={preview || busy || !reason.trim()} onClick={() => void requestApproval(selected)}>{t("pay.policy.request")}</button>
                    </>}
                  </div><button className="secondary" disabled={busy} onClick={() => setPolicy("")}>{t("common.cancel")}</button></FocusDialog>}
                  {policy === "STEP_UP_REQUIRED" && <FocusDialog title={t("ws.confirm")} busy={busy} onClose={() => setPolicy("")}><p>{money(selected.amount)} · {selected.id.slice(0, 8)}</p>{error && <p role="alert" className="error">{error}</p>}<div className="wallet-policy">
                    <h4><TierBadge tier="T2" /> {t("pay.policy.stepUpTitle")}</h4>
                    <p>{t("pay.policy.stepUpText", { amount: money(selected.amount) })}</p>
                    <form onSubmit={(event) => { event.preventDefault(); void stepUpAndSubmit(selected); }}>
                      <label className="service-field">{t("pay.policy.password")}<input ref={passwordRef} type="password" autoComplete="current-password" /></label>
                      <button type="submit" className="primary" disabled={preview || busy}>{t("pay.policy.submit")}</button>
                    </form>
                  </div><button className="secondary" disabled={busy} onClick={() => setPolicy("")}>{t("common.cancel")}</button></FocusDialog>}
                </div>}

                {stage === "authorization_expired" && <div className="service-policy">
                  <p>{t("pay.expired.text")}</p>
                  <button className="secondary" disabled={preview || busy} onClick={() => void cancel(selected)}>{t("pay.cancel")}</button>
                </div>}

                {stage === "reconcile" && <div className="service-actions">
                  <button className="primary" disabled={preview || busy} onClick={() => void reconcile(selected)}>{t("pay.reconcile.button")}</button>
                  <span className="service-muted">{t("pay.reconcile.text")}</span>
                </div>}

                {selected.receipt && <div className="pay-receipt" aria-labelledby="pay-receipt-title">
                  <h3 id="pay-receipt-title">{t("pay.receipt.title")}</h3>
                  <dl className="comparison-facts">
                    <div><dt>{t("pay.receipt.reference")}</dt><dd><code>{selected.receipt.reference}</code></dd></div>
                    <div><dt>{t("pay.receipt.amount")}</dt><dd>{money(selected.receipt.amount, selected.receipt.currency)}</dd></div>
                    <div><dt>{t("pay.receipt.settledOn")}</dt><dd>{date(selected.receipt.settled_on)}</dd></div>
                    <div><dt>{t("pay.detail.invoice")}</dt><dd>{selected.receipt.invoice_id ? `${selected.receipt.invoice_id} · ${selected.receipt.issuer ?? ""}` : "—"}</dd></div>
                    <div><dt>{t("pay.receipt.ledger")}</dt><dd>{ledgerRow ? t("pay.receipt.ledgerRow", { sequence: ledgerRow.sequence, amount: money(ledgerRow.amount, ledgerRow.currency) }) : "—"}</dd></div>
                    <div><dt>{t("pay.receipt.match")}</dt><dd>{selected.status === "reconciled" ? t("pay.receipt.matched") : selected.status === "reconciliation_exception" ? t("pay.receipt.mismatch") : t("pay.receipt.notYet")}</dd></div>
                  </dl>
                  {selected.receipt.is_simulated && <p className="service-disclaimer">{t("pay.receipt.simulated")}</p>}
                </div>}

                <h3>{t("pay.audit.title")}</h3>
                {snapshot.errors.audit ? <p className="error">{snapshot.errors.audit}</p> : trail.length === 0 ? <p className="service-muted">{t("pay.audit.none")}</p> :
                  <ol className="pay-audit">{trail.map((event) => <li key={event.id}>
                    <span>{when(event.created_at)}</span><strong>{auditName(event.action)}</strong>
                    <small><code>{event.action}</code>{actor(event.details) && ` · ${actor(event.details)}`}</small>
                  </li>)}</ol>}
                <p className="service-muted">{t("pay.audit.more")}</p>
              </>}
            </div>
          </section>

          <section className="card service-card" id="pay-history" aria-labelledby="pay-history-title">
            <div className="service-card-body">
              <h2 id="pay-history-title">{t("pay.history.title")}</h2>
              {snapshot.errors.payments && !signedOut && <p className="error">{snapshot.errors.payments}</p>}
              {snapshot.payments.length === 0 ? <p>{t("pay.history.none")}</p> : <ul className="service-list">
                {snapshot.payments.map((p) => <li key={p.id}>
                  <button className="link-button" aria-current={selected?.id === p.id ? "true" : undefined} onClick={() => select(p.id)}>{label(p.event_id)} · {money(p.amount)}</button>
                  <small className="service-muted">{t(`pay.status.${p.status}` as MessageKey)} · {when(p.created_at)}</small>
                </li>)}
              </ul>}
            </div>
          </section>
        </>;
  return <ModulePresentation className="payments-app" fullPage={(<div className="app connected service-app payments-app">
      <aside>
        <a className="brand" href="#" onClick={(event) => { event.preventDefault(); onExit(); }}><span className="brand-icon">S</span>StudyFlow<span className="brand-dot">.</span></a>
        <ModuleNav />
        <div className="journey-label">{t("pay.side.label")}</div>
        <nav aria-label={t("pay.side.nav")}>
          <a href="#pay-bills">{t("pay.bills.title")}</a>
          <a href="#pay-detail">{t("pay.detail.title")}</a>
          <a href="#pay-history">{t("pay.history.title")}</a>
        </nav>
        <div className="sidebar-note"><strong>{t("pay.side.noteTitle")}</strong><p>{t("pay.side.noteText")}</p></div>
        <button className="secondary" onClick={onExit}>{t("common.backToPlan")}</button>
      </aside>
      <div className="workspace">
        <header><span>StudyFlow / {t("pay.title")}</span><span className="avatar">ST</span></header>
        <main>{content}</main>
        <footer>{t("common.footer")}<span>{t("common.simulatedFooter")}</span></footer>
      </div>
    </div>)}>{content}</ModulePresentation>;
}
