import { FocusDialog } from "../workspace/FocusDialog";
import { useToolRefresh, useToolActive, useClearWhenHidden, useWorkspace } from "../workspace/context";
import { ModulePresentation } from "../workspace/ModulePresentation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ModuleNav } from "../services/ModuleNav";
import { formatMoney } from "../backend/presenters";
import { getAll } from "../backend/client";
import { intlLocale, useI18n, type MessageKey } from "../i18n";
import { isTier, TierBadge, TierLegend } from "../services/TierBadge";
import { SessionWalletClient, WalletApiError, type WalletClient } from "../wallet/client";
import { createAgentPreview } from "./previewAdapter";
import type { AgentSession, AgentStep, Approval, Page, PendingAction } from "./types";
import "../services/services.css";

const signInUrl = `/api/auth/login/?next=${encodeURIComponent(window.location.origin + "/?agent=1")}`;
const TOOLS = ["get_balances", "get_fx_rate", "list_corridors", "list_beneficiaries", "get_credit_profile",
  "list_remittance_orders", "rank_quotes", "create_live_quote", "create_remittance_order",
  "submit_remittance_order", "convert_balance"] as const;
const ACTIONS = ["remittance.submit", "wallet.convert"] as const;
const SUGGESTIONS: Record<"en" | "zh", string[]> = {
  en: ["Send 5000 CNY to my THB wallet and compare the routes", "Convert 2000 CNY to THB", "Has my remittance arrived?"],
  zh: ["帮我把5000元人民币汇到泰铢，比较一下渠道", "把2000元人民币换成泰铢", "我的汇款订单到账了吗"],
};

function errorCode(error: unknown) {
  return error instanceof WalletApiError ? error.code : "";
}

