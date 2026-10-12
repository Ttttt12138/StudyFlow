import { useCallback, useEffect, useMemo, useState } from "react";
import { TierBadge } from "../services/TierBadge";
import { formatDate, formatMoney } from "../backend/presenters";
import { intlLocale, useI18n, type MessageKey } from "../i18n";
import { SessionWalletClient, WalletApiError, type WalletClient } from "../wallet/client";
import { minutesLeft, orderOutcomes, paymentOutcomes } from "./logic";
import { createOperationsPreview } from "./previewAdapter";
import type { OpsApplication, OpsApproval, OpsOrder, OpsPayment, OpsQueue, OpsSponsorRequest } from "./types";
import { sponsorLink } from "../family/link";
import "../wallet/wallet.css";
import "../services/services.css";
import "../payments/payments.css";
import "./operations.css";

const signInUrl = `/api/auth/login/?next=${encodeURIComponent(window.location.origin + "/?ops=1")}`;
const PAGE = 10;
const ACTIONS = ["payment.submit", "remittance.submit", "wallet.convert", "loan.repay"];
// One irreversible operator action waiting for its inline confirmation: what it says, and what it does.
type Pending = { key: string; text: string; danger?: boolean; noteFor?: string; act: () => Promise<string> };

export function OperationsApp({ preview, onExit }: { preview: boolean; onExit: () => void }) {
  const { lang, t } = useI18n();
  const client = useMemo<WalletClient>(() => preview ? createOperationsPreview() : new SessionWalletClient(), [preview]);
  const [queue, setQueue] = useState<OpsQueue | null>(null);
  const [loadError, setLoadError] = useState<WalletApiError | Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Pending | null>(null);
  const [student, setStudent] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [issued, setIssued] = useState<{ id: string; url: string; expires: string } | null>(null);

  // A long-lived demo database collects many items; filter by student and show the oldest few first.
  const matches = (row: { owner_username: string }) => row.owner_username.toLowerCase().includes(student.trim().toLowerCase());
  function shown<T extends { owner_username: string }>(list: string, rows: T[]) {
    const kept = rows.filter(matches);
    return { rows: expanded[list] ? kept : kept.slice(0, PAGE), hidden: expanded[list] ? 0 : Math.max(kept.length - PAGE, 0), total: kept.length };
  }
  const more = (list: string, hidden: number) => hidden > 0 && <button className="link-button ops-more" onClick={() => setExpanded({ ...expanded, [list]: true })}>{t("ops.showAll", { count: hidden })}</button>;

  const money = (value: unknown, currency?: string) => formatMoney(value, currency, lang);
  const when = (value: string | null | undefined) => value
    ? new Date(value).toLocaleString(intlLocale(lang), { dateStyle: "medium", timeStyle: "short" }) : "—";
  const home = "THB";
  const actionName = (action: string) => ACTIONS.includes(action) ? t(`trust.action.${action}` as MessageKey) : action;
  const denied = loadError instanceof WalletApiError && [401, 403].includes(loadError.status);
  const signedOut = loadError instanceof WalletApiError && loadError.status === 401;

  const refresh = useCallback(async () => {
    setLoading(true);
    try { setQueue(await client.get<OpsQueue>("operations/queue/")); setLoadError(null); }
    catch (reason) { setQueue(null); setLoadError(reason instanceof Error ? reason : new Error(String(reason))); }
    finally { setLoading(false); }
  }, [client]);
  useEffect(() => { void refresh(); }, [refresh]);

  async function run(action: () => Promise<string>) {
    if (preview) return;
    setBusy(true); setError(""); setNotice("");
    // Refresh before announcing, so the notice never describes a queue that is still out of date.
    try { const text = await action(); await refresh(); setPending(null); setNotice(text); }
    catch (reason) {
      const code = reason instanceof WalletApiError ? reason.code : "";
      setPending(null);
      await refresh();
      setError(reason instanceof WalletApiError && reason.status === 409 ? t("ops.err.changed")
        : code === "SEPARATION_OF_DUTIES" ? t("ops.err.separation")
        : reason instanceof Error ? reason.message : t("ops.err.generic"));
    } finally { setBusy(false); }
  }

  // Builders for each kind of operator action; the Django route enforces the real rules.
  const decideAction = (approval: OpsApproval, decision: "approve" | "reject"): Pending => ({
    key: `decide:${approval.id}`, danger: decision === "reject",
    text: t(decision === "approve" ? "ops.confirm.approve" : "ops.confirm.reject", { amount: money(approval.amount, approval.currency), student: approval.owner_username }),
    act: async () => {
      await client.post(`approvals/${approval.id}/decide/`, { decision, note: notes[approval.id] ?? "", expected_version: approval.version },
        `decide:${approval.id}:${approval.version}:${decision}`);
      return t(decision === "approve" ? "ops.notice.approved" : "ops.notice.rejected", { student: approval.owner_username });
    },
  });
  const paymentAction = (payment: OpsPayment, outcome: string): Pending => ({
    key: `payment:${payment.id}`, danger: outcome === "failed",
    text: t("ops.confirm.payment", { outcome: t(`ops.outcome.${outcome}` as MessageKey), amount: money(payment.amount, payment.currency) }),
    act: async () => {
      await client.post(`payments/${payment.id}/adapter-event/`, { outcome }, `payment-event:${payment.id}:${payment.status}:${outcome}`);
      return t("ops.notice.recorded", { outcome: t(`ops.outcome.${outcome}` as MessageKey) });
    },
  });
  const orderAction = (order: OpsOrder, outcome: string): Pending => ({
    key: `order:${order.id}`, danger: outcome === "failed", noteFor: order.id,
    text: t("ops.confirm.order", { outcome: t(`ops.outcome.${outcome}` as MessageKey), amount: money(order.send_amount, order.send_currency) }),
    act: async () => {
      await client.post(`remittance-orders/${order.id}/adapter-event/`, { outcome, expected_version: order.version, note: notes[order.id] ?? "" },
        `order-event:${order.id}:${order.version}:${outcome}`);
      return t("ops.notice.recorded", { outcome: t(`ops.outcome.${outcome}` as MessageKey) });
    },
  });
  const verifyAction = (id: string, name: string): Pending => ({
    key: `verify:${id}`, text: t("ops.confirm.verify", { name }),
    act: async () => {
      await client.post(`beneficiaries/${id}/verify/`, { verified: true }, `verify:${id}`);
      return t("ops.notice.verified", { name });
    },
  });
  const loanDecisionAction = (application: OpsApplication): Pending => ({
    key: `loan:${application.id}`, noteFor: application.id,
    text: t("ops.confirm.loanDecision", { student: application.owner_username }),
    act: async () => {
      const result = await client.post<{ status: string }>(`applications/${application.id}/decision/`,
        { expected_version: application.version, reason: notes[application.id] || t("ops.loans.defaultReason") }, `loan-decision:${application.id}:${application.version}`);
      return t("ops.notice.loanDecision", { status: t(`ops.loanStatus.${result.status}` as MessageKey) });
    },
  });
  const disburseAction = (application: OpsApplication): Pending => ({
    key: `loan:${application.id}`,
    text: t("ops.confirm.disburse", { amount: money(application.quote.net_proceeds, application.quote.currency), student: application.owner_username }),
    act: async () => {
      const result = await client.post<{ account: unknown }>(`applications/${application.id}/disburse/`,
        { expected_version: application.version }, `loan-disburse:${application.id}:${application.version}`);
      return t(result.account ? "ops.notice.disbursed" : "ops.notice.backToReview");
    },
  });
  const issueLinkAction = (request: OpsSponsorRequest): Pending => ({
    key: `sponsor:${request.id}`, text: t("ops.confirm.issueLink", { student: request.owner_username }),
    act: async () => {
      const link = await client.post<{ token: string; expires_at: string }>(`sponsor-requests/${request.id}/issue-link/`,
        { terms_version: request.terms_version }, `issue-link:${request.id}:${request.terms_version}`);
      // Shown once to pass on; StudyFlow keeps only a digest of the token.
      setIssued({ id: request.id, url: sponsorLink(window.location.origin, link.token), expires: link.expires_at });
      return t("ops.notice.linkIssued");
    },
  });
  const receiveAction = (request: OpsSponsorRequest): Pending => ({
    key: `sponsor:${request.id}`,
    text: t("ops.confirm.receive", { amount: money(request.source.amount, request.source.currency), student: request.owner_username }),
    act: async () => {
      // Foreign-currency support stays in its own currency; converting is the student's choice in the wallet.
      await client.post(`funding-sources/${request.source.id}/receive/`, { hold_in_source_currency: request.source.currency !== home },
        `receive:${request.source.id}`);
      return t("ops.notice.received", { amount: money(request.source.amount, request.source.currency) });
    },
  });

  const isPending = (key: string) => pending !== null && pending.key === key;
  const confirmBox = (item: Pending) => <div className="ops-confirm" role="group" aria-label={t("ops.confirm.label")}>
    <p>{item.text}</p>
    {item.noteFor && <label className="service-field">{t(item.key.startsWith("loan:") ? "ops.loans.reason" : "ops.adapter.note")}
      <input value={notes[item.noteFor] ?? ""} maxLength={500} onChange={(event) => setNotes({ ...notes, [item.noteFor!]: event.target.value })} />
    </label>}
    <div className="service-actions">
      <button className={item.danger ? "secondary danger" : "primary"} disabled={busy || preview} onClick={() => void run(item.act)}>{t("ops.confirm.yes")}</button>
      <button className="secondary" disabled={busy} onClick={() => setPending(null)}>{t("ops.confirm.no")}</button>
    </div>
  </div>;

  function target(approval: OpsApproval) {
    const item = approval.target;
    if (!item) return <p className="service-muted">{t("ops.target.missing")}</p>;
    const verifier = item.payee_verified_by == null ? t("ops.target.notVerified")
      : item.payee_verified_by === queue?.operator.id ? t("ops.target.verifiedByYou") : t("ops.target.verifiedBy", { id: item.payee_verified_by });
    return <dl className="comparison-facts">
      {item.kind === "payment" ? <>
        <div><dt>{t("ops.target.bill")}</dt><dd>{item.event_id}</dd></div>
        <div><dt>{t("ops.target.payee")}</dt><dd>{item.beneficiary_name}</dd></div>
        <div><dt>{t("ops.target.invoice")}</dt><dd>{item.invoice_snapshot.invoice_id ? `${item.invoice_snapshot.invoice_id} · ${item.invoice_snapshot.issuer ?? ""}` : "—"}</dd></div>
        <div><dt>{t("ops.target.due")}</dt><dd>{formatDate(item.due_on, lang)}</dd></div>
      </> : <>
        <div><dt>{t("ops.target.send")}</dt><dd>{money(item.send_amount, item.send_currency)} → {money(item.receive_amount, item.receive_currency)}</dd></div>
        <div><dt>{t("ops.target.payee")}</dt><dd>{item.recipient === "SELF" ? t("ops.target.self") : item.beneficiary_name ?? "—"}</dd></div>
        <div><dt>{t("ops.target.purpose")}</dt><dd>{item.purpose.replaceAll("_", " ")}</dd></div>
      </>}
      <div><dt>{t("ops.target.payeeCheck")}</dt><dd>{verifier}</dd></div>
      <div><dt>{t("ops.target.status")}</dt><dd><code>{item.status}</code></dd></div>
    </dl>;
  }

  const counts = queue ? [queue.approvals.length, queue.payments.length + queue.remittance_orders.length, queue.beneficiaries.length,
    queue.applications?.length ?? 0, queue.sponsor_requests?.length ?? 0] : [0, 0, 0, 0, 0];

  return (
    <div className="app connected service-app ops-app">
      <aside>
        <a className="brand" href="#" onClick={(event) => { event.preventDefault(); onExit(); }}><span className="brand-icon">S</span>StudyFlow<span className="brand-dot">.</span></a>
        <div className="journey-label">{t("ops.side.label")}</div>
        <nav aria-label={t("ops.side.nav")}>
          <a href="#ops-approvals">{t("ops.approvals.title")} <span className="ops-count">{counts[0]}</span></a>
          <a href="#ops-adapter">{t("ops.adapter.title")} <span className="ops-count">{counts[1]}</span></a>
          <a href="#ops-payees">{t("ops.payees.title")} <span className="ops-count">{counts[2]}</span></a>
          <a href="#ops-loans">{t("ops.loans.title")} <span className="ops-count">{counts[3]}</span></a>
          <a href="#ops-sponsors">{t("ops.sponsors.title")} <span className="ops-count">{counts[4]}</span></a>
          <a href="#ops-decisions">{t("ops.decisions.title")}</a>
        </nav>
        <div className="sidebar-note"><strong>{t("ops.side.noteTitle")}</strong><p>{t("ops.side.noteText")}</p></div>
        <button className="secondary" onClick={onExit}>{t("role.toStudent")}</button>
      </aside>
      <div className="workspace">
        <header><span className="ops-role-badge">{t("role.opsBadge")}</span><span className="avatar" title={queue?.operator.username}>OP</span></header>
        <main>
          <div className="section-heading"><div>
            <span className="eyebrow">{t("ops.eyebrow")}</span>
            <h1>{t("ops.title")}</h1>
            <p>{t("ops.intro")}</p>
          </div>
          {!preview && <button className="secondary" disabled={loading || busy} onClick={() => void refresh()}>{t("common.refresh")}</button>}
          </div>
          <div className="preview-banner" role="status">
            <strong>{preview ? t("ops.preview.title") : t("common.simulatedMoney")}</strong>
            <span>{preview ? t("ops.preview.text") : queue ? t("ops.banner.signedIn", { name: queue.operator.username }) : t("ops.banner.text")}</span>
          </div>
          {loading && !queue && <div className="activity" role="status"><span className="activity-dot" aria-hidden="true" />{t("common.loading")}</div>}
          {error && <div className="stale-banner" role="alert">{error}</div>}
          {notice && <div className="demo" role="status">{notice}</div>}
          {denied && <div className="card service-card"><div className="service-card-body service-empty">
            <h2>{t("ops.denied.title")}</h2>
            <p>{signedOut ? t("ops.denied.signedOut") : t("ops.denied.student")}</p>
            <a className="primary" href={signInUrl}>{t("ops.denied.signIn")}</a>
          </div></div>}
          {loadError && !denied && <p className="error" role="alert">{loadError.message}</p>}

          {queue && (() => {
            const approvals = shown("approvals", queue.approvals), payments = shown("payments", queue.payments),
              orders = shown("orders", queue.remittance_orders), payees = shown("payees", queue.beneficiaries),
              loans = shown("loans", queue.applications ?? []), sponsors = shown("sponsors", queue.sponsor_requests ?? []);
            return <>
            <label className="service-inline-field ops-filter">{t("ops.filter")}
              <input type="search" value={student} placeholder={t("ops.filterPlaceholder")} onChange={(event) => setStudent(event.target.value)} />
            </label>
            <section className="card service-card" id="ops-approvals" aria-labelledby="ops-approvals-title">
              <div className="service-card-body">
                <h2 id="ops-approvals-title"><TierBadge tier="T3" /> {t("ops.approvals.title")}</h2>
                <p className="service-muted">{t("ops.approvals.text")}</p>
                {approvals.total === 0 ? <p>{t("ops.approvals.none")}</p> : <div className="ops-cards">
                  {approvals.rows.map((approval) => {
                    const left = minutesLeft(approval.expires_at);
                    return <article key={approval.id} className="ops-card" aria-label={`${actionName(approval.action)} · ${approval.owner_username}`}>
                      <div className="service-title-row">
                        <h3>{actionName(approval.action)} · {money(approval.amount, approval.currency)}</h3>
                        <span className={`status-chip ${left < 60 ? "status-pending" : ""}`}>{left >= 60 ? t("ops.approvals.expiresHours", { hours: Math.floor(left / 60) }) : t("ops.approvals.expiresMinutes", { minutes: Math.max(left, 0) })}</span>
                      </div>
                      <p className="service-muted">{t("ops.approvals.requested", { student: approval.owner_username, time: when(approval.created_at) })}</p>
                      <blockquote className="ops-reason">{approval.reason}</blockquote>
                      {target(approval)}
                      {!approval.can_decide && approval.blocked_reason && <p className="service-alert">{t(`ops.blocked.${approval.blocked_reason}` as MessageKey)}</p>}
                      {approval.can_decide && <>
                        <label className="service-field">{t("ops.approvals.note")}
                          <input value={notes[approval.id] ?? ""} maxLength={500} placeholder={t("ops.approvals.notePlaceholder")} onChange={(event) => setNotes({ ...notes, [approval.id]: event.target.value })} />
                        </label>
                        {isPending(`decide:${approval.id}`) ? confirmBox(pending!) : <div className="service-actions">
                          <button className="primary" disabled={busy || preview} onClick={() => setPending(decideAction(approval, "approve"))}>{t("ops.approvals.approve")}</button>
                          <button className="secondary" disabled={busy || preview} onClick={() => setPending(decideAction(approval, "reject"))}>{t("ops.approvals.reject")}</button>
                        </div>}
                      </>}
                    </article>;
                  })}
                  {more("approvals", approvals.hidden)}
                </div>}
              </div>
            </section>

            <section className="card service-card" id="ops-adapter" aria-labelledby="ops-adapter-title">
              <div className="service-card-body">
                <h2 id="ops-adapter-title">{t("ops.adapter.title")}</h2>
                <p className="service-muted">{t("ops.adapter.text")}</p>
                <h3>{t("ops.adapter.payments")}</h3>
                {payments.total === 0 ? <p>{t("ops.adapter.nonePayments")}</p> : <ul className="ops-list">
                  {payments.rows.map((payment) => <li key={payment.id} aria-label={`${payment.owner_username} · ${payment.event_id}`}>
                    <div className="ops-row">
                      <div><strong>{money(payment.amount, payment.currency)} → {payment.beneficiary_name}</strong>
                        <small>{payment.owner_username} · {payment.event_id} · {t("ops.adapter.submitted", { time: when(payment.submitted_at) })}</small></div>
                      <span className={`status-chip status-${payment.status}`}>{t(`pay.status.${payment.status}` as MessageKey)}</span>
                    </div>
                    {isPending(`payment:${payment.id}`) ? confirmBox(pending!) : <div className="service-actions">
                      {paymentOutcomes(payment).map((outcome) => <button key={outcome} className={outcome === "settled" ? "primary" : "secondary"} disabled={busy || preview}
                        onClick={() => setPending(paymentAction(payment, outcome))}>{t(`ops.outcome.${outcome}` as MessageKey)}</button>)}
                    </div>}
                  </li>)}
                </ul>}
                {more("payments", payments.hidden)}
                <h3>{t("ops.adapter.orders")}</h3>
                {orders.total === 0 ? <p>{t("ops.adapter.noneOrders")}</p> : <ul className="ops-list">
                  {orders.rows.map((order) => <li key={order.id} aria-label={`${order.owner_username} · ${order.send_currency} → ${order.receive_currency}`}>
                    <div className="ops-row">
                      <div><strong>{money(order.send_amount, order.send_currency)} → {money(order.receive_amount, order.receive_currency)}</strong>
                        <small>{order.owner_username} · {order.recipient === "SELF" ? t("ops.target.self") : order.beneficiary_name} · {t("ops.adapter.expected", { date: formatDate(order.expected_latest, lang) })}</small></div>
                      <span className="status-chip status-pending">{t(`ops.orderStatus.${order.status}` as MessageKey)}</span>
                    </div>
                    {isPending(`order:${order.id}`) ? confirmBox(pending!) : <div className="service-actions">
                      {orderOutcomes(order).map((outcome) => <button key={outcome} className={outcome === "delivered" ? "primary" : "secondary"} disabled={busy || preview}
                        onClick={() => setPending(orderAction(order, outcome))}>{t(`ops.outcome.${outcome}` as MessageKey)}</button>)}
                    </div>}
                  </li>)}
                </ul>}
                {more("orders", orders.hidden)}
              </div>
            </section>

            <section className="card service-card" id="ops-payees" aria-labelledby="ops-payees-title">
              <div className="service-card-body">
                <h2 id="ops-payees-title">{t("ops.payees.title")}</h2>
                <p className="service-muted">{t("ops.payees.text")}</p>
                {payees.total === 0 ? <p>{t("ops.payees.none")}</p> : <ul className="ops-list">
                  {payees.rows.map((payee) => <li key={payee.id} aria-label={`${payee.owner_username} · ${payee.name}`}>
                    <div className="ops-row">
                      <div><strong>{payee.name}</strong><small>{payee.owner_username} · {payee.destination_label} · {when(payee.created_at)}</small></div>
                    </div>
                    {isPending(`verify:${payee.id}`) ? confirmBox(pending!) : <div className="service-actions">
                      <button className="secondary" disabled={busy || preview} onClick={() => setPending(verifyAction(payee.id, payee.name))}>{t("ops.payees.verify")}</button>
                    </div>}
                  </li>)}
                </ul>}
                {more("payees", payees.hidden)}
              </div>
            </section>

            <section className="card service-card" id="ops-loans" aria-labelledby="ops-loans-title">
              <div className="service-card-body">
                <h2 id="ops-loans-title">{t("ops.loans.title")}</h2>
                <p className="service-muted">{t("ops.loans.text")}</p>
                {loans.total === 0 ? <p>{t("ops.loans.none")}</p> : <ul className="ops-list">
                  {loans.rows.map((application) => <li key={application.id} aria-label={`${application.owner_username} · ${t("ops.loans.item")}`}>
                    <div className="ops-row">
                      <div><strong>{money(application.quote.principal, application.quote.currency)} · {t("ops.loans.months", { months: application.quote.months })}</strong>
                        <small>{application.owner_username} · {t("ops.loans.net", { amount: money(application.quote.net_proceeds, application.quote.currency) })} · {t("ops.loans.installment", { amount: money(application.quote.maximum_installment, application.quote.currency) })}</small>
                        {application.status === "UNDER_REVIEW" && <small>{t("ops.loans.assessment", { status: application.assessment.status ?? "—" })}{application.assessment.missing_inputs?.length ? ` · ${t("ops.loans.missing", { items: application.assessment.missing_inputs.join(", ") })}` : ""}</small>}
                      </div>
                      <span className={`status-chip ${application.status === "APPROVED" ? "status-approved" : "status-pending"}`}>{t(`ops.loanStatus.${application.status}` as MessageKey)}</span>
                    </div>
                    {isPending(`loan:${application.id}`) ? confirmBox(pending!) : <div className="service-actions">
                      {application.status === "UNDER_REVIEW"
                        ? <button className="secondary" disabled={busy || preview} onClick={() => setPending(loanDecisionAction(application))}>{t("ops.loans.reassess")}</button>
                        : <button className="primary" disabled={busy || preview} onClick={() => setPending(disburseAction(application))}>{t("ops.loans.disburse")}</button>}
                    </div>}
                  </li>)}
                </ul>}
                {more("loans", loans.hidden)}
              </div>
            </section>

            <section className="card service-card" id="ops-sponsors" aria-labelledby="ops-sponsors-title">
              <div className="service-card-body">
                <h2 id="ops-sponsors-title">{t("ops.sponsors.title")}</h2>
                <p className="service-muted">{t("ops.sponsors.text")}</p>
                {sponsors.total === 0 ? <p>{t("ops.sponsors.none")}</p> : <ul className="ops-list">
                  {sponsors.rows.map((request) => <li key={request.id} aria-label={`${request.owner_username} · ${request.purpose}`}>
                    <div className="ops-row">
                      <div><strong>{money(request.source.amount, request.source.currency)} · {request.purpose}</strong>
                        <small>{request.owner_username} · {t("ops.sponsors.availableOn", { date: formatDate(request.source.available_on, lang) })}{request.token_expires_at && request.status !== "CONFIRMED" ? ` · ${t("ops.sponsors.linkExpires", { time: when(request.token_expires_at) })}` : ""}</small></div>
                      <span className={`status-chip ${request.status === "CONFIRMED" ? "status-confirmed" : "status-pending"}`}>{t(`ops.sponsorStatus.${request.status}` as MessageKey)}</span>
                    </div>
                    {issued?.id === request.id && <div className="ops-confirm" role="status">
                      <p>{t("ops.sponsors.linkReady", { time: when(issued.expires) })}</p>
                      <input className="ops-link" readOnly value={issued.url} aria-label={t("ops.sponsors.link")} onFocus={(event) => event.currentTarget.select()} />
                      <div className="service-actions"><button className="secondary" onClick={() => void navigator.clipboard?.writeText(issued.url)}>{t("ops.sponsors.copy")}</button></div>
                    </div>}
                    {isPending(`sponsor:${request.id}`) ? confirmBox(pending!) : <div className="service-actions">
                      {request.status === "CONFIRMED"
                        ? <button className="primary" disabled={busy || preview} onClick={() => setPending(receiveAction(request))}>{t("ops.sponsors.receive")}</button>
                        : <button className="secondary" disabled={busy || preview} onClick={() => setPending(issueLinkAction(request))}>{request.token_expires_at ? t("ops.sponsors.reissue") : t("ops.sponsors.issue")}</button>}
                    </div>}
                  </li>)}
                </ul>}
                {more("sponsors", sponsors.hidden)}
              </div>
            </section>

            <section className="card service-card" id="ops-decisions" aria-labelledby="ops-decisions-title">
              <div className="service-card-body">
                <h2 id="ops-decisions-title">{t("ops.decisions.title")}</h2>
                {queue.recent_decisions.filter(matches).length === 0 ? <p>{t("ops.decisions.none")}</p> : <div className="table-scroll"><table className="service-table">
                  <thead><tr><th>{t("ops.decisions.request")}</th><th>{t("ops.decisions.student")}</th><th>{t("ops.decisions.status")}</th><th>{t("ops.decisions.by")}</th></tr></thead>
                  <tbody>{queue.recent_decisions.filter(matches).map((row) => <tr key={row.id}>
                    <td>{actionName(row.action)} · {money(row.amount, row.currency)}{row.decision_note && <small>{row.decision_note}</small>}</td>
                    <td>{row.owner_username}</td>
                    <td><span className={`status-chip status-${row.status.toLowerCase()}`}>{t(`approval.${row.status}` as MessageKey)}</span></td>
                    <td>{row.decided_by_username ?? "—"}<small>{when(row.decided_at)}</small></td>
                  </tr>)}</tbody>
                </table></div>}
              </div>
            </section>
          </>;
          })()}
        </main>
        <footer>{t("common.footer")}<span>{t("common.simulatedFooter")}</span></footer>
      </div>
    </div>
  );
}
