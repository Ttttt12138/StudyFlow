import { FocusDialog } from "../workspace/FocusDialog";
import { useToolRefresh, useToolActive, useClearWhenHidden, useEmbedded } from "../workspace/context";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ServiceShell } from "../services/ServiceShell";
import { TierBadge } from "../services/TierBadge";
import { PanelAlert, PanelEmpty, PanelFacts, PanelHero, PanelInfo, PanelMenu, PanelPager, PanelSheet, PanelSkeleton, ToolPanel, usePage } from "../workspace/ToolPanel";
import { StackBar, StepTrack } from "../workspace/PanelCharts";
import { formatDate, formatMoney } from "../backend/presenters";
import { intlLocale, useI18n, type MessageKey } from "../i18n";
import { SessionWalletClient, WalletApiError, type WalletClient } from "../wallet/client";
import { loadPayments } from "./client";
import { currentPlan, invoiceOf, milestoneReached, MILESTONES, payability, paymentApproval, paymentAudit, paymentStage, type Payability } from "./logic";
import { createPaymentsPreview, previewStatuses, type PaymentPreviewScenario } from "./previewAdapter";
import type { Obligation, Payment, PaymentApproval, PaymentStatus, PaymentsSnapshot } from "./types";
import "../wallet/wallet.css";
import "../services/services.css";
import "./payments.css";

const signInUrl = `/auth?next=${encodeURIComponent(window.location.origin + "/?payments=1")}`;
const initial: PaymentsSnapshot = { state: null, plans: [], beneficiaries: [], payments: [], approvals: [], ledger: [], audit: [], errors: {} };
const KNOWN_EVENTS = ["payment.created", "payment.authorized", "payment.authorization_revoked", "payment.mock_submitted",
  "payment.mock_settled", "payment.mock_failed", "payment.mock_unknown", "payment.reconciled", "payment.invoice_mismatch",
  "auth.step_up_granted", "auth.step_up_failed", "approval.requested", "approval.approved", "approval.rejected"];
// Payments the student still has to move along (authorize, submit, wait for the adapter, reconcile).
const ACTIVE: PaymentStatus[] = ["draft", "authorized", "pending", "unknown", "settled"];
const PAID: PaymentStatus[] = ["settled", "reconciled", "reconciliation_exception"];
const STOPPED: PaymentStatus[] = ["failed", "cancelled", "expired", "reconciliation_exception"];
const STATUS_TONE: Record<PaymentStatus, string> = { draft: "due", authorized: "due", pending: "pending", unknown: "review", settled: "settled",
  reconciled: "done", reconciliation_exception: "error", failed: "failed", cancelled: "cancelled", expired: "expired" };
const PAYABILITY_TONE: Record<Payability, string> = { READY: "due", SETTLED: "paid", HAS_PAYMENT: "scheduled", NO_AMOUNT: "draft",
  NO_BENEFICIARY: "draft", BENEFICIARY_UNVERIFIED: "draft", INVOICE_REQUIRED: "draft" };
type Tab = "due" | "pay" | "history";
type Sheet = "bills" | "details" | "audit" | "payments" | null;

/**
 * Tuition and bill payments. Inside the money tool (wallet/MoneyHub.tsx) `mode` splits it in two: "flow" is the
 * Pay tab (bills due → pay), "history" is the payments part of Records; leaving the records for a payment calls `onFlow`.
 */
