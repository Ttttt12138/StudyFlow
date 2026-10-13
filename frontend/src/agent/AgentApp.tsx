import { FocusDialog } from "../workspace/FocusDialog";
import { useToolRefresh, useToolActive, useClearWhenHidden, useWorkspace, useEmbedded } from "../workspace/context";
import { ModulePresentation } from "../workspace/ModulePresentation";
import { PanelAlert, PanelEmpty, PanelInfo, PanelFacts, PanelHero, PanelPager, PanelSheet, ToolPanel, usePage } from "../workspace/ToolPanel";
import { LevelBar, StackBar, StepTrack } from "../workspace/PanelCharts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatsCircle } from "@phosphor-icons/react/dist/csr/ChatsCircle";
import { SealCheck } from "@phosphor-icons/react/dist/csr/SealCheck";
import { CaretRight } from "@phosphor-icons/react/dist/csr/CaretRight";
import { ModuleNav } from "../services/ModuleNav";
import { formatMoney } from "../backend/presenters";
import { getAll } from "../backend/client";
import { intlLocale, useI18n, type MessageKey } from "../i18n";
import { isTier, TierBadge, TierLegend, type Tier } from "../services/TierBadge";
import { SessionWalletClient, WalletApiError, type WalletClient } from "../wallet/client";
import { createAgentPreview } from "./previewAdapter";
import type { AgentSession, AgentStep, Approval, Page, PendingAction } from "./types";
import "../services/services.css";
import "./agent.css";

const signInUrl = `/auth?next=${encodeURIComponent(window.location.origin + "/?agent=1")}`;
const TOOLS = ["get_balances", "get_fx_rate", "list_corridors", "list_beneficiaries", "get_credit_profile",
  "list_remittance_orders", "rank_quotes", "create_live_quote", "create_remittance_order",
  "submit_remittance_order", "convert_balance"] as const;
const ACTIONS = ["remittance.submit", "wallet.convert"] as const;
const SUGGESTIONS: Record<"en" | "zh", string[]> = {
  en: ["Send 5000 CNY to my THB wallet and compare the routes", "Convert 2000 CNY to THB", "Has my remittance arrived?"],
  zh: ["帮我把5000元人民币汇到泰铢，比较一下渠道", "把2000元人民币换成泰铢", "我的汇款订单到账了吗"],
};
const TIER_TONE: Record<Tier, "mint" | "muted" | "gold" | "red"> = { T0: "mint", T1: "muted", T2: "gold", T3: "red" };
const STEP_PAGE = 8;
const HISTORY_PAGE = 6;
type Tab = "ask" | "confirm" | "steps";
type Sheet = { kind: "history" } | { kind: "tiers" } | { kind: "answer" } | { kind: "step"; id: string } | null;

function errorCode(error: unknown) {
  return error instanceof WalletApiError ? error.code : "";
}

