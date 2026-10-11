import { getAll } from "../backend/client";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatDate, formatMoney } from "../backend/presenters";
import { loadWallet, SessionWalletClient, WalletApiError, type WalletClient } from "./client";
import { createWalletPreview, previewQuotes, type WalletPreviewScenario } from "./mockAdapter";
import type { Approval, Order, Quote, WalletSnapshot } from "./types";
import "./wallet.css";

const previewStates: Array<{ value: WalletPreviewScenario; label: string }> = [
  { value: "submitted", label: "Submitted" }, { value: "pending", label: "Approval pending" },
  { value: "refunded", label: "Failed and refunded" }, { value: "unknown", label: "Status unknown" },
  { value: "expired", label: "Quote expired" }, { value: "empty", label: "No orders" },
];
const purposes = ["tuition", "living", "family_support", "other"];
const initial: WalletSnapshot = { balances: null, corridors: [], beneficiaries: [], orders: [], approvals: [], errors: {} };
const amountPattern = /^(?=.*[1-9])\d+(?:\.\d+)?$/;
const signInUrl = `/api/auth/login/?next=${encodeURIComponent(window.location.origin+"/?wallet=1")}`;

function describeStatus(order: Order) {
  switch (order.effective_status) {
    case "CREATED": return "Prepared. Review and explicitly submit this simulated transfer.";
    case "SUBMITTED": return "Submitted to the simulated processing route. Delivery is not confirmed.";
    case "IN_TRANSIT": return "The backend reports this simulated transfer in transit.";
    case "DELIVERED": return "The backend reports delivery; reconciliation may still follow.";
    case "RECONCILED": return "The backend reports this transfer reconciled.";
    case "REFUNDED": return "The backend reports a failed transfer and a refund.";
    case "UNKNOWN": return "The backend cannot confirm the outcome yet. Refresh before retrying or taking another action.";
    case "EXPIRED": return "The quote expired. Prepare a new transfer with a fresh quote.";
    case "CANCELLED": return "This prepared transfer was cancelled.";
  }
}
function message(error: unknown) {
  return error instanceof Error ? error.message : "The request could not be completed.";
}
function orderApproval(order: Order, approvals: Approval[]) {
  return approvals.find((item) => item.action === "remittance.submit" && item.target_id === order.id) ?? null;
}

