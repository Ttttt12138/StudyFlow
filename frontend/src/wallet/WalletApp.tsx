import { FocusDialog } from "../workspace/FocusDialog";
import { useToolRefresh, useToolActive, useClearWhenHidden, useWorkspace } from "../workspace/context";
import { ModulePresentation } from "../workspace/ModulePresentation";
import { getAll } from "../backend/client";
import { Amount } from "../services/Amount";
import { ModuleNav } from "../services/ModuleNav";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatDate, formatMoney } from "../backend/presenters";
import { loadWallet, SessionWalletClient, WalletApiError, type WalletClient } from "./client";
import { createWalletPreview, previewQuotes, type WalletPreviewScenario } from "./mockAdapter";
import type { Approval, Order, Quote, WalletSnapshot } from "./types";
import "./wallet.css";
import { WalletExtras } from "./WalletExtras";
import { TierBadge } from "../services/TierBadge";
import { intlLocale, useI18n, type MessageKey } from "../i18n";

const previewStates: WalletPreviewScenario[] = ["submitted", "pending", "refunded", "unknown", "expired", "empty"];
const purposes = ["tuition", "living", "family_support", "other"];
const initial: WalletSnapshot = { balances: null, corridors: [], beneficiaries: [], orders: [], approvals: [], errors: {} };
const amountPattern = /^(?=.*[1-9])\d+(?:\.\d+)?$/;
const signInUrl = `/api/auth/login/?next=${encodeURIComponent(window.location.origin+"/?wallet=1")}`;

function orderApproval(order: Order, approvals: Approval[]) {
  return approvals.find((item) => item.action === "remittance.submit" && item.target_id === order.id) ?? null;
}