export function PaymentsApp({ preview, onExit, mode, onFlow }: { preview: boolean; onExit: () => void; mode?: "flow" | "history"; onFlow?: () => void }) {
  const { lang, t } = useI18n();
  const toolActive = useToolActive();
  const embedded = useEmbedded();
  const [scenario, setScenario] = useState<PaymentPreviewScenario>("draft");
  const client = useMemo<WalletClient>(() => preview ? createPaymentsPreview(scenario) : new SessionWalletClient(), [preview, scenario]);
  const [snapshot, setSnapshot] = useState<PaymentsSnapshot>(initial);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [eventId, setEventId] = useState("");
  const [checked, setChecked] = useState(false);
  const [policy, setPolicy] = useState<"" | "STEP_UP_REQUIRED" | "APPROVAL_REQUIRED">("");
  const [lostSubmit, setLostSubmit] = useState(false);
  const [reason, setReason] = useState(() => t("pay.policy.reasonDefault"));
  const [tab, setOwnTab] = useState<Tab | null>(null);
  const setTab = (key: Tab | null) => { if (mode === "history" && key && key !== "history") onFlow?.(); setOwnTab(key); };
  const [sheet, setSheet] = useState<Sheet>(null);
  const [billPage, setBillPage] = useState(0);
  const [historyPage, setHistoryPage] = useState(0);
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
    // Keep the payment on screen; otherwise open the one that still needs the student.
    setSelectedId((prior) => result.payments.some((p) => p.id === prior) ? prior
      : (result.payments.find((p) => ACTIVE.includes(p.status)) ?? result.payments[0])?.id ?? "");
    setLoading(false); setLoaded(true);
    return result;
  }, [client]);

  useEffect(() => {
    setError(""); setNotice(""); setPolicy(""); setLostSubmit(false); setChecked(false);
    void refresh().catch((reason: unknown) => { setError(message(reason)); setLoading(false); setLoaded(true); });
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
          if (existing) { select(existing.id); setTab("pay"); setNotice(t("pay.notice.created")); return; }
        }
        throw reason;
      }
      await refresh(); select(created.id); setEventId(""); setTab("pay");
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

  // Each confirmed bill counts once, by its latest payment: paid, in progress, failed at the adapter, or not started.
  const billPart = (o: Obligation): "paid" | "progress" | "failed" | "unpaid" => {
    const mine = snapshot.payments.filter((p) => p.event_id === o.id);
    if (o.settled_sequence !== undefined || mine.some((p) => PAID.includes(p.status))) return "paid";
    if (mine.some((p) => ACTIVE.includes(p.status))) return "progress";
    const latest = [...mine].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    return latest?.status === "failed" ? "failed" : "unpaid";
  };
  const totals = { paid: 0, progress: 0, failed: 0, unpaid: 0 };
  for (const o of obligations) totals[billPart(o)] += Number(o.amount) || 0;
  const toPay = totals.unpaid + totals.failed;
  const paidPayments = snapshot.payments.filter((p) => PAID.includes(p.status));
  const paidTotal = paidPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  const counts = { done: paidPayments.length, open: snapshot.payments.filter((p) => ["draft", "authorized", "pending", "unknown"].includes(p.status)).length,
    closed: snapshot.payments.filter((p) => ["failed", "cancelled", "expired"].includes(p.status)).length };

  // The step to show first follows the real records: a payment in flight, otherwise a bill ready to pay, otherwise the record.
  const auto: Tab = snapshot.payments.some((p) => ACTIVE.includes(p.status)) ? "pay" : readyEvents.length ? "due" : snapshot.payments.length ? "history" : "due";
  const picked = tab ?? auto;
  // In the money tool the records live under Records, so the Pay tab never lands on them.
  const current: Tab = mode === "history" ? "history" : mode === "flow" && picked === "history" ? (snapshot.payments.length ? "pay" : "due") : picked;
  const steps = mode === "history" ? [] : [
    { key: "due" as const, label: t("pay.step.due"), done: snapshot.payments.length > 0 },
    { key: "pay" as const, label: t("pay.step.pay"), done: snapshot.payments.some((p) => p.status === "reconciled") },
    ...(mode === "flow" ? [] : [{ key: "history" as const, label: t("pay.step.history") }]),
  ];
  const bills = usePage(obligations, 4, billPage);
  const history = usePage(snapshot.payments, 5, historyPage);
  const firstLoad = loading && !loaded;

  // The dock header already tags a preview; live records carry the simulated-money tag here.
  const simTag = !preview && <span className="panel-tag">{t("common.simulatedMoney")}</span>;
  const statusChip = (status: PaymentStatus) => <span className={`status-chip status-${STATUS_TONE[status]}`}>{t(`pay.status.${status}` as MessageKey)}</span>;
  const billChip = (state: Payability) => <span className={`status-chip status-${PAYABILITY_TONE[state]}`}>{t(`pay.payability.${state}` as MessageKey)}</span>;

  const billsTable = <table className="panel-table">
    <thead><tr><th>{t("pay.bills.bill")}</th><th>{t("pay.bills.amount")}</th><th>{t("pay.bills.due")}</th><th>{t("pay.bills.payee")}</th><th>{t("pay.bills.state")}</th></tr></thead>
    <tbody>{obligations.map((o, n) => {
      const invoice = invoiceOf(o, costs);
      return <tr key={o.id}><td>{o.label ?? o.id}{invoice && <small className="pay-sub">{t("pay.bills.invoice", { id: invoice.invoice_id, issuer: invoice.issuer })}</small>}</td>
        <td>{money(o.amount)}</td><td>{date(o.date)}</td><td>{payee(o.beneficiary_id)?.name ?? "—"}</td><td>{billChip(states[n])}</td></tr>;
    })}</tbody>
  </table>;
  const paymentsTable = <table className="panel-table">
    <thead><tr><th>{t("pay.bills.bill")}</th><th>{t("pay.bills.amount")}</th><th>{t("pay.history.created")}</th><th>{t("pay.bills.state")}</th></tr></thead>
    <tbody>{snapshot.payments.map((p) => <tr key={p.id} aria-current={selected?.id === p.id ? "true" : undefined}>
      <td>{label(p.event_id)}</td><td>{money(p.amount)}</td><td>{when(p.created_at)}</td><td>{statusChip(p.status)}</td></tr>)}</tbody>
  </table>;
  const receiptBlock = selected?.receipt && <div className="pay-receipt" aria-labelledby="pay-receipt-title">
    <h4 id="pay-receipt-title" className="panel-section-title">{t("pay.receipt.title")}</h4>
    <PanelFacts items={[
      [t("pay.receipt.reference"), <code>{selected.receipt.reference}</code>],
      [t("pay.receipt.amount"), money(selected.receipt.amount, selected.receipt.currency)],
      [t("pay.receipt.settledOn"), date(selected.receipt.settled_on)],
      [t("pay.detail.invoice"), selected.receipt.invoice_id ? `${selected.receipt.invoice_id} · ${selected.receipt.issuer ?? ""}` : "—"],
      [t("pay.receipt.ledger"), ledgerRow ? t("pay.receipt.ledgerRow", { sequence: ledgerRow.sequence, amount: money(ledgerRow.amount, ledgerRow.currency) }) : "—"],
      [t("pay.receipt.match"), matchText(selected)],
    ]} />
    {selected.receipt.is_simulated && <p className="panel-muted">{t("pay.receipt.simulated")}</p>}
  </div>;
  function matchText(payment: Payment) {
    return payment.status === "reconciled" ? t("pay.receipt.matched") : payment.status === "reconciliation_exception" ? t("pay.receipt.mismatch") : t("pay.receipt.notYet");
  }
  const auditBlock = <>
    {snapshot.errors.audit ? <PanelAlert message={snapshot.errors.audit} onRetry={() => void refresh()} /> : trail.length === 0 ? <p className="panel-muted">{t("pay.audit.none")}</p> :
      <ol className="pay-audit">{trail.map((event) => <li key={event.id}>
        <span>{when(event.created_at)}</span><strong>{auditName(event.action)}</strong>
        <small><code>{event.action}</code>{actor(event.details) && ` · ${actor(event.details)}`}</small>
      </li>)}</ol>}
    <p className="panel-muted">{t("pay.audit.more")}</p>
  </>;

  // ---- Step 1: confirmed bills ----
  const dueView = <section id="pay-bills" className="panel-view" hidden={current !== "due"} aria-labelledby="pay-bills-title">
    <div className="panel-card-head"><h2 id="pay-bills-title">{t("pay.bills.title")}</h2>
      <span className="panel-row">{simTag}<PanelInfo>{t("pay.bills.text")} {preview ? t("pay.preview.text") : t("pay.banner.text")}</PanelInfo></span></div>
    {firstLoad ? <PanelSkeleton rows={4} /> : <>
      {snapshot.errors.state && !signedOut && <PanelAlert message={snapshot.errors.state} onRetry={() => void refresh()} />}
      {snapshot.state && <>
        <PanelHero label={t("pay.due.hero")} value={money(toPay.toFixed(2))} tone={toPay > 0 ? "warn" : undefined}>
          <span className="panel-muted">{t("pay.due.count", { n: obligations.length })}{snapshot.state.assets.wallet_balance != null && ` · ${t("pay.bills.balance", { amount: money(snapshot.state.assets.wallet_balance) })}`}</span>
        </PanelHero>
        {obligations.length > 0 && <StackBar label={t("pay.due.chart")} parts={[
          { key: "paid", value: totals.paid, tone: "mint", label: t("pay.part.paid", { amount: money(totals.paid.toFixed(2)) }) },
          { key: "progress", value: totals.progress, tone: "muted", label: t("pay.part.progress", { amount: money(totals.progress.toFixed(2)) }) },
          { key: "unpaid", value: totals.unpaid, tone: "gold", label: t("pay.part.unpaid", { amount: money(totals.unpaid.toFixed(2)) }) },
          ...(totals.failed > 0 ? [{ key: "failed", value: totals.failed, tone: "red" as const, label: t("pay.part.failed", { amount: money(totals.failed.toFixed(2)) }) }] : []),
        ]} />}
        {/* Settling a payment bumps the state version, so the plan notice only matters while a bill is unpaid. */}
        {unpaid && <p className={plan.issue ? "panel-note is-warn" : "panel-muted"}>
          {plan.issue ? t(`pay.plan.${plan.issue}` as MessageKey) : t("pay.plan.ok", { date: when(plan.plan!.created_at) })}
        </p>}
        {obligations.length === 0 ? <PanelEmpty title={t("pay.bills.none")} /> : <>
          <div className="panel-card-head"><span className="panel-section-title">{t("pay.due.choose")}</span>
            <PanelPager index={bills.index} count={bills.pages} onChange={setBillPage} label={t("pay.due.pager")} /></div>
          <ul className="panel-rows pay-bills">{bills.rows.map((o) => {
            const state = states[obligations.indexOf(o)];
            return <li key={o.id}>
              <label className="pay-choice"><input type="radio" name="pay-bill" value={o.id} disabled={state !== "READY" || preview} checked={eventId === o.id} onChange={() => setEventId(o.id)} />
                <span><strong>{o.label ?? o.id}</strong><small>{date(o.date)} · {payee(o.beneficiary_id)?.name ?? "—"}</small>
                  {invoiceOf(o, costs) && <small>{t("pay.bills.invoice", { id: invoiceOf(o, costs)!.invoice_id, issuer: invoiceOf(o, costs)!.issuer })}</small>}</span></label>
              <span className="pay-bill-end"><strong>{money(o.amount)}</strong>{billChip(state)}</span>
            </li>;
          })}</ul>
          {!preview && readyEvents.length === 0 && <p className="panel-muted">{t("pay.bills.noneReady")}</p>}
        </>}
      </>}
    </>}
  </section>;

  // ---- Step 2: the selected payment ----
  let reached = 0, failedTrack = false;
  if (selected) {
    reached = selected.status === "reconciled" ? MILESTONES.length : milestoneReached(selected) + 1;
    failedTrack = STOPPED.includes(selected.status);
  }
  const payView = <section id="pay-detail" className="panel-view" hidden={current !== "pay"} aria-labelledby="pay-detail-title">
    {firstLoad ? <PanelSkeleton rows={4} /> : !selected ? <>
      <h2 id="pay-detail-title" className="sr-only">{t("pay.detail.title")}</h2>
      {snapshot.errors.payments && !signedOut && <PanelAlert message={snapshot.errors.payments} onRetry={() => void refresh()} />}
      <PanelEmpty title={t("pay.detail.empty")} text={t("pay.detail.none")}
        action={<button type="button" className="secondary" onClick={() => setTab("due")}>{t("pay.detail.toDue")}</button>} />
    </> : <>
      <div className="panel-card-head"><h2 id="pay-detail-title">{label(selected.event_id)}</h2>
        <PanelPager index={snapshot.payments.indexOf(selected)} count={snapshot.payments.length} onChange={(n) => select(snapshot.payments[n].id)} label={t("pay.detail.pager")} /></div>
      <div className="panel-row">{statusChip(selected.status)}{simTag}</div>
      <PanelHero label={t("pay.detail.hero")} value={money(selected.amount)} />
      <StepTrack label={t("pay.detail.progress")} steps={MILESTONES.map((step) => t(`pay.milestone.${step}` as MessageKey))} current={reached} failed={failedTrack} />
      <p className={stage === "exception" || stage === "unknown" ? "panel-note is-warn" : "panel-note"}>{t(`pay.stage.${stage}` as MessageKey)}</p>
      <PanelFacts items={[
        [t("pay.detail.payee"), <>{payee(selected.beneficiary)?.name ?? selected.beneficiary.slice(0, 8)}{payee(selected.beneficiary)?.verified && <small> · {t("pay.detail.verified")}</small>}</>],
        [t("pay.detail.due"), date(selected.due_on)],
        [t("pay.detail.invoice"), selected.invoice_snapshot.invoice_id ? `${selected.invoice_snapshot.invoice_id} · ${selected.invoice_snapshot.issuer ?? ""}` : "—"],
        selected.receipt ? [t("pay.receipt.match"), matchText(selected)]
          : selected.submitted_at ? [t("pay.detail.submittedAt"), when(selected.submitted_at)] : [t("pay.detail.authorizedUntil"), when(selected.authorized_until)],
      ]} />

      {stage === "authorize" && <div className="pay-action">
        <h4 className="panel-section-title"><TierBadge tier="T1" /> {t("pay.authorize.title")}</h4>
        <p className="panel-muted">{t("pay.authorize.text", { amount: money(selected.amount), payee: payee(selected.beneficiary)?.name ?? "—" })}</p>
        {obligationFor(selected)?.amount && obligationFor(selected)!.amount !== selected.amount && <p className="panel-note is-warn">{t("pay.authorize.changed")}</p>}
        <label className="panel-check"><input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} />{t("pay.authorize.check")}</label>
      </div>}

      {stage === "submit" && <div className="pay-action">
        <h4 className="panel-section-title"><TierBadge tier="T2" /> {t("pay.submit.title")}<PanelInfo>{t("pay.submit.text")}</PanelInfo></h4>
        {approval && <p className="panel-muted">{t("pay.approval.label")} <strong>{t(`approval.${approval.status}` as MessageKey)}</strong> · {t("pay.policy.expires", { date: when(approval.expires_at) })}</p>}
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

      {stage === "authorization_expired" && <p className="panel-note is-warn">{t("pay.expired.text")}</p>}
      {stage === "reconcile" && <p className="panel-muted">{t("pay.reconcile.text")}</p>}

      <div className="panel-row">
        <button type="button" className="panel-link" onClick={() => setSheet("details")}>{t(selected.receipt ? "pay.detail.receiptLink" : "pay.detail.more")} →</button>
        <button type="button" className="panel-link" onClick={() => setSheet("audit")}>{t("pay.audit.link", { n: trail.length })} →</button>
      </div>
    </>}
  </section>;

  // ---- Step 3: every payment ----
  const historyView = <section id="pay-history" className="panel-view" hidden={current !== "history"} aria-labelledby="pay-history-title">
    <div className="panel-card-head"><h2 id="pay-history-title">{t("pay.history.title")}</h2>
      <PanelPager index={history.index} count={history.pages} onChange={setHistoryPage} label={t("pay.history.pager")} /></div>
    {firstLoad ? <PanelSkeleton rows={4} /> : <>
      {snapshot.errors.payments && !signedOut && <PanelAlert message={snapshot.errors.payments} onRetry={() => void refresh()} />}
      {snapshot.payments.length === 0 ? <PanelEmpty title={t("pay.history.none")} /> : <>
        <PanelHero label={t("pay.history.hero")} value={money(paidTotal.toFixed(2))}>
          <span className="panel-muted">{t("pay.history.count", { n: snapshot.payments.length })}</span></PanelHero>
        <StackBar label={t("pay.history.chart")} parts={[
          { key: "done", value: counts.done, tone: "mint", label: t("pay.history.done", { n: counts.done }) },
          { key: "open", value: counts.open, tone: "gold", label: t("pay.history.open", { n: counts.open }) },
          { key: "closed", value: counts.closed, tone: "red", label: t("pay.history.closed", { n: counts.closed }) },
        ]} />
        <ul className="panel-rows">{history.rows.map((p) => <li key={p.id} aria-current={selected?.id === p.id ? "true" : undefined}>
          <span><strong>{label(p.event_id)}</strong><small>{when(p.created_at)}</small></span>
          <span>{money(p.amount)}</span>{statusChip(p.status)}
          <button type="button" className="chip" onClick={() => { select(p.id); setTab("pay"); }}>{t("pay.history.view")}</button>
        </li>)}</ul>
      </>}
    </>}
  </section>;

  let footer: ReactNode = null;
  if (current === "due") footer = <>
    {obligations.length > 0 && <button type="button" className="panel-link panel-footer-note" onClick={() => setSheet("bills")}>{t("pay.due.all", { n: obligations.length })}</button>}
    <button className="primary" disabled={preview || busy || !eventId || !!plan.issue} onClick={() => void createPayment()}>{t("pay.bills.create")}</button>
  </>;
  else if (current === "pay" && selected) footer = <>
    {stage === "authorize" && <><button className="secondary" disabled={preview || busy} onClick={() => void cancel(selected)}>{t("pay.cancel")}</button>
      <button className="primary" disabled={preview || busy || !checked || !snapshot.state} onClick={() => void authorize(selected)}>{t("pay.authorize.button")}</button></>}
    {stage === "submit" && <><button className="secondary" disabled={preview || busy} onClick={() => void cancel(selected)}>{t("pay.cancel")}</button>
      {lostSubmit && <button className="secondary" disabled={preview || busy} onClick={() => void submit(selected)}>{t("pay.submit.retry")}</button>}
      <button className="primary" disabled={preview || busy} onClick={() => approval?.status === "APPROVED" ? setPolicy("STEP_UP_REQUIRED") : void submit(selected)}>{t("pay.submit.button")}</button></>}
    {stage === "authorization_expired" && <button className="secondary" disabled={preview || busy} onClick={() => void cancel(selected)}>{t("pay.cancel")}</button>}
    {stage === "reconcile" && <button className="primary" disabled={preview || busy} onClick={() => void reconcile(selected)}>{t("pay.reconcile.button")}</button>}
    {(stage === "failed" || stage === "cancelled") && readyEvents.length > 0 && <button type="button" className="primary" onClick={() => setTab("due")}>{t("pay.detail.toDue")}</button>}
  </>;
  else if (current === "history" && snapshot.payments.length > 0) footer = <>
    <button type="button" className="panel-link panel-footer-note" onClick={() => setSheet("payments")}>{t("pay.history.all", { n: snapshot.payments.length })}</button>
    {readyEvents.length > 0 && <button type="button" className="primary" onClick={() => setTab("due")}>{t("pay.detail.toDue")}</button>}
  </>;

  const close = () => setSheet(null);
  const sheets: Record<Exclude<Sheet, null>, () => ReactNode> = {
    bills: () => <PanelSheet title={t("pay.bills.title")} onClose={close}>{billsTable}<p className="panel-muted">{t("pay.bills.text")}</p></PanelSheet>,
    payments: () => <PanelSheet title={t("pay.history.title")} onClose={close}>{paymentsTable}</PanelSheet>,
    details: () => selected && <PanelSheet title={t("pay.detail.sheet")} onClose={close}>
      <PanelFacts items={[
        [t("pay.detail.payee"), payee(selected.beneficiary)?.name ?? selected.beneficiary.slice(0, 8)],
        [t("pay.detail.invoice"), selected.invoice_snapshot.invoice_id ? `${selected.invoice_snapshot.invoice_id} · ${selected.invoice_snapshot.issuer ?? ""}` : "—"],
        [t("pay.detail.due"), date(selected.due_on)],
        [t("pay.detail.authorizedUntil"), when(selected.authorized_until)],
        [t("pay.detail.submittedAt"), when(selected.submitted_at)],
        [t("pay.detail.reference"), <code>{selected.id.slice(0, 8)}</code>],
      ]} />
      {receiptBlock}
    </PanelSheet>,
    audit: () => selected && <PanelSheet title={t("pay.audit.title")} onClose={close}>{auditBlock}</PanelSheet>,
  };
  const aside = current === "due" ? obligations.length > 0 && <><h3 className="panel-section-title">{t("pay.bills.title")}</h3>{billsTable}</>
    : current === "history" ? snapshot.payments.length > 0 && <><h3 className="panel-section-title">{t("pay.history.title")}</h3>{paymentsTable}</>
    : selected && <>{receiptBlock}<h3 className="panel-section-title">{t("pay.audit.title")}</h3>{auditBlock}</>;

  const staleStatus = useToolRefresh(() => refresh());
  const showNotices = staleStatus || (loading && loaded) || (error && !policy) || notice;
  return (
    <ServiceShell className="payments-app" eyebrow={t("pay.eyebrow")} title={t("pay.title")} intro={t("pay.intro")} sideLabel={t("pay.side.label")}
      sections={[]} noteTitle={t("pay.side.noteTitle")} noteText={t("pay.side.noteText")} preview={preview}
      previewTitle={t("pay.preview.title")} previewText={t("pay.preview.text")} bannerText={t("pay.banner.text")}
      signedOut={signedOut} signInUrl={signInUrl} signedOutText={t("pay.signedOut")} onExit={onExit}
      onRefresh={embedded ? undefined : () => void refresh()} refreshing={loading || busy}>
      <ToolPanel steps={steps} active={current} onSelect={(key) => { setTab(key); setSheet(null); }} label={t("pay.steps")}
        tools={preview && <PanelMenu><label className="pay-scenario" htmlFor="pay-scenario">{t("pay.preview.status")}
          <select id="pay-scenario" value={scenario} onChange={(event) => { setScenario(event.target.value as PaymentPreviewScenario); setTab(null); setSheet(null); }}>
            {previewStatuses.map((value) => <option key={value} value={value}>{t(`pay.status.${value}` as MessageKey)}</option>)}
          </select></label></PanelMenu>}
        notices={showNotices && <>
          {staleStatus}
          {loading && loaded && <div className="activity" role="status"><span className="activity-dot" aria-hidden="true" />{t("common.loading")}</div>}
          {error && !policy && <div className="stale-banner" role="alert">{error}</div>}
          {notice && <div className="demo" role="status">{notice}</div>}</>}
        footer={footer} sheet={sheet && sheets[sheet]()} aside={aside || undefined}>
        {dueView}{payView}{historyView}
      </ToolPanel>
    </ServiceShell>
  );
}
