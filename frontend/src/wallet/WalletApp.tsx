import { TopUpForm } from "./TopUpForm";
import type { ExchangeWant } from "./PlanBillsPay";
import { FocusDialog } from "../workspace/FocusDialog";
import { useToolRefresh, useToolActive, useClearWhenHidden, useWorkspace, useEmbedded } from "../workspace/context";
import { ModulePresentation } from "../workspace/ModulePresentation";
import { getAll } from "../backend/client";
import { Amount } from "../services/Amount";
import { ModuleNav } from "../services/ModuleNav";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatDate, formatMoney, formatRate } from "../backend/presenters";
import { loadWallet, SessionWalletClient, WalletApiError, type WalletClient } from "./client";
import { createWalletPreview, previewQuotes, type WalletPreviewScenario } from "./mockAdapter";
import { CreditLoop } from "./CreditLoop";
import type { Approval, Order, Quote, WalletSnapshot } from "./types";
import "./wallet.css";
import "./walletPanel.css";
import { WalletExtras } from "./WalletExtras";
import { TierBadge } from "../services/TierBadge";
import { PanelAlert, PanelEmpty, PanelFacts, PanelHero, PanelMenu, PanelPager, PanelSheet, PanelSkeleton, ToolPanel, usePage } from "../workspace/ToolPanel";
import { BarCompare, DateWindow, StackBar, StepTrack } from "../workspace/PanelCharts";
import { intlLocale, useI18n, type MessageKey } from "../i18n";

const previewStates: WalletPreviewScenario[] = ["submitted", "pending", "refunded", "unknown", "expired", "empty"];
const purposes = ["tuition", "living", "family_support", "other"];
const initial: WalletSnapshot = { balances: null, corridors: [], beneficiaries: [], orders: [], approvals: [], errors: {} };
const amountPattern = /^(?=.*[1-9])\d+(?:\.\d+)?$/;
const signInUrl = `/auth?next=${encodeURIComponent(window.location.origin+"/?wallet=1")}`;

function orderApproval(order: Order, approvals: Approval[]) {
  return approvals.find((item) => item.action === "remittance.submit" && item.target_id === order.id) ?? null;
}

export type WalletTab = "balances" | "convert" | "remit" | "history";