export function AgentApp({ preview, onExit }: { preview: boolean; onExit: () => void }) {
  const { lang, t } = useI18n();
  const toolActive = useToolActive();
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
  const passwordRef = useRef<HTMLInputElement | null>(null);
  const resultRef = useRef<HTMLElement | null>(null);

  const workspace = useWorkspace();
  const targetSession = workspace?.target?.kind === "agent" ? workspace.target.sessionId : undefined;
  const targetPending = workspace?.target?.kind === "agent" ? workspace.target.pendingId : undefined;
  useClearWhenHidden(() => { setConfirming(null); setApprovalFor(null); if (passwordRef.current) passwordRef.current.value = ""; });
  useEffect(() => {
    if (!toolActive || !targetSession) return;
    let alive = true;
    setError(""); setSession(null);
    client.get<AgentSession>(`agent/sessions/${targetSession}/`).then(value => {
      if (alive) setSession(value);
    }).catch(reason => { if (alive) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { alive = false; };
  }, [toolActive, targetSession, targetPending, client]);
  useEffect(() => {
    if (toolActive && targetPending && session?.id === targetSession) {
      const item = document.getElementById(`proposal-${targetPending}`);
      item?.scrollIntoView({ block: "nearest" });
    }
  }, [session, targetPending, targetSession, toolActive]);
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
  const content = <>{staleStatus}
          <div className="section-heading"><div>
            <span className="eyebrow">{t("agent.eyebrow")}</span>
            <h1>{t("agent.title")}</h1>
            <p>{t("agent.intro")}</p>
          </div></div>
          <div className="preview-banner" role="status">
            <strong>{preview ? t("agent.preview.title") : t("common.simulatedMoney")}</strong>
            <span>{preview ? t("agent.preview.text") : t("agent.banner.text")}</span>
          </div>
          {error && !confirming && !approvalFor && <p className="error service-alert" role="alert">{error}</p>}
          {notice && <p className="service-notice" role="status">{notice}</p>}

          <section className="card service-card" aria-labelledby="agent-tiers-title">
            <div className="service-card-body">
              <h2 id="agent-tiers-title">{t("agent.tiers.title")}</h2>
              <p className="service-muted">{t("agent.tiers.text")}</p>
              <TierLegend compact />
            </div>
          </section>

          <section className="card service-card" id="agent-ask" aria-labelledby="agent-ask-title">
            <div className="service-card-body">
              <h2 id="agent-ask-title">{t("agent.ask.title")}</h2>
              {signedOut && !preview ? <div className="service-empty">
                <p>{t("agent.signedOut")}</p>
                <a className="primary" href={signInUrl}>{t("common.signIn")}</a>
              </div> : <form onSubmit={(event) => { event.preventDefault(); void ask(goal); }}>
                <label className="service-field">{t("agent.ask.label")}
                  <textarea value={goal} maxLength={2000} rows={3} disabled={preview || running}
                    placeholder={SUGGESTIONS[lang][0]} onChange={(event) => setGoal(event.target.value)} />
                </label>
                <div className="agent-suggestions" aria-label={t("agent.ask.suggestions")}>
                  {SUGGESTIONS[lang].map((text) => <button type="button" key={text} className="chip" disabled={preview || running} onClick={() => setGoal(text)}>{text}</button>)}
                </div>
                <div className="service-actions">
                  <button type="submit" className="primary" disabled={preview || running || !goal.trim()}>{running ? t("agent.ask.running") : t("agent.ask.submit")}</button>
                  <span className="service-muted">{t("agent.ask.hint")}</span>
                </div>
                {running && <p className="service-muted" role="status">{t("agent.ask.runningText")}</p>}
              </form>}
            </div>
          </section>

          <section className="card service-card" id="agent-result" aria-labelledby="agent-result-title" tabIndex={-1} ref={resultRef}>
            <div className="service-card-body">
              <h2 id="agent-result-title">{t("agent.result.title")}</h2>
              {!session ? <p className="service-muted">{t("agent.result.empty")}</p> : <>
                <div className="agent-session-head">
                  <blockquote className="agent-goal">{session.goal}</blockquote>
                  <div className="agent-meta">
                    <span className={`status-chip status-${session.status.toLowerCase()}`}>{t(`agent.session.${session.status}` as MessageKey)}</span>
                    <span className="service-muted">{t("agent.result.mode", { mode: session.mode })}</span>
                    <span className="service-muted">{when(session.created_at)}</span>
                  </div>
                </div>
                {session.final_answer && <div className="agent-answer"><strong>{t("agent.result.answer")}</strong><p>{session.final_answer}</p></div>}
                {session.error_code && <p className="error">{t("agent.result.errorCode", { code: session.error_code })}</p>}

                {session.pending_actions.length > 0 && <div className="agent-proposals">
                  <h3>{session.pending_actions.some((p) => p.status === "PENDING") ? t("agent.proposals.title") : t("agent.proposals.titleDone")}</h3>
                  {session.pending_actions.map((action) => {
                    const approval = approvalOf(action);
                    const open = action.status === "PENDING" && new Date(action.expires_at).getTime() > Date.now();
                    const details = action.arguments ?? {};
                    return <article id={`proposal-${action.id}`} key={action.id} className={`agent-proposal proposal-${action.status.toLowerCase()}`} aria-label={actionName(action.action)}>
                      <div className="agent-proposal-head">
                        <div><TierBadge tier={approval || approvalFor === action.id ? "T3" : "T2"} /> <strong>{actionName(action.action)}</strong></div>
                        <span className={`status-chip status-${action.status.toLowerCase()}`}>{t(`agent.pending.${action.status}` as MessageKey)}</span>
                      </div>
                      <dl className="comparison-facts">
                        <div><dt>{t("agent.proposals.amount")}</dt><dd>{formatMoney(action.amount, action.currency)}</dd></div>
                        {typeof details.receive_amount === "string" && <div><dt>{t("agent.proposals.receive")}</dt><dd>{formatMoney(details.receive_amount, String(details.receive_currency ?? ""))}</dd></div>}
                        {typeof details.recipient === "string" && <div><dt>{t("agent.proposals.recipient")}</dt><dd>{details.recipient === "SELF" ? t("agent.proposals.self") : String((details.beneficiary as { name?: string } | undefined)?.name ?? t("agent.proposals.beneficiary"))}</dd></div>}
                        <div><dt>{t("agent.proposals.target")}</dt><dd><code>{action.target_id.slice(0, 8)}</code></dd></div>
                        <div><dt>{action.status === "PENDING" ? t("agent.proposals.expires") : t("agent.proposals.decided")}</dt><dd>{when(action.status === "PENDING" ? action.expires_at : action.decided_at)}</dd></div>
                      </dl>
                      {action.status === "PENDING" && !open && <p className="service-muted">{t("agent.proposals.expiredHint")}</p>}
                      {open && <p className="service-muted">{t("agent.proposals.notExecuted")}</p>}
                      {approval && <p className="agent-approval"><TierBadge tier="T3" /> {t("agent.approval.status", { status: t(`approval.${approval.status}` as MessageKey) })}</p>}
                      {open && confirming !== action.id && approvalFor !== action.id && (!approval || approval.status === "APPROVED") && <div className="service-actions">
                        <button className="primary" disabled={busy || preview} onClick={() => { setConfirming(action.id); setError(""); }}>{t("agent.proposals.confirm")}</button>
                        <button className="secondary" disabled={busy || preview} onClick={() => void reject(action)}>{t("agent.proposals.reject")}</button>
                      </div>}
                      {open && approval?.status === "PENDING" && <div className="service-actions">
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
                  })}
                </div>}

                <h3>{t("agent.steps.title")}</h3>
                <ol className="agent-steps">
                  {session.steps.map((step) => <li key={step.id} className={`agent-step step-${step.status.toLowerCase()}`}>
                    <div className="agent-step-head">
                      <span className="agent-step-number">{step.number}</span>
                      {isTier(step.tier) && <TierBadge tier={step.tier} />}
                      <strong>{step.status === "FINAL" ? t("agent.step.final") : toolName(step.tool)}</strong>
                      <span className={`status-chip status-${step.status.toLowerCase()}`}>{t(`agent.stepStatus.${step.status}` as MessageKey)}</span>
                    </div>
                    {step.rationale && <p className="agent-step-why">{step.rationale}</p>}
                    {stepSummary(step) && <p className="service-muted">{stepSummary(step)}</p>}
                    {step.status !== "FINAL" && <details><summary>{t("agent.step.details")}</summary>
                      <pre>{JSON.stringify({ arguments: step.arguments, result: step.result }, null, 2)}</pre>
                    </details>}
                  </li>)}
                </ol>
              </>}
            </div>
          </section>

          <section className="card service-card" id="agent-history" aria-labelledby="agent-history-title">
            <div className="service-card-body">
              <h2 id="agent-history-title">{t("agent.history.title")}</h2>
              {history.length === 0 ? <p className="service-muted">{t("agent.history.empty")}</p> : <ul className="service-list">
                {history.slice(0, 10).map((item) => <li key={item.id}>
                  <button className="link-button" aria-current={session?.id === item.id ? "true" : undefined} onClick={() => void reloadSession(item.id).catch((err) => setError(describe(err)))}>{item.goal}</button>
                  <span className="service-muted">{t(`agent.session.${item.status}` as MessageKey)} · {when(item.created_at)}{item.pending_actions.some((p) => p.status === "PENDING") ? ` · ${t("agent.history.pending")}` : ""}</span>
                </li>)}
              </ul>}
            </div>
          </section>
        </>;
  return <ModulePresentation className="agent-app" fullPage={(<div className="app connected service-app agent-app">
      <aside>
        <a className="brand" href="#" onClick={(event) => { event.preventDefault(); onExit(); }}><span className="brand-icon">S</span>StudyFlow<span className="brand-dot">.</span></a>
        <ModuleNav />
        <div className="journey-label">{t("agent.side.label")}</div>
        <nav aria-label={t("agent.side.nav")}>
          <a href="#agent-ask">{t("agent.side.ask")}</a>
          <a href="#agent-result">{t("agent.side.result")}</a>
          <a href="#agent-history">{t("agent.side.history")}</a>
        </nav>
        <div className="sidebar-note"><strong>{t("agent.side.noteTitle")}</strong><p>{t("agent.side.noteText")}</p></div>
        <button className="secondary" onClick={onExit}>{t("common.backToPlan")}</button>
      </aside>
      <div className="workspace">
        <header><span>StudyFlow / {t("agent.title")}</span><span className="avatar">ST</span></header>
        <main>{content}</main>
        <footer>{t("common.footer")}<span>{t("common.simulatedFooter")}</span></footer>
      </div>
    </div>)}>{content}</ModulePresentation>;
}