export function WalletApp({ preview, onExit }: { preview: boolean; onExit: () => void }) {
  const [scenario, setScenario] = useState<WalletPreviewScenario>("submitted");
  const client = useMemo<WalletClient>(() => preview ? createWalletPreview(scenario) : new SessionWalletClient(), [preview, scenario]);
  const [snapshot, setSnapshot] = useState<WalletSnapshot>(initial);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [quotes, setQuotes] = useState<Quote[]>(preview ? previewQuotes() : []);
  const [selectedQuoteId, setSelectedQuoteId] = useState("");
  const [corridorId, setCorridorId] = useState("");
  const [sendAmount, setSendAmount] = useState("");
  const [recipient, setRecipient] = useState<"SELF" | "BENEFICIARY">("SELF");
  const [beneficiaryId, setBeneficiaryId] = useState("");
  const [purpose, setPurpose] = useState("tuition");
  const [reference, setReference] = useState("");
  const [deadline, setDeadline] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [policy, setPolicy] = useState<"" | "STEP_UP_REQUIRED" | "APPROVAL_REQUIRED">("");
  const [retrySubmit, setRetrySubmit] = useState(false);
  const [approvalReason, setApprovalReason] = useState("Semester payment");
  const passwordRef = useRef<HTMLInputElement>(null);
  const policyRef = useRef<HTMLDivElement>(null);
  const selectedOrder = snapshot.orders.find((item) => item.id === selectedOrderId) ?? snapshot.orders[0] ?? null;
  const selectedQuote = quotes.find((item) => item.id === selectedQuoteId) ?? null;
  const selectedCorridor = snapshot.corridors.find((item) => item.id === corridorId);
  const approval = selectedOrder ? orderApproval(selectedOrder, snapshot.approvals) : null;
  const unauthenticated = !preview && /^HTTP (401|403):/.test(snapshot.errors.balances ?? "") && !snapshot.balances;

  async function refresh(api = client) {
    setLoading(true);
    const result = await loadWallet(api);
    setSnapshot(result);
    setSelectedOrderId((prior) => result.orders.some((item) => item.id === prior) ? prior : result.orders[0]?.id ?? "");
    setCorridorId((prior) => result.corridors.some((item) => item.id === prior) ? prior : result.corridors[0]?.id ?? "");
    setLoading(false);
  }
  useEffect(() => {
    let active = true;
    setLoading(true); setError(""); setNotice(""); setPolicy("");
    if (preview) { setQuotes(previewQuotes()); setSelectedQuoteId(""); }
    loadWallet(client).then((result) => {
      if (!active) return;
      setSnapshot(result);
      setSelectedOrderId(result.orders[0]?.id ?? "");
      setCorridorId(result.corridors[0]?.id ?? "");
    }).catch((reason: unknown) => { if (active) setError(message(reason)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client, preview]);
  // The policy panel opens below the order; move focus there so keyboard and screen-reader users find it.
  useEffect(() => {
    if (policy === "STEP_UP_REQUIRED") passwordRef.current?.focus();
    else if (policy === "APPROVAL_REQUIRED") policyRef.current?.focus();
  }, [policy]);
  async function perform(action: () => Promise<void>) {
    setBusy(true); setError(""); setNotice("");
    try { await action(); }
    catch (reason) {
      if (reason instanceof WalletApiError && reason.status === 409) {
        await refresh().catch(() => {});
        setError("The backend reports a changed or expired record. Review the latest status and request a fresh quote if needed.");
      } else setError(message(reason));
    } finally { setBusy(false); }
  }
  async function requestQuotes() {
    if (preview || !selectedCorridor) return;
    if (!amountPattern.test(sendAmount)) { setError("Enter a positive send amount. Django will validate its currency precision and route limits."); return; }
    const routes = snapshot.corridors.filter((item) => item.source_currency === selectedCorridor.source_currency && item.target_currency === selectedCorridor.target_currency);
    await perform(async () => {
      const results = await Promise.allSettled(routes.map((item) => client.post<Quote>("fx-quotes/live/", { corridor_id: item.id, send_amount: sendAmount }, `quote:${item.id}:${sendAmount}`)));
      const accepted = results.filter((item): item is PromiseFulfilledResult<Quote> => item.status === "fulfilled").map((item) => item.value);
      setQuotes(accepted); setSelectedQuoteId(accepted[0]?.id ?? "");
      if (!accepted.length) throw new Error(results.map((item) => item.status === "rejected" ? message(item.reason) : "").filter(Boolean).join(" · ") || "No executable quote was returned.");
      const rejected = results.filter((item) => item.status === "rejected").length;
      setNotice(`${accepted.length} backend-priced route${accepted.length === 1 ? "" : "s"} returned${rejected ? `; ${rejected} route${rejected === 1 ? "" : "s"} unavailable` : ""}. Review the quote expiry before creating an order.`);
    });
  }
  async function createOrder() {
    if (preview || !selectedQuote) return;
    if (recipient === "BENEFICIARY" && !snapshot.beneficiaries.some((item) => item.id === beneficiaryId && item.verified)) { setError("Choose a verified beneficiary. Verification is controlled by the backend operator."); return; }
    await perform(async () => {
      const body = { quote_id: selectedQuote.id, recipient, ...(recipient === "BENEFICIARY" ? { beneficiary_id: beneficiaryId } : {}), purpose, reference, ...(deadline ? { deadline } : {}) };
      let order: Order;
      try { order = await client.post<Order>("remittance-orders/", body, `create-order:${selectedQuote.id}`); }
      catch (reason) {
        if (reason instanceof WalletApiError && (reason.status === 0 || reason.status >= 500)) {
          await refresh();
          const existing = (await getAll<Order>(client,"remittance-orders/")).find((item) => item.quote === selectedQuote.id);
          if (existing) {
            setSelectedOrderId(existing.id); setConfirmed(false);
            setNotice("The response was lost, but Django already saved this order. Review its current status before continuing.");
            return;
          }
          setError("The order was not found after the failed response. Retry with the same quote; the request key will be reused.");
          return;
        }
        throw reason;
      }
      await refresh(); setSelectedOrderId(order.id); setConfirmed(false); setPolicy(""); setRetrySubmit(false);
      setNotice("Simulated order prepared. Review its backend-priced details before submitting.");
    });
  }
  async function loadOrder(id: string) {
    await perform(async () => {
      await refresh();
      const order = await client.get<Order>(`remittance-orders/${id}/`);
      setSnapshot((prior) => ({ ...prior, orders: [order, ...prior.orders.filter((item) => item.id !== id)] }));
      setSelectedOrderId(id); setConfirmed(false); setPolicy(""); setRetrySubmit(false);
      setNotice("Latest order status loaded from Django.");
    });
  }
  async function submitOrder(token = "", retry = false) {
    if (preview || !selectedOrder || (!confirmed && !retry)) return;
    const order = selectedOrder;
    await perform(async () => {
      try {
        const updated = await client.post<Order>(`remittance-orders/${order.id}/submit/`, { expected_version: order.version }, `submit-order:${order.id}:${order.version}`, token ? { "X-Step-Up-Token": token } : {});
        setSnapshot((prior) => ({ ...prior, orders: [updated, ...prior.orders.filter((item) => item.id !== updated.id)] }));
        await refresh();
        setPolicy(""); setRetrySubmit(false); setConfirmed(false);
        setNotice(`Django reports: ${updated.effective_status}. Refresh to follow processing.`);
      } catch (reason) {
        if (reason instanceof WalletApiError) {
          if (reason.code === "APPROVAL_REQUIRED") { setPolicy("APPROVAL_REQUIRED"); setError("A separate operator approval is required before this simulated transfer can be submitted."); return; }
          if (reason.code === "STEP_UP_REQUIRED" || reason.code === "STEP_UP_INVALID") { setPolicy("STEP_UP_REQUIRED"); setError("Re-enter your password to authorize this exact simulated transfer."); return; }
          if (reason.status === 0 || reason.status >= 500) { setRetrySubmit(true); setError("The response was lost or the server failed. Check the authoritative status, then retry this same request if it is still prepared."); return; }
        }
        throw reason;
      }
    });
  }
  async function requestApproval() {
    if (preview || !selectedOrder) return;
    const order = selectedOrder;
    await perform(async () => {
      await client.post<Approval>("approvals/", { action: "remittance.submit", target_id: order.id, amount: order.send_amount, currency: order.send_currency, reason: approvalReason }, `approval:${order.id}`);
      await refresh(); setNotice("Approval requested. An authorized operator must decide it; this screen cannot approve the request.");
    });
  }
  async function stepUpAndSubmit() {
    if (preview || !selectedOrder || !passwordRef.current?.value) { setError("Enter your password for this simulated transfer."); return; }
    const order = selectedOrder;
    const password = passwordRef.current.value;
    passwordRef.current.value = "";
    await perform(async () => {
      const grant = await client.post<{ token: string }>("auth/step-up/", { password, action: "remittance.submit", target_id: order.id, amount: order.send_amount, currency: order.send_currency }, `step-up:${order.id}:${order.version}`);
      // The single-use grant exists only in this call stack, never in React state or storage.
      let updated: Order;
      try {
        updated = await client.post<Order>(`remittance-orders/${order.id}/submit/`, { expected_version: order.version }, `submit-order:${order.id}:${order.version}`, { "X-Step-Up-Token": grant.token });
      } catch (reason) {
        if (reason instanceof WalletApiError && (reason.status === 0 || reason.status >= 500)) {
          setRetrySubmit(true);
          setError("The response was lost or the server failed. Refresh the order before retrying the same request. If it remains prepared, a new password check may be required.");
          return;
        }
        throw reason;
      }
      setSnapshot((prior) => ({ ...prior, orders: [updated, ...prior.orders.filter((item) => item.id !== updated.id)] }));
      await refresh();
      setPolicy(""); setRetrySubmit(false); setConfirmed(false);
      setNotice(`Django reports: ${updated.effective_status}.`);
    });
  }

  return <div className="app connected wallet-app"><aside><a className="brand" href="#" onClick={(event) => { event.preventDefault(); onExit(); }}><span className="brand-icon">S</span>StudyFlow<span className="brand-dot">.</span></a><div className="journey-label">STUDENT SERVICES</div><nav aria-label="Wallet sections"><a href="#wallet-balances">Balances</a><a href="#wallet-quote">Compare routes</a><a href="#wallet-order">Review transfer</a><a href="#wallet-history">History</a></nav><div className="sidebar-note"><strong>Simulated money, real controls.</strong><p>Django prices quotes, guards transfers, and reports every balance and status.</p></div><button className="secondary" onClick={onExit}>Back to study plan</button></aside><div className="workspace"><header><span>StudyFlow / Wallet &amp; remittance</span><span className="avatar">ST</span></header><main><div className="section-heading"><div><span className="eyebrow">STUDENT SERVICES</span><h1>Wallet &amp; transfers</h1><p>Review your simulated balances and backend-priced cross-border routes.</p></div></div><div className="preview-banner" role="status"><strong>{preview ? "Demo preview · read-only" : "Simulated money"}</strong><span>{preview ? "Fixed sample results. No Django request or transfer occurs here." : "Django owns pricing, balances, limits, approval decisions, and transfer status."}</span></div>
    {preview && <div className="wallet-controls"><label htmlFor="wallet-scenario">Preview a status</label><select id="wallet-scenario" value={scenario} onChange={(event) => setScenario(event.target.value as WalletPreviewScenario)}>{previewStates.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></div>}
    {loading && <div className="activity" role="status"><span className="activity-dot" aria-hidden="true"/>Loading wallet information…</div>}
    {error && <div className="stale-banner" role="alert">{error}</div>}{notice && <div className="demo" role="status">{notice}</div>}
    {unauthenticated && <section className="card wallet-panel" role="alert"><h2>Sign in to Django</h2><p>This wallet uses your same-origin Django session and CSRF cookie. Sign in as a student, then return here and refresh.</p><a className="primary" href={signInUrl}>Open Django sign-in</a></section>}
    <div className="wallet-toolbar"><button className="secondary" disabled={busy || loading} onClick={() => void refresh()}>Refresh from {preview ? "demo adapter" : "Django"}</button><span>Each section loads independently. A failed read can be retried.</span></div>
    <section id="wallet-balances" className="card wallet-panel"><div className="wallet-heading"><div><span className="eyebrow">01 / BALANCES</span><h2>Your wallets</h2></div><span className="count">{snapshot.balances?.is_simulated ? "Simulated" : "Backend data"}</span></div>{snapshot.errors.balances && <p className="error" role="alert">{snapshot.errors.balances}</p>}{snapshot.balances?.balances.length ? <div className="wallet-balance-grid">{snapshot.balances.balances.map((row) => <article key={row.currency}><span>{row.currency}{row.is_home ? " · Home" : ""}</span><strong>{formatMoney(row.balance, row.currency)}</strong><small>Backend available: {formatMoney(row.available_balance, row.currency)}</small>{row.indicative_home_value && !row.is_home && <small>Indicative home value: {formatMoney(row.indicative_home_value, snapshot.balances!.home_currency)}</small>}</article>)}</div> : !loading && <p>No wallet balances were returned. A demo wallet may need backend setup.</p>}</section>
    <section id="wallet-quote" className="card wallet-panel"><span className="eyebrow">02 / ROUTES</span><h2>Compare backend quotes</h2><p>The server prices each enabled route. Quotes are amount-specific, expire, and can be used once. Fixture rates are labeled.</p>{snapshot.errors.corridors && <p className="error" role="alert">{snapshot.errors.corridors}</p>}{snapshot.corridors.length ? <div className="wallet-form-row"><label>Currency route<select value={corridorId} onChange={(event) => { setCorridorId(event.target.value); setQuotes(preview ? previewQuotes() : []); setSelectedQuoteId(""); }}>{snapshot.corridors.map((item) => <option key={item.id} value={item.id}>{item.source_currency} → {item.target_currency} · {item.provider} ({item.tier})</option>)}</select></label><label>Send amount {selectedCorridor?.source_currency}<input inputMode="decimal" value={sendAmount} onChange={(event) => { setSendAmount(event.target.value); setQuotes(preview ? previewQuotes() : []); setSelectedQuoteId(""); }} placeholder="200.00"/></label>{selectedCorridor && <small>Backend route range: {formatMoney(selectedCorridor.min_amount, selectedCorridor.source_currency)} to {formatMoney(selectedCorridor.max_amount, selectedCorridor.source_currency)}.</small>}<button className="primary" disabled={preview || busy} onClick={() => void requestQuotes()}>Get backend quotes</button></div> : !loading && <p>No enabled routes were returned.</p>}{quotes.length ? <div className="wallet-quote-grid">{quotes.map((quote) => <article key={quote.id} className={selectedQuoteId === quote.id ? "selected" : ""}><h3>{quote.route_name}</h3><p><strong>{formatMoney(quote.net_received, quote.target_currency)}</strong><span>Backend reported receipt</span></p><dl><div><dt>Send</dt><dd>{formatMoney(quote.send_amount ?? quote.quoted_amount, quote.source_currency)}</dd></div><div><dt>Sender fee</dt><dd>{formatMoney(quote.sender_fee, quote.source_currency)}</dd></div><div><dt>Receiver fee</dt><dd>{formatMoney(quote.receiver_fee == null ? null : String(quote.receiver_fee), quote.target_currency)}</dd></div><div><dt>Rate</dt><dd>{quote.rate}</dd></div><div><dt>Settlement</dt><dd>{quote.settlement_min_days}–{quote.settlement_days} days</dd></div><div><dt>Expires</dt><dd>{new Date(quote.expires_at).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" })}</dd></div></dl><small>{quote.is_mock ? "Fixture-priced demo route" : `Rate source: ${quote.rate_source}`}</small><button className="secondary" disabled={preview} onClick={() => setSelectedQuoteId(quote.id)}>{selectedQuoteId === quote.id ? "Selected" : "Select quote"}</button>{Date.parse(quote.expires_at) <= Date.now() && <p className="error">This quote appears to have expired. Request a new quote; Django rejects expired quotes.</p>}</article>)}</div> : <p className="wallet-empty">{preview ? "Sample route prices appear in this preview." : "Enter an amount to request executable quotes from Django."}</p>}</section>
    <section id="wallet-order" className="card wallet-panel"><span className="eyebrow">03 / REVIEW & CONFIRM</span><h2>Prepare a simulated transfer</h2><p>Creating an order records the chosen quote. Submission is a separate, explicit action with backend permission checks.</p><div className="wallet-form-row"><label>Recipient<select aria-label="Recipient" value={recipient} onChange={(event) => setRecipient(event.target.value as "SELF" | "BENEFICIARY")}><option value="SELF">My own wallet</option><option value="BENEFICIARY">Verified beneficiary</option></select></label>{recipient === "BENEFICIARY" && <label>Beneficiary<select aria-label="Beneficiary" value={beneficiaryId} onChange={(event) => setBeneficiaryId(event.target.value)}><option value="">Choose a verified recipient</option>{snapshot.beneficiaries.map((item) => <option key={item.id} value={item.id} disabled={!item.verified}>{item.name} · {item.destination_label}{item.verified ? "" : " · not verified"}</option>)}</select></label>}<label>Purpose<select value={purpose} onChange={(event) => setPurpose(event.target.value)}>{purposes.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}</select></label><label>Reference<input value={reference} maxLength={140} onChange={(event) => setReference(event.target.value)} placeholder="Optional"/></label><label>Needed by<input type="date" value={deadline} onChange={(event) => setDeadline(event.target.value)}/></label></div><button className="primary" disabled={preview || busy || !selectedQuote} onClick={() => void createOrder()}>Create order for review</button>{!selectedQuote && !preview && <small>Choose a current quote first.</small>}
      {selectedOrder && <div className="wallet-review"><div className="wallet-heading"><div><span className="eyebrow">AUTHORITATIVE ORDER</span><h3>Transfer {selectedOrder.id.slice(0, 8)}</h3></div><span className="calendar-pill">{selectedOrder.effective_status}</span></div><p>{describeStatus(selectedOrder)}</p>{approval && <p className="wallet-approval-status">Operator approval: <strong>{approval.status}</strong>. {approval.status === "PENDING" ? "Wait for a separate operator decision." : approval.status === "APPROVED" ? "You can continue with password step-up while the approval is valid." : approval.status === "USED" ? "This approval was used for the submission." : "Request a new approval if you still want to submit."}{approval.status === "APPROVED" && selectedOrder.effective_status === "CREATED" && policy !== "STEP_UP_REQUIRED" && <> <button className="secondary" disabled={busy || preview} onClick={() => setPolicy("STEP_UP_REQUIRED")}>Continue to password check</button></>}</p>}<dl className="comparison-facts"><div><dt>Send</dt><dd>{formatMoney(selectedOrder.send_amount, selectedOrder.send_currency)}</dd></div><div><dt>Recipient</dt><dd>{selectedOrder.recipient === "SELF" ? "My own wallet" : snapshot.beneficiaries.find((item) => item.id === selectedOrder.beneficiary)?.name ?? "Verified beneficiary"}</dd></div><div><dt>Expected receipt</dt><dd>{formatMoney(selectedOrder.receive_amount, selectedOrder.receive_currency)}</dd></div><div><dt>Backend total cost</dt><dd>{formatMoney(selectedOrder.total_cost, selectedOrder.send_currency)}</dd></div><div><dt>Arrival window</dt><dd>{formatDate(selectedOrder.expected_earliest)} – {formatDate(selectedOrder.expected_latest)}</dd></div><div><dt>Deadline</dt><dd>{formatDate(selectedOrder.deadline)}</dd></div></dl>{selectedOrder.failure_reason && <p className="error">Backend failure reason: {selectedOrder.failure_reason}</p>}
        <div className="wallet-actions"><button className="secondary" disabled={busy || preview} onClick={() => void loadOrder(selectedOrder.id)}>Refresh order status</button>{selectedOrder.effective_status === "CREATED" && <><label className="wallet-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)}/>I reviewed this exact simulated transfer and want to submit it.</label><button className="primary" disabled={preview || busy || !confirmed} onClick={() => void submitOrder()}>Confirm submission</button></>}</div>
        {retrySubmit && selectedOrder.effective_status === "CREATED" && <div className="wallet-policy"><p>After checking the order status, retry the same request only if it is still prepared. The idempotency key is reused for that request.</p><button className="secondary" disabled={busy || preview} onClick={() => void submitOrder("", true)}>Retry same submission</button></div>}
        {policy === "APPROVAL_REQUIRED" && selectedOrder.effective_status === "CREATED" && <div className="wallet-policy" ref={policyRef} tabIndex={-1}><h4>Operator approval required</h4><p>A separate operator must review this request. This student screen cannot approve it.</p>{approval && <p>Backend approval status: <strong>{approval.status}</strong> · expires {new Date(approval.expires_at).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" })}</p>}{(!approval || ["REJECTED", "EXPIRED"].includes(approval.status)) && <><label>Reason for request<input value={approvalReason} maxLength={500} onChange={(event) => setApprovalReason(event.target.value)}/></label><button className="secondary" disabled={busy || preview || !approvalReason.trim()} onClick={() => void requestApproval()}>Request operator approval</button></>}</div>}
        {policy === "STEP_UP_REQUIRED" && selectedOrder.effective_status === "CREATED" && <div className="wallet-policy"><h4>Password check</h4><p>Django binds a five-minute, single-use grant to this order and amount. Your password and grant are not saved in browser storage.</p><form onSubmit={(event) => { event.preventDefault(); void stepUpAndSubmit(); }}><label>Password<input ref={passwordRef} type="password" autoComplete="current-password"/></label><button type="submit" className="primary" disabled={preview || busy}>Authorize and submit</button></form></div>}
      </div>}</section>
    <section id="wallet-history" className="card wallet-panel"><span className="eyebrow">04 / HISTORY</span><h2>Transfer history</h2>{snapshot.errors.orders && <p className="error" role="alert">{snapshot.errors.orders}</p>}{snapshot.orders.length ? <div className="wallet-history"><ul>{snapshot.orders.map((item) => <li key={item.id}><button className={selectedOrder?.id === item.id ? "selected" : ""} onClick={() => void loadOrder(item.id)} disabled={busy}>{item.purpose.replaceAll("_", " ")} · {formatMoney(item.send_amount, item.send_currency)}<span>{item.effective_status}</span></button></li>)}</ul>{selectedOrder && <div><h3>Status timeline</h3><ol>{selectedOrder.history.map((event) => <li key={`${event.version}-${event.to}`}><strong>{event.to}</strong><span>{new Date(event.at).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" })}</span>{event.note && <small>{event.note}</small>}</li>)}</ol></div>}</div> : <p>No simulated remittances have been created for this student.</p>}</section>
  </main><footer>StudyFlow · Simulated wallet and remittance<span>{preview ? "Synthetic preview" : "Django controls all financial outcomes"}</span></footer></div></div>;
}