export function WalletApp({ preview, onExit }: { preview: boolean; onExit: () => void }) {
  const { lang, t } = useI18n();
  const toolActive = useToolActive();
  const describeStatus = (order: Order) => t(`wallet.status.${order.effective_status}` as MessageKey);
  const message = (error: unknown) => error instanceof Error ? error.message : t("wallet.err.generic");
  const money = (value: unknown, currency?: string) => formatMoney(value, currency, lang);
  const date = (value: unknown) => formatDate(value, lang);
  const stamp = (value: string) => new Date(value).toLocaleString(intlLocale(lang), { dateStyle: "medium", timeStyle: "short" });
  const purposeName = (value: string) => purposes.includes(value) ? t(`wallet.purpose.${value}` as MessageKey) : value.replaceAll("_", " ");
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
  const [approvalReason, setApprovalReason] = useState(() => t("wallet.reason.default"));
  const passwordRef = useRef<HTMLInputElement>(null);
  const policyRef = useRef<HTMLDivElement>(null);
  const selectedOrder = snapshot.orders.find((item) => item.id === selectedOrderId) ?? snapshot.orders[0] ?? null;
  const selectedQuote = quotes.find((item) => item.id === selectedQuoteId) ?? null;
  const selectedCorridor = snapshot.corridors.find((item) => item.id === corridorId);
  const approval = selectedOrder ? orderApproval(selectedOrder, snapshot.approvals) : null;
  const unauthenticated = !preview && /^HTTP (401|403):/.test(snapshot.errors.balances ?? "") && !snapshot.balances;

  useClearWhenHidden(() => { if (passwordRef.current) passwordRef.current.value = ""; setPolicy(""); });
  async function refresh(api = client) {
    setLoading(true);
    const result = await loadWallet(api);
    setSnapshot(result);
    setSelectedOrderId((prior) => result.orders.some((item) => item.id === prior) ? prior : result.orders[0]?.id ?? "");
    setCorridorId((prior) => result.corridors.some((item) => item.id === prior) ? prior : result.corridors[0]?.id ?? "");
    setLoading(false);
    return result;
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
    if (toolActive && policy === "STEP_UP_REQUIRED") passwordRef.current?.focus();
    else if (toolActive && policy === "APPROVAL_REQUIRED") policyRef.current?.focus();
  }, [policy]);
  async function perform(action: () => Promise<void>) {
    setBusy(true); setError(""); setNotice("");
    try { await action(); }
    catch (reason) {
      if (reason instanceof WalletApiError && reason.status === 409) {
        await refresh().catch(() => {});
        setError(t("wallet.err.changed"));
      } else setError(message(reason));
    } finally { setBusy(false); }
  }
  async function requestQuotes() {
    if (preview || !selectedCorridor) return;
    if (!amountPattern.test(sendAmount)) { setError(t("wallet.err.amount")); return; }
    const routes = snapshot.corridors.filter((item) => item.source_currency === selectedCorridor.source_currency && item.target_currency === selectedCorridor.target_currency);
    await perform(async () => {
      const results = await Promise.allSettled(routes.map((item) => client.post<Quote>("fx-quotes/live/", { corridor_id: item.id, send_amount: sendAmount }, `quote:${item.id}:${sendAmount}`)));
      const accepted = results.filter((item): item is PromiseFulfilledResult<Quote> => item.status === "fulfilled").map((item) => item.value);
      setQuotes(accepted); setSelectedQuoteId(accepted[0]?.id ?? "");
      if (!accepted.length) throw new Error(results.map((item) => item.status === "rejected" ? message(item.reason) : "").filter(Boolean).join(" · ") || t("wallet.err.noQuote"));
      const rejected = results.filter((item) => item.status === "rejected").length;
      setNotice(t(accepted.length === 1 ? "wallet.notice.quotesOne" : "wallet.notice.quotesMany", { n: accepted.length }) + (rejected ? t(rejected === 1 ? "wallet.notice.unavailableOne" : "wallet.notice.unavailableMany", { n: rejected }) : "") + t("wallet.notice.quotesTail"));
    });
  }
  async function createOrder() {
    if (preview || !selectedQuote) return;
    if (recipient === "BENEFICIARY" && !snapshot.beneficiaries.some((item) => item.id === beneficiaryId && item.verified)) { setError(t("wallet.err.beneficiary")); return; }
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
            setNotice(t("wallet.notice.orderSaved"));
            return;
          }
          setError(t("wallet.err.orderNotFound"));
          return;
        }
        throw reason;
      }
      await refresh(); setSelectedOrderId(order.id); setConfirmed(false); setPolicy(""); setRetrySubmit(false);
      setNotice(t("wallet.notice.orderPrepared"));
    });
  }
  async function loadOrder(id: string) {
    await perform(async () => {
      await refresh();
      const order = await client.get<Order>(`remittance-orders/${id}/`);
      setSnapshot((prior) => ({ ...prior, orders: [order, ...prior.orders.filter((item) => item.id !== id)] }));
      setSelectedOrderId(id); setConfirmed(false); setPolicy(""); setRetrySubmit(false);
      setNotice(t("wallet.notice.orderLoaded"));
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
        setNotice(t("wallet.notice.reportsFollow", { status: updated.effective_status }));
      } catch (reason) {
        if (reason instanceof WalletApiError) {
          if (reason.code === "APPROVAL_REQUIRED") { setPolicy("APPROVAL_REQUIRED"); setError(t("wallet.err.approvalRequired")); return; }
          if (reason.code === "STEP_UP_REQUIRED" || reason.code === "STEP_UP_INVALID") { setPolicy("STEP_UP_REQUIRED"); setError(t("wallet.err.stepUpRequired")); return; }
          if (reason.status === 0 || reason.status >= 500) { setRetrySubmit(true); setError(t("wallet.err.lostSubmit")); return; }
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
      setPolicy(""); await refresh(); setNotice(t("wallet.notice.approvalRequested"));
    });
  }
  async function stepUpAndSubmit() {
    if (preview || !selectedOrder || !passwordRef.current?.value) { setError(t("wallet.err.password")); return; }
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
          setError(t("wallet.err.lostStepUp"));
          return;
        }
        throw reason;
      }
      setSnapshot((prior) => ({ ...prior, orders: [updated, ...prior.orders.filter((item) => item.id !== updated.id)] }));
      await refresh();
      setPolicy(""); setRetrySubmit(false); setConfirmed(false);
      setNotice(t("wallet.notice.reports", { status: updated.effective_status }));
    });
  }

  const staleStatus = useToolRefresh(() => refresh());
  const content = <>{staleStatus}<div className="section-heading"><div><span className="eyebrow">{t("wallet.side.label")}</span><h1>{t("wallet.title")}</h1><p>{t("wallet.intro")}</p></div></div><div className="preview-banner" role="status"><strong>{preview ? t("wallet.banner.preview") : t("common.simulatedMoney")}</strong><span>{preview ? t("wallet.banner.previewText") : t("wallet.banner.liveText")}</span></div>
    {preview && <div className="wallet-controls"><label htmlFor="wallet-scenario">{t("wallet.previewStatus")}</label><select id="wallet-scenario" value={scenario} onChange={(event) => setScenario(event.target.value as WalletPreviewScenario)}>{previewStates.map((value) => <option value={value} key={value}>{t(`wallet.preview.${value}`)}</option>)}</select></div>}
    {loading && <div className="activity" role="status"><span className="activity-dot" aria-hidden="true"/>{t("wallet.loading")}</div>}
    {error && !policy && <div className="stale-banner" role="alert">{error}</div>}{notice && <div className="demo" role="status">{notice}</div>}
    {unauthenticated && <section className="card wallet-panel" role="alert"><h2>{t("wallet.signIn.title")}</h2><p>{t("wallet.signIn.text")}</p><a className="primary" href={signInUrl}>{t("wallet.signIn.link")}</a></section>}
    <div className="wallet-toolbar"><button className="secondary" disabled={busy || loading} onClick={() => void refresh()}>{t("wallet.refreshFrom", { source: preview ? t("wallet.source.demo") : t("wallet.source.django") })}</button><span>{t("wallet.toolbarNote")}</span></div>
    <section id="wallet-balances" className="card wallet-panel"><div className="wallet-heading"><div><span className="eyebrow">{t("wallet.balances.eyebrow")}</span><h2>{t("wallet.balances.title")}</h2></div><span className="count">{snapshot.balances?.is_simulated ? t("wallet.balances.simulated") : t("wallet.balances.backendData")}</span></div>{snapshot.errors.balances && <p className="error" role="alert">{snapshot.errors.balances}</p>}{snapshot.balances?.balances.length ? <div className="wallet-balance-grid">{snapshot.balances.balances.map((row) => <article key={row.currency}><span>{row.currency}{row.is_home ? t("wallet.balances.home") : ""}</span><strong><Amount text={money(row.balance, row.currency)} /></strong><small>{t("wallet.balances.available", { amount: money(row.available_balance, row.currency) })}</small>{row.indicative_home_value && !row.is_home && <small>{t("wallet.balances.indicative", { amount: money(row.indicative_home_value, snapshot.balances!.home_currency) })}</small>}</article>)}</div> : !loading && <p>{t("wallet.balances.none")}</p>}</section>
    <section id="wallet-quote" className="card wallet-panel"><span className="eyebrow">{t("wallet.quote.eyebrow")}</span><h2>{t("wallet.quote.title")}</h2><p>{t("wallet.quote.text")}</p>{snapshot.errors.corridors && <p className="error" role="alert">{snapshot.errors.corridors}</p>}{snapshot.corridors.length ? <div className="wallet-form-row"><label>{t("wallet.quote.route")}<select value={corridorId} onChange={(event) => { setCorridorId(event.target.value); setQuotes(preview ? previewQuotes() : []); setSelectedQuoteId(""); }}>{snapshot.corridors.map((item) => <option key={item.id} value={item.id}>{item.source_currency} → {item.target_currency} · {item.provider} ({item.tier})</option>)}</select></label><label>{t("wallet.quote.sendAmount")} {selectedCorridor?.source_currency}<input inputMode="decimal" value={sendAmount} onChange={(event) => { setSendAmount(event.target.value); setQuotes(preview ? previewQuotes() : []); setSelectedQuoteId(""); }} placeholder="200.00"/></label>{selectedCorridor && <small>{t("wallet.quote.range", { min: money(selectedCorridor.min_amount, selectedCorridor.source_currency), max: money(selectedCorridor.max_amount, selectedCorridor.source_currency) })}</small>}<button className="primary" disabled={preview || busy} onClick={() => void requestQuotes()}>{t("wallet.quote.get")}</button></div> : !loading && <p>{t("wallet.quote.noRoutes")}</p>}{quotes.length ? <div className="wallet-quote-grid">{quotes.map((quote) => <article key={quote.id} className={selectedQuoteId === quote.id ? "selected" : ""}><h3>{quote.route_name}</h3><p><strong><Amount text={money(quote.net_received, quote.target_currency)} /></strong><span>{t("wallet.quote.receipt")}</span></p><dl><div><dt>{t("wallet.quote.send")}</dt><dd>{money(quote.send_amount ?? quote.quoted_amount, quote.source_currency)}</dd></div><div><dt>{t("wallet.quote.senderFee")}</dt><dd>{money(quote.sender_fee, quote.source_currency)}</dd></div><div><dt>{t("wallet.quote.receiverFee")}</dt><dd>{money(quote.receiver_fee == null ? null : String(quote.receiver_fee), quote.target_currency)}</dd></div><div><dt>{t("wallet.quote.rate")}</dt><dd>{quote.rate}</dd></div><div><dt>{t("wallet.quote.settlement")}</dt><dd>{t("wallet.quote.days", { min: quote.settlement_min_days, max: quote.settlement_days })}</dd></div><div><dt>{t("wallet.quote.expires")}</dt><dd>{stamp(quote.expires_at)}</dd></div></dl><small>{quote.is_mock ? t("wallet.quote.fixture") : t("wallet.quote.source", { source: quote.rate_source })}</small><button className="secondary" disabled={preview} onClick={() => setSelectedQuoteId(quote.id)}>{selectedQuoteId === quote.id ? t("wallet.quote.selected") : t("wallet.quote.select")}</button>{Date.parse(quote.expires_at) <= Date.now() && <p className="error">{t("wallet.quote.expired")}</p>}</article>)}</div> : <p className="wallet-empty">{preview ? t("wallet.quote.emptyPreview") : t("wallet.quote.empty")}</p>}</section>
    <section id="wallet-order" className="card wallet-panel"><span className="eyebrow">{t("wallet.order.eyebrow")}</span><h2>{t("wallet.order.title")}</h2><p>{t("wallet.order.text")}</p><div className="wallet-form-row"><label>{t("wallet.order.recipient")}<select aria-label={t("wallet.order.recipient")} value={recipient} onChange={(event) => setRecipient(event.target.value as "SELF" | "BENEFICIARY")}><option value="SELF">{t("wallet.order.self")}</option><option value="BENEFICIARY">{t("wallet.order.beneficiary")}</option></select></label>{recipient === "BENEFICIARY" && <label>{t("wallet.order.beneficiaryLabel")}<select aria-label={t("wallet.order.beneficiaryLabel")} value={beneficiaryId} onChange={(event) => setBeneficiaryId(event.target.value)}><option value="">{t("wallet.order.chooseBeneficiary")}</option>{snapshot.beneficiaries.map((item) => <option key={item.id} value={item.id} disabled={!item.verified}>{item.name} · {item.destination_label}{item.verified ? "" : t("wallet.order.notVerified")}</option>)}</select></label>}<label>{t("wallet.order.purpose")}<select value={purpose} onChange={(event) => setPurpose(event.target.value)}>{purposes.map((item) => <option key={item} value={item}>{purposeName(item)}</option>)}</select></label><label>{t("wallet.order.reference")}<input value={reference} maxLength={140} onChange={(event) => setReference(event.target.value)} placeholder={t("wallet.order.optional")}/></label><label>{t("wallet.order.neededBy")}<input type="date" value={deadline} onChange={(event) => setDeadline(event.target.value)}/></label></div><button className="primary" disabled={preview || busy || !selectedQuote} onClick={() => void createOrder()}>{t("wallet.order.create")}</button>{!selectedQuote && !preview && <small>{t("wallet.order.chooseQuote")}</small>}
      {selectedOrder && <div className="wallet-review"><div className="wallet-heading"><div><span className="eyebrow">{t("wallet.order.authoritative")}</span><h3>{t("wallet.order.transfer", { id: selectedOrder.id.slice(0, 8) })}</h3></div><span className="calendar-pill">{selectedOrder.effective_status}</span></div><p>{describeStatus(selectedOrder)}</p>{approval && <p className="wallet-approval-status">{t("wallet.approval.label")} <strong>{approval.status}</strong>. {["PENDING", "APPROVED", "USED"].includes(approval.status) ? t(`wallet.approval.${approval.status}` as MessageKey) : t("wallet.approval.other")}{approval.status === "APPROVED" && selectedOrder.effective_status === "CREATED" && policy !== "STEP_UP_REQUIRED" && <> <button className="secondary" disabled={busy || preview} onClick={() => setPolicy("STEP_UP_REQUIRED")}>{t("wallet.approval.continue")}</button></>}</p>}<dl className="comparison-facts"><div><dt>{t("wallet.quote.send")}</dt><dd>{money(selectedOrder.send_amount, selectedOrder.send_currency)}</dd></div><div><dt>{t("wallet.order.recipient")}</dt><dd>{selectedOrder.recipient === "SELF" ? t("wallet.order.self") : snapshot.beneficiaries.find((item) => item.id === selectedOrder.beneficiary)?.name ?? t("wallet.order.beneficiary")}</dd></div><div><dt>{t("wallet.order.expectedReceipt")}</dt><dd>{money(selectedOrder.receive_amount, selectedOrder.receive_currency)}</dd></div><div><dt>{t("wallet.order.totalCost")}</dt><dd>{money(selectedOrder.total_cost, selectedOrder.send_currency)}</dd></div><div><dt>{t("wallet.order.arrival")}</dt><dd>{date(selectedOrder.expected_earliest)} – {date(selectedOrder.expected_latest)}</dd></div><div><dt>{t("wallet.order.deadline")}</dt><dd>{date(selectedOrder.deadline)}</dd></div></dl>{selectedOrder.failure_reason && <p className="error">{t("wallet.order.failure", { reason: selectedOrder.failure_reason })}</p>}
        <div className="wallet-actions"><button className="secondary" disabled={busy || preview} onClick={() => void loadOrder(selectedOrder.id)}>{t("wallet.order.refresh")}</button>{selectedOrder.effective_status === "CREATED" && <><label className="wallet-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)}/>{t("wallet.order.confirmCheck")}</label><button className="primary" disabled={preview || busy || !confirmed} onClick={() => void submitOrder()}>{t("wallet.order.confirm")}</button></>}</div>
        {retrySubmit && selectedOrder.effective_status === "CREATED" && <div className="wallet-policy"><p>{t("wallet.order.retryText")}</p><button className="secondary" disabled={busy || preview} onClick={() => void submitOrder("", true)}>{t("wallet.order.retry")}</button></div>}
        {policy === "APPROVAL_REQUIRED" && selectedOrder.effective_status === "CREATED" && <FocusDialog title={t("ws.confirm")} busy={busy} onClose={() => setPolicy("")}><p>{money(selectedOrder.send_amount, selectedOrder.send_currency)} · {selectedOrder.id.slice(0, 8)}</p>{error && <p role="alert" className="error">{error}</p>}<div className="wallet-policy" ref={policyRef} tabIndex={-1}><h4><TierBadge tier="T3"/> {t("wallet.policy.approvalTitle")}</h4><p>{t("wallet.policy.approvalText")}</p>{approval && <p>{t("wallet.policy.approvalStatus")} <strong>{approval.status}</strong> · {t("wallet.policy.expires", { date: stamp(approval.expires_at) })}</p>}{(!approval || ["REJECTED", "EXPIRED"].includes(approval.status)) && <><label>{t("wallet.policy.reason")}<input value={approvalReason} maxLength={500} onChange={(event) => setApprovalReason(event.target.value)}/></label><button className="secondary" disabled={busy || preview || !approvalReason.trim()} onClick={() => void requestApproval()}>{t("wallet.policy.request")}</button></>}</div>{retrySubmit && <button className="secondary" disabled={busy} onClick={() => void loadOrder(selectedOrder.id)}>{t("wallet.order.refresh")}</button>}<button className="secondary" disabled={busy} onClick={() => setPolicy("")}>{t("common.cancel")}</button></FocusDialog>}
        {policy === "STEP_UP_REQUIRED" && selectedOrder.effective_status === "CREATED" && <FocusDialog title={t("ws.confirm")} busy={busy} onClose={() => setPolicy("")}><p>{money(selectedOrder.send_amount, selectedOrder.send_currency)} · {selectedOrder.id.slice(0, 8)}</p>{error && <p role="alert" className="error">{error}</p>}<div className="wallet-policy"><h4><TierBadge tier="T2"/> {t("wallet.policy.stepUpTitle")}</h4><p>{t("wallet.policy.stepUpText")}</p><form onSubmit={(event) => { event.preventDefault(); void stepUpAndSubmit(); }}><label>{t("wallet.policy.password")}<input ref={passwordRef} type="password" autoComplete="current-password"/></label><button type="submit" className="primary" disabled={preview || busy}>{t("wallet.policy.submit")}</button></form></div>{retrySubmit && <button className="secondary" disabled={busy} onClick={() => void loadOrder(selectedOrder.id)}>{t("wallet.order.refresh")}</button>}<button className="secondary" disabled={busy} onClick={() => setPolicy("")}>{t("common.cancel")}</button></FocusDialog>}
      </div>}</section>
    <WalletExtras client={client} preview={preview} onChanged={() => void refresh()} />
    <section id="wallet-history" className="card wallet-panel"><span className="eyebrow">{t("wallet.history.eyebrow")}</span><h2>{t("wallet.history.title")}</h2>{snapshot.errors.orders && <p className="error" role="alert">{snapshot.errors.orders}</p>}{snapshot.orders.length ? <div className="wallet-history"><ul>{snapshot.orders.map((item) => <li key={item.id}><button className={selectedOrder?.id === item.id ? "selected" : ""} onClick={() => void loadOrder(item.id)} disabled={busy}>{purposeName(item.purpose)} · {money(item.send_amount, item.send_currency)}<span>{item.effective_status}</span></button></li>)}</ul>{selectedOrder && <div><h3>{t("wallet.history.timeline")}</h3><ol>{selectedOrder.history.map((event) => <li key={`${event.version}-${event.to}`}><strong>{event.to}</strong><span>{stamp(event.at)}</span>{event.note && <small>{event.note}</small>}</li>)}</ol></div>}</div> : <p>{t("wallet.history.none")}</p>}</section>
  </>;
  return <ModulePresentation className="wallet-app" fullPage={(<div className="app connected wallet-app"><aside><a className="brand" href="#" onClick={(event) => { event.preventDefault(); onExit(); }}><span className="brand-icon">S</span>StudyFlow<span className="brand-dot">.</span></a><ModuleNav /><div className="journey-label">{t("wallet.side.label")}</div><nav aria-label={t("wallet.side.nav")}><a href="#wallet-balances">{t("wallet.side.balances")}</a><a href="#wallet-quote">{t("wallet.side.routes")}</a><a href="#wallet-order">{t("wallet.side.review")}</a><a href="#wallet-history">{t("wallet.side.history")}</a></nav><div className="sidebar-note"><strong>{t("wallet.side.noteTitle")}</strong><p>{t("wallet.side.noteText")}</p></div><button className="secondary" onClick={onExit}>{t("common.backToPlan")}</button></aside><div className="workspace"><header><span>{t("wallet.crumb")}</span><span className="avatar">ST</span></header><main>{content}</main><footer>{t("wallet.footer")}<span>{preview ? t("wallet.footer.preview") : t("wallet.footer.live")}</span></footer></div></div>)}>{content}</ModulePresentation>;
}