/** Balances, exchange, transfers and their records. Inside the money tool (MoneyHub) the hub owns the tabs: `bare` hides this panel's own tab bar. */
export function WalletApp({ preview, onExit, tab: shownTab, onTab, historyView: shownHistory, bare = false, want = null }: {
  preview: boolean; onExit: () => void; tab?: WalletTab; onTab?: (tab: WalletTab) => void; historyView?: "orders" | "ledger"; bare?: boolean;
  want?: ExchangeWant | null;
}) {
  const { lang, t } = useI18n();
  const toolActive = useToolActive();
  const embedded = useEmbedded();
  const workspace = useWorkspace();
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
  const [topUpOpen, setTopUpOpen] = useState(false);
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
  // Demo review of a pending T3 request: a simulated operator approves it 10 s after it was asked, then the password step.
  const [now, setNow] = useState(() => Date.now());
  // The browser's own request time when known; the server's created_at (plus a second for clock skew) otherwise.
  const [askedAt, setAskedAt] = useState<{ id: string; at: number } | null>(null);
  const reviewing = policy === "APPROVAL_REQUIRED" && approval?.status === "PENDING" ? approval : null;
  const readyAt = !reviewing ? 0 : askedAt?.id === reviewing.id ? askedAt.at + 10_000
    : (reviewing.created_at ? Date.parse(reviewing.created_at) + 1_000 : now) + 10_000;
  const reviewLeft = reviewing ? Math.max(0, Math.ceil((readyAt - now) / 1000)) : 0;
  useEffect(() => {
    if (!reviewing) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [reviewing?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!reviewing || reviewLeft > 0 || busy || preview) return;
    void perform(async () => {
      try { await client.post<Approval>(`approvals/${reviewing.id}/simulate/`, {}, `approval-simulate:${reviewing.id}`); }
      catch (reason) { if (reason instanceof WalletApiError && reason.code === "APPROVAL_SIMULATION_OFF") { setPolicy(""); setNotice(t("wallet.notice.approvalRequested")); return; } throw reason; }
      await refresh(); setNotice(t("shell.policy.approved")); setPolicy("STEP_UP_REQUIRED");
    });
  }, [reviewing?.id, reviewLeft]); // eslint-disable-line react-hooks/exhaustive-deps
  const unauthenticated = !preview && /^HTTP (401|403):/.test(snapshot.errors.balances ?? "") && !snapshot.balances;

  const requested = workspace?.target?.kind === "wallet" ? workspace.target.section : undefined;
  const [ownTab, setOwnTab] = useState<WalletTab>(requested === "convert" ? "convert" : requested === "quote" ? "remit" : "balances");
  const tab = shownTab ?? ownTab;
  const setTab = onTab ?? setOwnTab;
  const [remitView, setRemitView] = useState<"quote" | "order">("quote");
  const [ownHistory, setHistoryView] = useState<"orders" | "ledger">("orders");
  const historyView = shownHistory ?? ownHistory;
  const [orderPage, setOrderPage] = useState(0);
  const [recipientOpen, setRecipientOpen] = useState(false);
  useEffect(() => {
    if (!toolActive || !requested) return;
    if (requested === "convert") setTab("convert");
    if (requested === "quote") { setTab("remit"); setRemitView("quote"); }
  }, [toolActive, requested]);

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
            setSelectedOrderId(existing.id); setConfirmed(false); setRemitView("order"); setRecipientOpen(false);
            setNotice(t("wallet.notice.orderSaved"));
            return;
          }
          setError(t("wallet.err.orderNotFound"));
          return;
        }
        throw reason;
      }
      await refresh(); setSelectedOrderId(order.id); setConfirmed(false); setPolicy(""); setRetrySubmit(false); setRemitView("order"); setRecipientOpen(false);
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
      const created = await client.post<Approval>("approvals/", { action: "remittance.submit", target_id: order.id, amount: order.send_amount, currency: order.send_currency, reason: approvalReason }, `approval:${order.id}`);
      setAskedAt({ id: created.id, at: Date.now() }); setNow(Date.now()); await refresh();
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
  const balances = snapshot.balances?.balances ?? [];
  const homeRow = balances.find((row) => row.is_home) ?? balances[0];
  const orders = usePage(snapshot.orders, 5, orderPage);
  const missingIndicative = balances.filter((row) => !row.is_home && Number(row.balance) > 0 && row.indicative_home_value == null);
  const showOrder = remitView === "order" && !!selectedOrder;
  const notices = <>
    {staleStatus}
    {loading && !snapshot.balances && <PanelSkeleton />}
    {error && !policy && !recipientOpen && <div className="stale-banner" role="alert">{error}</div>}{notice && <div className="demo" role="status">{notice}</div>}
  </>;
  const menu = <PanelMenu>
    {preview && <div className="wallet-controls"><label htmlFor="wallet-scenario">{t("wallet.previewStatus")}</label><select id="wallet-scenario" value={scenario} onChange={(event) => setScenario(event.target.value as WalletPreviewScenario)}>{previewStates.map((value) => <option value={value} key={value}>{t(`wallet.preview.${value}`)}</option>)}</select></div>}
    <button type="button" className="panel-link" disabled={busy || loading} onClick={() => void refresh()}>{t("wallet.refreshFrom", { source: preview ? t("wallet.source.demo") : t("wallet.source.django") })}</button>
    <p className="panel-muted">{preview ? t("wallet.banner.previewText") : t("wallet.banner.liveText")}</p>
  </PanelMenu>;
  // Remittance progress: prepared → submitted → in transit → delivered; refunds and expiries stop in red.
  const STEPS = ["CREATED", "SUBMITTED", "IN_TRANSIT", "DELIVERED"];
  const stepOf = (status: string) => status === "RECONCILED" ? 3 : Math.max(0, STEPS.indexOf(status));
  const failedStatus = (status: string) => ["REFUNDED", "EXPIRED", "CANCELLED"].includes(status);
  const orderReview = selectedOrder && <div className="wallet-review panel-view">
    <div className="panel-card-head"><h3>{t("wallet.order.transfer", { id: selectedOrder.id.slice(0, 8) })}</h3><span className="calendar-pill">{selectedOrder.effective_status}</span></div>
    <p className="panel-note">{describeStatus(selectedOrder)}</p>
    {approval && <p className="wallet-approval-status panel-muted">{t("wallet.approval.label")} <strong>{approval.status}</strong>. {["PENDING", "APPROVED", "USED"].includes(approval.status) ? t(`wallet.approval.${approval.status}` as MessageKey) : t("wallet.approval.other")}{approval.status === "APPROVED" && selectedOrder.effective_status === "CREATED" && policy !== "STEP_UP_REQUIRED" && <> <button className="secondary" disabled={busy || preview} onClick={() => setPolicy("STEP_UP_REQUIRED")}>{t("wallet.approval.continue")}</button></>}</p>}
    <StepTrack label={t("wp.orderSteps")} current={failedStatus(selectedOrder.effective_status) ? Math.max(1, stepOf(selectedOrder.history.at(-2)?.to ?? "SUBMITTED")) : stepOf(selectedOrder.effective_status) + (["DELIVERED", "RECONCILED"].includes(selectedOrder.effective_status) ? 1 : 0)}
      failed={failedStatus(selectedOrder.effective_status)}
      steps={[t("wp.step.created"), t("wp.step.submitted"), t("wp.step.processing"), failedStatus(selectedOrder.effective_status) ? t("wp.step.failed") : t("wp.step.done")]} />
    <PanelHero label={t("wallet.order.expectedReceipt")} value={money(selectedOrder.receive_amount, selectedOrder.receive_currency)} />
    {selectedOrder.expected_earliest && selectedOrder.expected_latest && <div className="fx-figure"><div className="panel-section-title">{t("wp.arrival")}
      <span>{date(selectedOrder.expected_earliest)} – {date(selectedOrder.expected_latest)}</span></div>
      <DateWindow start={selectedOrder.expected_earliest} end={selectedOrder.expected_latest} deadline={selectedOrder.deadline}
        from={[selectedOrder.expected_earliest, selectedOrder.deadline].filter(Boolean).sort()[0]!} to={[selectedOrder.expected_latest, selectedOrder.deadline].filter(Boolean).sort().at(-1)!}
        labels={{ start: date(selectedOrder.expected_earliest), end: date(selectedOrder.expected_latest), deadline: selectedOrder.deadline ? t("wp.deadlineMark", { date: date(selectedOrder.deadline) }) : undefined }} />
      {selectedOrder.deadline && selectedOrder.expected_latest > selectedOrder.deadline && <small className="fx-warn">{t("wp.lateWarn")}</small>}</div>}
    <PanelFacts items={[[t("wallet.quote.send"), money(selectedOrder.send_amount, selectedOrder.send_currency)],
      [t("wallet.order.recipient"), selectedOrder.recipient === "SELF" ? t("wallet.order.self") : snapshot.beneficiaries.find((item) => item.id === selectedOrder.beneficiary)?.name ?? t("wallet.order.beneficiary")],
      [t("wallet.order.totalCost"), money(selectedOrder.total_cost, selectedOrder.send_currency)], [t("wallet.order.arrival"), `${date(selectedOrder.expected_earliest)} – ${date(selectedOrder.expected_latest)}`],
      [t("wallet.order.deadline"), date(selectedOrder.deadline)], [t("wallet.order.purpose"), purposeName(selectedOrder.purpose)]]} />
    {selectedOrder.history.length > 0 && <ol className="panel-rows wallet-timeline" aria-label={t("wp.timeline")}>{selectedOrder.history.slice(-3).reverse().map((event) => <li key={`${event.version}-${event.to}`}>
      <span><strong>{event.to}</strong>{event.note && <small>{event.note}</small>}</span><span className="panel-muted">{stamp(event.at)}</span></li>)}</ol>}
    {selectedOrder.failure_reason && <p className="error">{t("wallet.order.failure", { reason: selectedOrder.failure_reason })}</p>}
    {selectedOrder.effective_status === "CREATED" && <label className="panel-check"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)}/>{t("wallet.order.confirmCheck")}</label>}
    {retrySubmit && selectedOrder.effective_status === "CREATED" && <div className="panel-note is-warn"><p>{t("wallet.order.retryText")}</p><button className="secondary" disabled={busy || preview} onClick={() => void submitOrder("", true)}>{t("wallet.order.retry")}</button></div>}
    {policy === "APPROVAL_REQUIRED" && selectedOrder.effective_status === "CREATED" && <FocusDialog title={t("ws.confirm")} busy={busy} onClose={() => setPolicy("")}><p>{money(selectedOrder.send_amount, selectedOrder.send_currency)} · {selectedOrder.id.slice(0, 8)}</p>{error && <p role="alert" className="error">{error}</p>}<div className="wallet-policy" ref={policyRef} tabIndex={-1}><h4><TierBadge tier="T3"/> {t("wallet.policy.approvalTitle")}</h4><p>{t("wallet.policy.approvalText")}</p>{approval && <p>{t("wallet.policy.approvalStatus")} <strong>{approval.status}</strong> · {t("wallet.policy.expires", { date: stamp(approval.expires_at) })}</p>}{reviewing && <div role="status" aria-live="polite"><p>{t("shell.policy.contact")}</p><div className="policy-countdown" aria-hidden="true"><span style={{ width: `${(10 - reviewLeft) * 10}%` }} /></div><p className="panel-muted">{reviewLeft > 0 ? t("shell.policy.countdown", { n: reviewLeft }) : t("shell.policy.approving")}</p></div>}{(!approval || ["REJECTED", "EXPIRED"].includes(approval.status)) && <><label>{t("wallet.policy.reason")}<input value={approvalReason} maxLength={500} onChange={(event) => setApprovalReason(event.target.value)}/></label><button className="secondary" disabled={busy || preview} onClick={() => void requestApproval()}>{t("wallet.policy.request")}</button></>}</div>{retrySubmit && <button className="secondary" disabled={busy} onClick={() => void loadOrder(selectedOrder.id)}>{t("wallet.order.refresh")}</button>}<button className="secondary" disabled={busy} onClick={() => setPolicy("")}>{t("common.cancel")}</button></FocusDialog>}
    {policy === "STEP_UP_REQUIRED" && selectedOrder.effective_status === "CREATED" && <FocusDialog title={t("ws.confirm")} busy={busy} onClose={() => setPolicy("")}><p>{money(selectedOrder.send_amount, selectedOrder.send_currency)} · {selectedOrder.id.slice(0, 8)}</p>{error && <p role="alert" className="error">{error}</p>}<div className="wallet-policy"><h4><TierBadge tier="T2"/> {t("wallet.policy.stepUpTitle")}</h4><p>{t("wallet.policy.stepUpText")}</p><form onSubmit={(event) => { event.preventDefault(); void stepUpAndSubmit(); }}><label>{t("wallet.policy.password")}<input ref={passwordRef} type="password" autoComplete="current-password"/></label><button type="submit" className="primary" disabled={preview || busy}>{t("wallet.policy.submit")}</button></form></div>{retrySubmit && <button className="secondary" disabled={busy} onClick={() => void loadOrder(selectedOrder.id)}>{t("wallet.order.refresh")}</button>}<button className="secondary" disabled={busy} onClick={() => setPolicy("")}>{t("common.cancel")}</button></FocusDialog>}
  </div>;
  // Exchange and transfers start from the balance: two centred actions instead of extra tabs.
  const footer = tab === "balances" ? <div className="panel-footer-center"><button type="button" className="secondary" disabled={preview} onClick={() => setTopUpOpen(true)}>{t("topup.title")}</button>
      <button type="button" className="secondary" onClick={() => setTab("convert")}>{t("wp.tab.convert")}</button>
      <button type="button" className="primary" onClick={() => setTab("remit")}>{t("wp.tab.remit")}</button></div>
    : tab === "remit" ? showOrder && selectedOrder ? <>
      <button type="button" className="panel-link panel-footer-note" onClick={() => setRemitView("quote")}>{t("wp.newRemit")}</button>
      <button className="secondary" disabled={busy || preview} onClick={() => void loadOrder(selectedOrder.id)}>{t("wallet.order.refresh")}</button>
      {selectedOrder.effective_status === "CREATED" && <button className="primary" disabled={preview || busy || !confirmed} onClick={() => void submitOrder()}>{t("wallet.order.confirm")}</button>}</>
      : <>{selectedOrder && <button type="button" className="panel-link panel-footer-note" onClick={() => setRemitView("order")}>{t("wp.currentOrder")} · {selectedOrder.effective_status}</button>}
        <button className="primary" disabled={!preview && (busy || !selectedQuote)} onClick={() => setRecipientOpen(true)}>{t("wp.recipientStep")} →</button></>
    : null;

  const topUpCurrencies = snapshot.balances ? [snapshot.balances.home_currency, ...(snapshot.balances.supported_currencies ?? balances.map(row => row.currency))
    .filter(code => code !== snapshot.balances!.home_currency)] : [];
  const topUpSheet = topUpOpen && tab === "balances" && <PanelSheet title={t("topup.title")} onClose={() => setTopUpOpen(false)}>
    <TopUpForm client={client} preview={preview} currencies={topUpCurrencies} onCancel={() => setTopUpOpen(false)}
      onDone={result => { setTopUpOpen(false); setNotice(t("topup.done", { amount: money(result.amount, result.currency), balance: money(result.balance, result.currency) })); void refresh(); }} />
  </PanelSheet>;
  // Recipient and purpose open over the remit card, so routes and quotes fit on one screen.
  const recipientSheet = recipientOpen && tab === "remit" && !showOrder && <PanelSheet title={t("wp.recipientStep")} onClose={() => setRecipientOpen(false)}
    footer={<button className="primary" disabled={preview || busy || !selectedQuote} onClick={() => void createOrder()}>{t("wallet.order.create")}</button>}>
    {selectedQuote && <PanelHero label={selectedQuote.route_name} value={money(selectedQuote.net_received, selectedQuote.target_currency)}>
      <span className="panel-muted">{t("wallet.quote.receipt")} · {t("wallet.quote.send")} {money(selectedQuote.send_amount ?? selectedQuote.quoted_amount, selectedQuote.source_currency)}</span></PanelHero>}
    <div id="wallet-order" className="panel-form">
      <label>{t("wallet.order.recipient")}<select aria-label={t("wallet.order.recipient")} value={recipient} onChange={(event) => setRecipient(event.target.value as "SELF" | "BENEFICIARY")}><option value="SELF">{t("wallet.order.self")}</option><option value="BENEFICIARY">{t("wallet.order.beneficiary")}</option></select></label>
      {recipient === "BENEFICIARY" && <label>{t("wallet.order.beneficiaryLabel")}<select aria-label={t("wallet.order.beneficiaryLabel")} value={beneficiaryId} onChange={(event) => setBeneficiaryId(event.target.value)}><option value="">{t("wallet.order.chooseBeneficiary")}</option>{snapshot.beneficiaries.map((item) => <option key={item.id} value={item.id} disabled={!item.verified}>{item.name} · {item.destination_label}{item.verified ? "" : t("wallet.order.notVerified")}</option>)}</select></label>}
      <label>{t("wallet.order.purpose")}<select value={purpose} onChange={(event) => setPurpose(event.target.value)}>{purposes.map((item) => <option key={item} value={item}>{purposeName(item)}</option>)}</select></label>
      <label>{t("wallet.order.reference")}<input value={reference} maxLength={140} onChange={(event) => setReference(event.target.value)} placeholder={t("wallet.order.optional")}/></label>
      <label>{t("wallet.order.neededBy")}<input type="date" value={deadline} onChange={(event) => setDeadline(event.target.value)}/></label>
    </div>
    {error && !policy && <p className="error" role="alert">{error}</p>}
  </PanelSheet>;
  const content = <ToolPanel label={t("wallet.title")} numbered={false} active={tab} onSelect={(key) => { setTab(key); if (key === "remit" && selectedOrder?.effective_status === "CREATED") setRemitView("order"); }}
    steps={bare ? [] : [{ key: "balances", label: t("wp.tab.balances") }, { key: "convert", label: t("wp.tab.convert") }, { key: "remit", label: t("wp.tab.remit") }, { key: "history", label: t("wp.tab.history") }]}
    notices={notices} footer={footer} sheet={recipientSheet || topUpSheet} tools={menu}>
    {/* In the dock the header already names the tool; a second heading would duplicate it. */}
    {!embedded && <h1 className="sr-only">{t("wallet.title")}</h1>}
    {unauthenticated && <section className="panel-note" role="alert"><h2>{t("wallet.signIn.title")}</h2><p>{t("wallet.signIn.text")}</p><a className="primary" href={signInUrl}>{t("wallet.signIn.link")}</a></section>}
    <section id="wallet-balances" className="panel-view" hidden={tab !== "balances"}>
      <div className="panel-card-head"><h2>{t("wallet.balances.title")}</h2><span className="panel-tag">{snapshot.balances?.is_simulated ? t("wallet.balances.simulated") : t("wallet.balances.backendData")}</span></div>
      {snapshot.errors.balances && <PanelAlert message={snapshot.errors.balances} onRetry={() => void refresh()} />}
      {homeRow ? <>
        {/* Balance (left loop) and credit (right loop) as one figure; other currencies and holds are listed below it. */}
        <CreditLoop client={client} preview={preview} walletAvailable={homeRow.available_balance} currency={homeRow.currency} />
        {missingIndicative.map((row) => <small key={row.currency} className="panel-muted">{t("wp.noIndicative", { currency: row.currency })}</small>)}
        {Number(homeRow.balance) > Number(homeRow.available_balance) && <StackBar label={t("wp.availableVsHeld")} parts={[
          { key: "available", value: Number(homeRow.available_balance), tone: "mint", label: t("wp.available", { amount: money(homeRow.available_balance, homeRow.currency) }) },
          { key: "held", value: Number(homeRow.balance) - Number(homeRow.available_balance), tone: "muted", label: t("wp.onHold", { amount: money(String(Number(homeRow.balance) - Number(homeRow.available_balance)), homeRow.currency) }) }]} />}
        <ul className="panel-rows">{balances.filter((row) => row !== homeRow).map((row) => <li key={row.currency}>
          <span><strong>{row.currency}{row.is_home ? t("wallet.balances.home") : ""}</strong>
            <small>{t("wallet.balances.available", { amount: money(row.available_balance, row.currency) })}{row.indicative_home_value && !row.is_home ? ` · ${t("wallet.balances.indicative", { amount: money(row.indicative_home_value, snapshot.balances!.home_currency) })}` : ""}</small></span>
          <span><Amount text={money(row.balance, row.currency)} /></span></li>)}</ul>
      </> : !loading && <p className="panel-muted">{t("wallet.balances.none")}</p>}
    </section>
    <section id="wallet-quote" className="panel-view" hidden={tab !== "remit" || showOrder}>
      <div className="panel-card-head"><h2>{t("wallet.quote.title")}</h2></div>
      {snapshot.errors.corridors && <PanelAlert message={snapshot.errors.corridors} onRetry={() => void refresh()} />}
      {snapshot.corridors.length ? <div className="panel-form">
        <label>{t("wallet.quote.route")}<select value={corridorId} onChange={(event) => { setCorridorId(event.target.value); setQuotes(preview ? previewQuotes() : []); setSelectedQuoteId(""); }}>{snapshot.corridors.map((item) => <option key={item.id} value={item.id}>{item.source_currency} → {item.target_currency} · {item.provider} ({item.tier})</option>)}</select></label>
        <label>{t("wallet.quote.sendAmount")} {selectedCorridor?.source_currency}<input inputMode="decimal" value={sendAmount} onChange={(event) => { setSendAmount(event.target.value); setQuotes(preview ? previewQuotes() : []); setSelectedQuoteId(""); }} placeholder="200.00"/></label>
        <span className="panel-row" style={{ gridColumn: "1 / -1" }}>{selectedCorridor ? <small className="panel-muted">{t("wallet.quote.range", { min: money(selectedCorridor.min_amount, selectedCorridor.source_currency), max: money(selectedCorridor.max_amount, selectedCorridor.source_currency) })}</small> : <span />}
          <button className="secondary" disabled={preview || busy} onClick={() => void requestQuotes()}>{t("wallet.quote.get")}</button></span>
      </div> : !loading && <p className="panel-muted">{t("wallet.quote.noRoutes")}</p>}
      {quotes.length > 1 && <BarCompare label={t("wp.routeCompare")} rows={quotes.map((quote) => ({ key: quote.id, label: quote.route_name,
        value: Number(quote.net_received), display: money(quote.net_received, quote.target_currency), note: t("wallet.quote.days", { min: quote.settlement_min_days, max: quote.settlement_days }),
        best: Number(quote.net_received) === Math.max(...quotes.map((item) => Number(item.net_received))) }))} />}
      {quotes.length ? <div className="wallet-quote-grid panel-carousel">{quotes.map((quote) => <article key={quote.id} className={selectedQuoteId === quote.id ? "selected" : ""}>
        <h3>{quote.route_name}</h3><p><strong><Amount text={money(quote.net_received, quote.target_currency)} /></strong><span>{t("wallet.quote.receipt")}</span></p>
        <dl><div><dt>{t("wallet.quote.senderFee")}</dt><dd>{money(quote.sender_fee, quote.source_currency)}</dd></div><div><dt>{t("wallet.quote.rate")}</dt><dd title={quote.rate}>{formatRate(quote.rate)}</dd></div>
          <div><dt>{t("wallet.quote.settlement")}</dt><dd>{t("wallet.quote.days", { min: quote.settlement_min_days, max: quote.settlement_days })}</dd></div></dl>
        <small>{quote.is_mock ? t("wallet.quote.fixture") : t("wallet.quote.source", { source: quote.rate_source })} · {t("wallet.quote.expires")} {stamp(quote.expires_at)}</small>
        <button className="secondary" disabled={preview} onClick={() => setSelectedQuoteId(quote.id)}>{selectedQuoteId === quote.id ? t("wallet.quote.selected") : t("wallet.quote.select")}</button>
        {Date.parse(quote.expires_at) <= Date.now() && <p className="error">{t("wallet.quote.expired")}</p>}</article>)}</div>
        : <p className="panel-muted wallet-empty">{preview ? t("wallet.quote.emptyPreview") : t("wallet.quote.empty")}</p>}
      {!selectedQuote && !preview && <small className="panel-muted">{t("wallet.order.chooseQuote")}</small>}
    </section>
    <section className="panel-view" hidden={tab !== "remit" || !showOrder}>{orderReview}</section>
    <WalletExtras client={client} preview={preview} balances={snapshot.balances} want={want} onChanged={() => void refresh()} view={tab === "convert" ? "convert" : tab === "history" && historyView === "ledger" ? "ledger" : "none"} />
    <section id="wallet-history" className="panel-view" hidden={tab !== "history"}>
      <div className="panel-card-head">{bare ? <span /> : <div className="panel-chips" role="group" aria-label={t("wp.tab.history")}>
        <button type="button" aria-pressed={historyView === "orders"} onClick={() => setHistoryView("orders")}>{t("wp.orders")}</button>
        <button type="button" aria-pressed={historyView === "ledger"} onClick={() => setHistoryView("ledger")}>{t("wp.ledger")}</button></div>}
        {historyView === "orders" && <PanelPager index={orders.index} count={orders.pages} onChange={setOrderPage} label={t("wp.orders")} />}</div>
      {historyView === "orders" && <>
        <h2 className="sr-only">{t("wallet.history.title")}</h2>
        {snapshot.errors.orders && <PanelAlert message={snapshot.errors.orders} onRetry={() => void refresh()} />}
        {snapshot.orders.length ? <ul className="panel-rows">{orders.rows.map((item) => <li key={item.id}>
          <span><strong>{purposeName(item.purpose)} · {money(item.send_amount, item.send_currency)}</strong><small>{item.history.length ? stamp(item.history[item.history.length - 1].at) : ""}</small></span>
          <span className="calendar-pill">{item.effective_status}</span>
          <button className="chip" aria-pressed={selectedOrder?.id === item.id} disabled={busy} onClick={() => { void loadOrder(item.id); setTab("remit"); setRemitView("order"); }}>{t("ws.details")}</button></li>)}</ul>
          : <PanelEmpty title={t("wallet.history.none")} action={<button type="button" className="secondary" onClick={() => { setTab("remit"); setRemitView("quote"); }}>{t("wp.newRemit")}</button>} />}
      </>}
    </section>
  </ToolPanel>;

  return <ModulePresentation className="wallet-app" fullPage={(<div className="app connected wallet-app"><aside><a className="brand" href="#" onClick={(event) => { event.preventDefault(); onExit(); }}><span className="brand-icon">S</span>StudyFlow<span className="brand-dot">.</span></a><ModuleNav /><div className="journey-label">{t("wallet.side.label")}</div><nav aria-label={t("wallet.side.nav")}><a href="#wallet-balances">{t("wallet.side.balances")}</a><a href="#wallet-quote">{t("wallet.side.routes")}</a><a href="#wallet-order">{t("wallet.side.review")}</a><a href="#wallet-history">{t("wallet.side.history")}</a></nav><div className="sidebar-note"><strong>{t("wallet.side.noteTitle")}</strong><p>{t("wallet.side.noteText")}</p></div><button className="secondary" onClick={onExit}>{t("common.backToPlan")}</button></aside><div className="workspace"><header><span>{t("wallet.crumb")}</span><span className="avatar">ST</span></header><main>{content}</main><footer>{t("wallet.footer")}<span>{preview ? t("wallet.footer.preview") : t("wallet.footer.live")}</span></footer></div></div>)}>{content}</ModulePresentation>;
}