export function AgentApp({ preview, onExit }: { preview: boolean; onExit: () => void }) {
  const { lang, t } = useI18n();
  const toolActive = useToolActive();
  const embedded = useEmbedded();
  const client = useMemo<WalletClient>(() => preview ? createAgentPreview(lang) : new SessionWalletClient(), [preview, lang]);
  const [goal, setGoal] = useState("");
  const [session, setSession] = useState<AgentSession | null>(null);
  const [history, setHistory] = useState<AgentSession[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [signedOut, setSignedOut] = useState(false);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [approvalFor, setApprovalFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [tab, setTab] = useState<Tab>("ask");
  const [sheet, setSheet] = useState<Sheet>(null);
  const [proposalPage, setProposalPage] = useState(0);
  const [stepPage, setStepPage] = useState(0);
  const [historyPage, setHistoryPage] = useState(0);
  const passwordRef = useRef<HTMLInputElement | null>(null);
  const resultRef = useRef<HTMLElement | null>(null);
  const deepLinked = useRef("");

  const workspace = useWorkspace();
  const targetSession = workspace?.target?.kind === "agent" ? workspace.target.sessionId : undefined;
  const targetPending = workspace?.target?.kind === "agent" ? workspace.target.pendingId : undefined;
  useClearWhenHidden(() => { setConfirming(null); setApprovalFor(null); if (passwordRef.current) passwordRef.current.value = ""; });
  useEffect(() => {
    if (!toolActive || !targetSession) return;
    let alive = true;
    setError(""); setSession(null);
    deepLinked.current = "";
    client.get<AgentSession>(`agent/sessions/${targetSession}/`).then(value => {
      if (alive) setSession(value);
    }).catch(reason => { if (alive) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { alive = false; };
  }, [toolActive, targetSession, targetPending, client]);
  // A proposal opened from the planning chat lands on its own confirmation card, once per link.
  useEffect(() => {
    if (!toolActive || !targetPending || !session || session.id !== targetSession) return;
    const key = `${targetSession}:${targetPending}`;
    if (deepLinked.current === key) return;
    const index = session.pending_actions.findIndex(item => item.id === targetPending);
    if (index < 0) return;
    deepLinked.current = key;
    setTab("confirm"); setSheet(null); setProposalPage(index);
    requestAnimationFrame(() => document.getElementById(`proposal-${targetPending}`)?.scrollIntoView({ block: "nearest" }));
  }, [session, targetPending, targetSession, toolActive]);
  // Another conversation starts on its first open proposal and its first page of steps.
  useEffect(() => {
    if (!session) return;
    const open = session.pending_actions.findIndex(item => item.status === "PENDING");
    setProposalPage(Math.max(0, open)); setStepPage(0);
  }, [session?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const describe = useCallback((err: unknown) => {
    if (err instanceof WalletApiError) {
      const code = err.code;
      const known = ({
        STEP_UP_FAILED: "agent.err.stepUpFailed", STEP_UP_INVALID: "agent.err.stepUpInvalid",
        PENDING_ACTION_CLOSED: "agent.err.closed", APPROVAL_ALREADY_OPEN: "agent.err.approvalOpen",
      } as Record<string, MessageKey>)[code];
      if (known) return t(known);
      if (err.status === 429) return t("agent.err.throttled");
      return err.status ? `HTTP ${err.status}: ${err.message}` : err.message;
    }
    return err instanceof Error ? err.message : t("agent.err.generic");
  }, [t]);

  const loadSideData = useCallback(async (strict = false) => {
    const [sessions, approvalRows] = await Promise.allSettled([
      client.get<Page<AgentSession>>("agent/sessions/"),
      getAll<Approval>(client, "approvals/"),
    ]);
    if (sessions.status === "fulfilled") setHistory(sessions.value.results);
    else if (sessions.reason instanceof WalletApiError && [401, 403].includes(sessions.reason.status)) setSignedOut(true);
    if (approvalRows.status === "fulfilled") setApprovals(approvalRows.value);
    if (strict && (sessions.status === "rejected" || approvalRows.status === "rejected")) throw new Error("Session refresh failed");
    return sessions.status === "fulfilled" ? sessions.value.results : [];
  }, [client]);

  useEffect(() => {
    let active = true;
    setSignedOut(false); setError("");
    loadSideData().then((rows) => { if (active && preview && rows[0]) setSession(rows[0]); }).catch(() => undefined);
    return () => { active = false; };
  }, [loadSideData, preview]);

  async function reloadSession(id: string) {
    const fresh = await client.get<AgentSession>(`agent/sessions/${id}/`);
    setSession(fresh);
    await loadSideData();
    return fresh;
  }

  async function ask(text: string) {
    const trimmed = text.trim();
    if (!trimmed || preview) return;
    setRunning(true); setError(""); setNotice(""); setConfirming(null); setApprovalFor(null);
    try {
      const created = await client.post<AgentSession>("agent/sessions/", { goal: trimmed, locale: lang }, `agent-session:${lang}:${trimmed}`);
      setSession(created);
      setGoal("");
      await loadSideData();
      requestAnimationFrame(() => { if (resultRef.current?.getClientRects().length) resultRef.current.focus(); });
    } catch (err) {
      if (err instanceof WalletApiError && [401, 403].includes(err.status) && !err.code) setSignedOut(true);
      setError(describe(err));
    } finally { setRunning(false); }
  }

  async function confirm(action: PendingAction) {
    const password = passwordRef.current?.value ?? "";
    if (!password) { passwordRef.current?.focus(); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const grant = await client.post<{ token: string }>("auth/step-up/", {
        password, action: action.action, target_id: action.target_id, amount: action.amount, currency: action.currency,
      }, "auth/step-up/");
      if (passwordRef.current) passwordRef.current.value = "";
      try {
        const decided = await client.post<PendingAction>(`agent/pending-actions/${action.id}/confirm/`, {},
          `agent-confirm:${action.id}`, { "X-Step-Up-Token": grant.token });
        setSession(current => current && ({ ...current, pending_actions: current.pending_actions.map(item => item.id === decided.id ? decided : item) }));
        setConfirming(null);
        // Confirming a proposal whose quote has expired executes nothing; the order result says so.
        const outcome = String(decided.result?.effective_status ?? decided.result?.status ?? "");
        setNotice(decided.status === "CONFIRMED" && outcome === "EXPIRED" ? t("agent.notice.expiredOrder")
          : decided.status === "CONFIRMED" ? t("agent.notice.confirmed")
          : t("agent.notice.decided", { status: t(`agent.pending.${decided.status}` as MessageKey) }));
      } catch (err) {
        if (errorCode(err) === "APPROVAL_REQUIRED") {
          setConfirming(null); setApprovalFor(action.id);
          setError(t("agent.err.approvalRequired"));
        } else throw err;
      }
      await reloadSession(action.session);
    } catch (err) {
      setError(describe(err));
    } finally {
      if (passwordRef.current) passwordRef.current.value = "";
      setBusy(false);
    }
  }

  async function reject(action: PendingAction) {
    setBusy(true); setError(""); setNotice("");
    try {
      await client.post(`agent/pending-actions/${action.id}/reject/`, {}, `agent-reject:${action.id}`);
      setConfirming(null); setApprovalFor(null);
      setNotice(t("agent.notice.rejected"));
      await reloadSession(action.session);
    } catch (err) { setError(describe(err)); } finally { setBusy(false); }
  }

  async function requestApproval(action: PendingAction) {
    setBusy(true); setError(""); setNotice("");
    try {
      await client.post("approvals/", { action: action.action, target_id: action.target_id, amount: action.amount,
        currency: action.currency, reason: reason.trim() }, `approval:${action.action}:${action.target_id}`);
      setApprovalFor(null); setReason("");
      setNotice(t("agent.notice.approvalRequested"));
      await loadSideData();
    } catch (err) { setError(describe(err)); } finally { setBusy(false); }
  }

  useEffect(() => { if (confirming) passwordRef.current?.focus(); }, [confirming]);

  const when = (value: string | null | undefined) => value
    ? new Date(value).toLocaleString(intlLocale(lang), { dateStyle: "medium", timeStyle: "short" }) : "—";
  const toolName = (tool: string) => (TOOLS as readonly string[]).includes(tool) ? t(`agent.tool.${tool}` as MessageKey) : tool || t("agent.step.planner");
  const actionName = (action: string) => (ACTIONS as readonly string[]).includes(action) ? t(`agent.action.${action}` as MessageKey) : action;
  const approvalOf = (action: PendingAction) => approvals.find((item) => item.action === action.action && item.target_id === action.target_id
    && ["PENDING", "APPROVED", "USED"].includes(item.status)) ?? null;
  const isOpen = (action: PendingAction) => action.status === "PENDING" && new Date(action.expires_at).getTime() > Date.now();

  function stepSummary(step: AgentStep) {
    const result = step.result ?? {};
    if (step.status === "FINAL") return null;
    if (step.status === "PROPOSED") return t("agent.step.proposedText");
    if (step.status === "ERROR" || step.status === "DENIED") {
      const code = typeof result.error === "string" ? result.error : JSON.stringify(result.error ?? result);
      return t("agent.step.errorText", { code });
    }
    return null;
  }

  const staleStatus = useToolRefresh(async () => {
    if (session) setSession(await client.get<AgentSession>(`agent/sessions/${session.id}/`));
    await loadSideData(true);
  });

  const steps = session?.steps ?? [];
  const calls = steps.filter(step => step.status !== "FINAL");
  const proposals = session?.pending_actions ?? [];
  const openProposals = proposals.filter(isOpen);
  const waiting = proposals.filter(item => item.status === "PENDING");
  const proposalView = usePage(proposals, 1, proposalPage);
  const stepView = usePage(steps, STEP_PAGE, stepPage);
  const historyView = usePage(history, HISTORY_PAGE, historyPage);
  const tierCounts = (["T0", "T1", "T2", "T3"] as Tier[]).map(tier => ({ tier, count: calls.filter(step => step.tier === tier).length }));
  const outcome = (statuses: AgentStep["status"][]) => calls.filter(step => statuses.includes(step.status)).length;
  const historyLink = history.length > 0 && <button type="button" className="panel-link panel-footer-note" onClick={() => setSheet({ kind: "history" })}>
    {t("agent.history.title")} · {history.length}</button>;

  const tierBar = calls.length > 0 && <div className="agent-tiers">
    <p className="panel-section-title">{t("agent.tiers.mix")}
      <button type="button" className="panel-link" onClick={() => setSheet({ kind: "tiers" })}>{t("agent.tiers.title")}</button></p>
    <StackBar label={t("agent.tiers.mix")} parts={tierCounts.filter(({ count }) => count > 0).map(({ tier, count }) => ({ key: tier, value: count, tone: TIER_TONE[tier],
      label: `${tier} ${t(`tier.${tier}.name` as MessageKey)} × ${count}` }))} />
  </div>;

  const historyList = (rows: AgentSession[]) => <ul className="panel-rows agent-history">{rows.map((item) => <li key={item.id}>
    <span><button type="button" className="link-button" aria-current={session?.id === item.id ? "true" : undefined}
      onClick={() => { setSheet(null); void reloadSession(item.id).catch((err) => setError(describe(err))); }}>{item.goal}</button>
      <small>{t(`agent.session.${item.status}` as MessageKey)} · {when(item.created_at)}</small></span>
    {item.pending_actions.some((p) => p.status === "PENDING") && <span className="panel-tag is-warn">{t("agent.history.pending")}</span>}
  </li>)}</ul>;

  const notices = <>
    {staleStatus}
    <div className="panel-row agent-banner" role="status">
      <span className="panel-tag">{preview ? t("agent.preview.title") : t("common.simulatedMoney")}</span>
      <PanelInfo>{preview ? t("agent.preview.text") : t("agent.banner.text")}</PanelInfo>
    </div>
    {error && !confirming && !approvalFor && <PanelAlert message={error} />}
    {notice && <p className="service-notice" role="status">{notice}</p>}
  </>;

  const askView = <div className="panel-view agent-ask-view" id="agent-ask" hidden={tab !== "ask"}>
    <section className="agent-result" id="agent-result" aria-labelledby="agent-result-title" tabIndex={-1} ref={resultRef}>
      <h2 id="agent-result-title" className="sr-only">{t("agent.result.title")}</h2>
      {!session ? <PanelEmpty icon={ChatsCircle} title={t("agent.ask.title")} text={t("agent.result.empty")} /> : <>
        {openProposals.length > 0
          ? <PanelHero label={t("agent.hero.waiting")} value={formatMoney(openProposals[0].amount, openProposals[0].currency)} tone="warn">
            <span className="panel-row agent-hero-line"><span className="panel-muted">{actionName(openProposals[0].action)}
              {openProposals.length > 1 ? ` · ${t("agent.hero.more", { count: openProposals.length - 1 })}` : ""}</span>
              <button type="button" className="panel-link" onClick={() => { setTab("confirm"); setProposalPage(proposals.indexOf(openProposals[0])); }}>
                {t("agent.hero.review")} <CaretRight size={12} aria-hidden="true" /></button></span>
          </PanelHero>
          : <PanelHero label={t("agent.hero.calls")} value={String(calls.length)} unit={t("agent.unit.calls")}>
            <span className="panel-muted">{t(`agent.session.${session.status}` as MessageKey)} · {when(session.created_at)}</span>
          </PanelHero>}
        {tierBar}
        <div className="agent-chat">
          <div className="agent-bubble is-you">
            <blockquote className="agent-goal">{session.goal}</blockquote>
            <span className="agent-meta"><span className={`status-chip status-${session.status.toLowerCase()}`}>{t(`agent.session.${session.status}` as MessageKey)}</span>
              <small className="panel-muted">{t("agent.result.mode", { mode: session.mode })} · {when(session.created_at)}</small></span>
          </div>
          {session.final_answer && <div className="agent-bubble agent-answer">
            <strong>{t("agent.result.answer")}</strong><p>{session.final_answer}</p>
            {session.final_answer.length > 280 && <button type="button" className="panel-link" onClick={() => setSheet({ kind: "answer" })}>{t("agent.answer.more")}</button>}
          </div>}
          {session.error_code && <p className="error">{t("agent.result.errorCode", { code: session.error_code })}</p>}
        </div>
      </>}
    </section>
    {signedOut && !preview ? <div className="service-empty agent-signin">
      <p>{t("agent.signedOut")}</p>
      <a className="primary" href={signInUrl}>{t("common.signIn")}</a>
    </div> : <form id="agent-ask-form" className="agent-composer" onSubmit={(event) => { event.preventDefault(); void ask(goal); }}>
      <label className="agent-field"><span className="panel-row">{t("agent.ask.label")}<small>{t("agent.ask.hint")}</small></span>
        <textarea value={goal} maxLength={2000} rows={2} disabled={preview || running}
          placeholder={SUGGESTIONS[lang][0]} onChange={(event) => setGoal(event.target.value)} />
      </label>
      {!session && <div className="agent-suggestions panel-chips" aria-label={t("agent.ask.suggestions")}>
        {SUGGESTIONS[lang].map((text) => <button type="button" key={text} className="chip" disabled={preview || running} onClick={() => setGoal(text)}>{text}</button>)}
      </div>}
      {running && <p className="panel-muted" role="status">{t("agent.ask.runningText")}</p>}
    </form>}
  </div>;

  const shownProposal = proposalView.rows[0];
  const proposalCard = (action: PendingAction) => {
    const approval = approvalOf(action);
    const open = isOpen(action);
    const details = action.arguments ?? {};
    const t3 = !!approval || approvalFor === action.id;
    const track = t3 ? [t("agent.track.proposed"), t("agent.track.approval"), t("agent.track.password"), t("agent.track.done")]
      : [t("agent.track.proposed"), t("agent.track.password"), t("agent.track.done")];
    const passwordStep = track.length - 2;
    const current = action.status === "CONFIRMED" ? track.length
      : t3 && approval?.status !== "APPROVED" && approval?.status !== "USED" ? 1 : passwordStep;
    const failed = action.status !== "PENDING" && action.status !== "CONFIRMED" || (action.status === "PENDING" && !open);
    const created = new Date(action.created_at).getTime(), expires = new Date(action.expires_at).getTime();
    const left = Math.max(0, expires - Date.now());
    return <article id={`proposal-${action.id}`} key={action.id} className={`agent-proposal proposal-${action.status.toLowerCase()}`} aria-label={actionName(action.action)}>
      <div className="agent-proposal-head">
        <div><TierBadge tier={t3 ? "T3" : "T2"} /> <strong>{actionName(action.action)}</strong></div>
        <span className={`status-chip status-${action.status.toLowerCase()}`}>{t(`agent.pending.${action.status}` as MessageKey)}</span>
      </div>
      <PanelHero label={t("agent.proposals.amount")} value={formatMoney(action.amount, action.currency)} tone={open ? "warn" : undefined} />
      <StepTrack label={t("agent.track.label")} steps={track} current={Math.min(current, track.length)} failed={failed} />
      {open && <div className="agent-expiry">
        {Number.isFinite(created) && expires > created && expires - created <= 86400000 && <LevelBar value={0} max={expires - created} after={left} tone={left < 3 * 60 * 1000 ? "warn" : undefined} />}
        <small className="panel-muted">{t("agent.expiry.left", { minutes: Math.ceil(left / 60000) })}</small>
      </div>}
      <PanelFacts items={[
        ...(typeof details.receive_amount === "string" ? [[t("agent.proposals.receive"), formatMoney(details.receive_amount, String(details.receive_currency ?? ""))] as [string, string]] : []),
        ...(typeof details.recipient === "string" ? [[t("agent.proposals.recipient"), details.recipient === "SELF" ? t("agent.proposals.self") : String((details.beneficiary as { name?: string } | undefined)?.name ?? t("agent.proposals.beneficiary"))] as [string, string]] : []),
        [t("agent.proposals.target"), <code key="target">{action.target_id.slice(0, 8)}</code>],
        [action.status === "PENDING" ? t("agent.proposals.expires") : t("agent.proposals.decided"), when(action.status === "PENDING" ? action.expires_at : action.decided_at)],
      ]} />
      {action.status === "PENDING" && !open && <p className="panel-note">{t("agent.proposals.expiredHint")}</p>}
      {open && <p className="panel-muted">{t("agent.proposals.notExecuted")}</p>}
      {approval && <p className="agent-approval"><TierBadge tier="T3" /> {t("agent.approval.status", { status: t(`approval.${approval.status}` as MessageKey) })}</p>}
      {open && confirming !== action.id && approvalFor !== action.id && (!approval || approval.status === "APPROVED") && <div className="agent-proposal-actions">
        <button className="secondary" disabled={busy || preview} onClick={() => void reject(action)}>{t("agent.proposals.reject")}</button>
        <button className="primary" disabled={busy || preview} onClick={() => { setConfirming(action.id); setError(""); }}>{t("agent.proposals.confirm")}</button>
      </div>}
      {open && approval?.status === "PENDING" && <div className="agent-proposal-actions">
        <button className="secondary" disabled={busy || preview} onClick={() => void reject(action)}>{t("agent.proposals.reject")}</button>
        <button className="secondary" disabled={busy} onClick={() => void loadSideData()}>{t("agent.approval.refresh")}</button>
      </div>}
      {open && confirming === action.id && <FocusDialog title={t("ws.confirm")} busy={busy} onClose={() => setConfirming(null)}><p>{formatMoney(action.amount, action.currency)} · {action.target_id.slice(0, 8)}</p><form className="service-policy" onSubmit={(event) => { event.preventDefault(); void confirm(action); }}>
        <h4><TierBadge tier="T2" /> {t("agent.stepUp.title")}</h4>
        <p>{t("agent.stepUp.text", { amount: formatMoney(action.amount, action.currency) })}</p>
        {error && <p className="error" role="alert">{error}</p>}
        <label className="service-field">{t("agent.stepUp.password")}<input ref={passwordRef} type="password" autoComplete="current-password" /></label>
        <div className="service-actions">
          <button type="submit" className="primary" disabled={busy || preview}>{t("agent.stepUp.submit")}</button>
          <button type="button" className="secondary" disabled={busy} onClick={() => setConfirming(null)}>{t("common.cancel")}</button>
        </div>
      </form></FocusDialog>}
      {open && approvalFor === action.id && <FocusDialog title={t("ws.confirm")} busy={busy} onClose={() => setApprovalFor(null)}><p>{formatMoney(action.amount, action.currency)} · {action.target_id.slice(0, 8)}</p><form className="service-policy" onSubmit={(event) => { event.preventDefault(); void requestApproval(action); }}>
        <h4><TierBadge tier="T3" /> {t("agent.approval.title")}</h4>
        <p>{t("agent.approval.text")}</p>
        {error && <p className="error">{error}</p>}
        <label className="service-field">{t("agent.approval.reason")}<input value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} /></label>
        <div className="service-actions">
          <button type="submit" className="primary" disabled={busy || preview || !reason.trim()}>{t("agent.approval.submit")}</button>
          <button type="button" className="secondary" disabled={busy} onClick={() => setApprovalFor(null)}>{t("common.cancel")}</button>
        </div>
      </form></FocusDialog>}
    </article>;
  };

  const confirmView = <div className="panel-view" id="agent-proposals" hidden={tab !== "confirm"}>
    {proposals.length === 0 ? <PanelEmpty icon={SealCheck} title={t("agent.confirm.empty")} text={t("agent.confirm.emptyText")} /> : <>
      <div className="panel-card-head"><h3>{waiting.length ? t("agent.proposals.title") : t("agent.proposals.titleDone")}</h3>
        <PanelPager index={proposalView.index} count={proposalView.pages} onChange={setProposalPage} label={t("agent.proposals.titleDone")} /></div>
      {shownProposal && proposalCard(shownProposal)}
    </>}
  </div>;

  const openStep = sheet?.kind === "step" ? steps.find(step => step.id === sheet.id) : undefined;
  const stepsView = <div className="panel-view" id="agent-steps" hidden={tab !== "steps"}>
    {!session || steps.length === 0 ? <PanelEmpty title={t("agent.steps.empty")} /> : <>
      <div className="panel-card-head">
        <PanelHero label={t("agent.steps.title")} value={String(calls.length)} unit={t("agent.unit.calls")} />
        <PanelPager index={stepView.index} count={stepView.pages} onChange={setStepPage} label={t("agent.steps.title")} />
      </div>
      <StackBar label={t("agent.steps.outcomes")} parts={[
        { key: "ok", value: outcome(["OK"]), tone: "mint", label: `${t("agent.stepStatus.OK")} ${outcome(["OK"])}` },
        { key: "proposed", value: outcome(["PROPOSED"]), tone: "gold", label: `${t("agent.stepStatus.PROPOSED")} ${outcome(["PROPOSED"])}` },
        { key: "error", value: outcome(["ERROR", "DENIED"]), tone: "red", label: `${t("agent.steps.refused")} ${outcome(["ERROR", "DENIED"])}` },
      ].filter(part => part.key === "ok" || part.value > 0) as { key: string; value: number; tone: "mint" | "gold" | "red"; label: string }[]} />
      <ol className="agent-steps">
        {stepView.rows.map((step) => <li key={step.id} className={`agent-step step-${step.status.toLowerCase()}`}>
          <button type="button" className="agent-step-row" onClick={() => setSheet({ kind: "step", id: step.id })}>
            <span className="agent-step-number">{step.number}</span>
            <span className="agent-step-name">
              <span className="agent-step-title">{isTier(step.tier) && <TierBadge tier={step.tier} />}<strong>{step.status === "FINAL" ? t("agent.step.final") : toolName(step.tool)}</strong></span>
              {step.rationale && <small>{step.rationale}</small>}
            </span>
            <span className={`status-chip status-${step.status.toLowerCase()}`}>{t(`agent.stepStatus.${step.status}` as MessageKey)}</span>
            <CaretRight size={12} aria-hidden="true" className="agent-step-caret" />
          </button>
        </li>)}
      </ol>
    </>}
  </div>;

  const sheetNode = sheet?.kind === "history" ? <PanelSheet title={t("agent.history.title")} onClose={() => setSheet(null)}>
    <div id="agent-history" className="panel-sheet-stack">
      <div className="panel-card-head"><span className="panel-muted">{t("agent.history.count", { count: history.length })}</span>
        <PanelPager index={historyView.index} count={historyView.pages} onChange={setHistoryPage} label={t("agent.history.title")} /></div>
      {history.length === 0 ? <p className="panel-muted">{t("agent.history.empty")}</p> : historyList(historyView.rows)}
    </div>
  </PanelSheet>
    : sheet?.kind === "tiers" ? <PanelSheet title={t("agent.tiers.title")} onClose={() => setSheet(null)}>
      <p className="panel-muted">{t("agent.tiers.text")}</p>
      <TierLegend compact />
    </PanelSheet>
    : sheet?.kind === "answer" && session ? <PanelSheet title={t("agent.result.answer")} onClose={() => setSheet(null)}>
      <p className="agent-answer-full">{session.final_answer}</p>
    </PanelSheet>
    : openStep ? <PanelSheet title={`${openStep.number} · ${openStep.status === "FINAL" ? t("agent.step.final") : toolName(openStep.tool)}`} onClose={() => setSheet(null)}>
      <div className="panel-row">{isTier(openStep.tier) ? <TierBadge tier={openStep.tier} withLabel /> : <span />}
        <span className={`status-chip status-${openStep.status.toLowerCase()}`}>{t(`agent.stepStatus.${openStep.status}` as MessageKey)}</span></div>
      {openStep.rationale && <p className="agent-step-why">{openStep.rationale}</p>}
      {stepSummary(openStep) && <p className="panel-note">{stepSummary(openStep)}</p>}
      {openStep.status !== "FINAL" ? <>
        <p className="panel-section-title">{t("agent.step.details")}</p>
        <pre className="agent-json">{JSON.stringify({ arguments: openStep.arguments, result: openStep.result }, null, 2)}</pre>
      </> : session?.final_answer && <p className="agent-answer-full">{session.final_answer}</p>}
    </PanelSheet>
    : null;

  const footer = tab === "ask" ? <>{historyLink}
    {!(signedOut && !preview) && <button type="submit" form="agent-ask-form" className="primary" disabled={preview || running || !goal.trim()}>{running ? t("agent.ask.running") : t("agent.ask.submit")}</button>}</>
    : historyLink || null;

  const aside = <>
    <p className="panel-section-title">{t("agent.tiers.title")}</p>
    <TierLegend compact />
    <p className="panel-section-title">{t("agent.history.title")}</p>
    {history.length === 0 ? <p className="panel-muted">{t("agent.history.empty")}</p> : historyList(history.slice(0, 8))}
  </>;

  const content = <ToolPanel<Tab> label={t("agent.side.nav")} numbered={false} active={tab} onSelect={(key) => { setTab(key); setSheet(null); }}
    steps={[{ key: "ask", label: t("agent.tab.ask") },
      { key: "confirm", label: waiting.length ? `${t("agent.tab.confirm")} · ${waiting.length}` : t("agent.tab.confirm") },
      { key: "steps", label: t("agent.tab.steps") }]}
    notices={notices} footer={footer} sheet={sheetNode} aside={aside}>
    {!embedded && <h1 className="sr-only">{t("agent.title")}</h1>}
    {askView}
    {confirmView}
    {stepsView}
  </ToolPanel>;

  return <ModulePresentation className="agent-app" fullPage={(<div className="app connected service-app agent-app">
      <aside>
        <a className="brand" href="#" onClick={(event) => { event.preventDefault(); onExit(); }}><span className="brand-icon">S</span>StudyFlow<span className="brand-dot">.</span></a>
        <ModuleNav />
        <div className="journey-label">{t("agent.side.label")}</div>
        <nav aria-label={t("agent.side.nav")}>
          <a href="#agent-ask" onClick={() => setTab("ask")}>{t("agent.side.ask")}</a>
          <a href="#agent-proposals" onClick={() => setTab("confirm")}>{t("agent.tab.confirm")}</a>
          <a href="#agent-steps" onClick={() => setTab("steps")}>{t("agent.tab.steps")}</a>
        </nav>
        <div className="sidebar-note"><strong>{t("agent.side.noteTitle")}</strong><p>{t("agent.side.noteText")}</p></div>
        <button className="secondary" onClick={onExit}>{t("common.backToPlan")}</button>
      </aside>
      <div className="workspace">
        <header><span>StudyFlow / {t("agent.title")}</span><span className="avatar">ST</span></header>
        <main className="agent-full">{content}</main>
        <footer>{t("common.footer")}<span>{t("common.simulatedFooter")}</span></footer>
      </div>
    </div>)}>{content}</ModulePresentation>;
}
