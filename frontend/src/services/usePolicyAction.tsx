import { FocusDialog } from "../workspace/FocusDialog";
import { useClearWhenHidden, useToolActive } from "../workspace/context";
import { useEffect, useRef, useState } from "react";
import { formatMoney } from "../backend/presenters";
import { useI18n } from "../i18n";
import { WalletApiError, type WalletClient } from "../wallet/client";
import { TierBadge } from "./TierBadge";

/** Scale of the countdown bar; the wait itself comes from the approval's simulated_after_seconds. */
const REVIEW_SECONDS = 10;

/** What a T2/T3 policy check is bound to (finance/policy.py Subject). */
export type PolicySubject = { action: string; target_id: string; amount: string; currency: string };

/**
 * Runs a money-moving command that Django may answer with STEP_UP_REQUIRED or APPROVAL_REQUIRED
 * (docs/permissions.md). The first attempt goes without a token; a denial opens the matching panel.
 * The step-up token lives only inside the call that uses it.
 */
export function usePolicyAction(client: WalletClient, preview: boolean) {
  const { lang, t } = useI18n();
  const active = useToolActive();
  useClearWhenHidden(() => { setNeed(null); if (passwordRef.current) passwordRef.current.value = ""; });
  const [need, setNeed] = useState<null | { kind: "STEP_UP" | "APPROVAL" | "REVIEW"; subject: PolicySubject; send: (token?: string) => Promise<void>;
    /** REVIEW: the approval waiting for the simulated operator, and when the demo approves it. */
    approvalId?: string; readyAt?: number }>(null);
  const [now, setNow] = useState(() => Date.now());
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const passwordRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (active && need?.kind === "STEP_UP") passwordRef.current?.focus(); }, [need]);
  // Demo review: count down, then the simulated operator approves and the password step follows.
  useEffect(() => {
    if (need?.kind !== "REVIEW") return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [need?.kind]);
  const left = need?.kind === "REVIEW" && need.readyAt ? Math.max(0, Math.ceil((need.readyAt - now) / 1000)) : 0;
  useEffect(() => {
    if (need?.kind !== "REVIEW" || left > 0 || busy) return;
    void finishReview();
  }, [need?.kind, left]); // eslint-disable-line react-hooks/exhaustive-deps

  function denial(reasonValue: unknown, subject: PolicySubject, send: (token?: string) => Promise<void>) {
    if (!(reasonValue instanceof WalletApiError)) return false;
    if (reasonValue.code === "APPROVAL_REQUIRED") { setNeed({ kind: "APPROVAL", subject, send }); return true; }
    if (["STEP_UP_REQUIRED", "STEP_UP_INVALID"].includes(reasonValue.code)) { setNeed({ kind: "STEP_UP", subject, send }); return true; }
    return false;
  }

  /** Try the command; returns true when it ran, false when a policy panel opened instead. */
  async function run(subject: PolicySubject, send: (token?: string) => Promise<void>) {
    if (preview) return false;
    setError(""); setNotice("");
    try { await send(); setNeed(null); return true; }
    catch (reasonValue) { if (denial(reasonValue, subject, send)) return false; throw reasonValue; }
  }

  async function confirmPassword() {
    if (!need) return;
    const password = passwordRef.current?.value ?? "";
    if (!password) { setError(t("shell.err.password")); return; }
    passwordRef.current!.value = "";
    setBusy(true); setError("");
    try {
      const grant = await client.post<{ token: string }>("auth/step-up/", { password, ...need.subject }, `step-up:${need.subject.action}:${need.subject.target_id}`);
      await need.send(grant.token);
      setNeed(null);
    } catch (reasonValue) {
      if (!(reasonValue instanceof WalletApiError && reasonValue.code === "APPROVAL_REQUIRED" && denial(reasonValue, need.subject, need.send)))
        setError(reasonValue instanceof Error ? reasonValue.message : t("shell.err.generic"));
    } finally { setBusy(false); }
  }

  async function requestApproval() {
    if (!need) return;
    setBusy(true); setError("");
    try {
      const created = await client.post<{ id: string; simulated_after_seconds?: number }>("approvals/", { ...need.subject, reason: reason.trim() },
        `approval:${need.subject.action}:${need.subject.target_id}`);
      setReason(""); setNow(Date.now());
      // Without the demo's simulated operator, real staff decide: say so and close, as before.
      if (!created.simulated_after_seconds) { setNotice(t("shell.policy.requested")); setNeed(null); return; }
      setNeed({ ...need, kind: "REVIEW", approvalId: created.id, readyAt: Date.now() + created.simulated_after_seconds * 1000 });
    } catch (reasonValue) {
      // Asked before and closed: pick the waiting request up again instead of failing.
      if (reasonValue instanceof WalletApiError && reasonValue.code === "APPROVAL_ALREADY_OPEN") {
        const page = await client.get<{ results: { id: string; target_id: string; action: string; created_at: string; simulated_after_seconds?: number }[] }>("approvals/?status=PENDING").catch(() => null);
        const open = page?.results.find(row => row.action === need.subject.action && row.target_id === need.subject.target_id);
        if (open?.simulated_after_seconds) { setNow(Date.now()); setNeed({ ...need, kind: "REVIEW", approvalId: open.id, readyAt: Date.parse(open.created_at) + 1000 + open.simulated_after_seconds * 1000 }); return; }
        if (open) { setNotice(t("shell.policy.requested")); setNeed(null); return; }
      }
      setError(reasonValue instanceof Error ? reasonValue.message : t("shell.err.generic")); }
    finally { setBusy(false); }
  }

  async function finishReview() {
    if (need?.kind !== "REVIEW" || !need.approvalId) return;
    setBusy(true); setError("");
    try {
      await client.post(`approvals/${need.approvalId}/simulate/`, {}, `approval-simulate:${need.approvalId}`);
      setNotice(t("shell.policy.approved"));
      setNeed({ kind: "STEP_UP", subject: need.subject, send: need.send });
    } catch (reasonValue) {
      // Not simulated here (e.g. turned off): leave it with operations, as before.
      setNotice(t("shell.policy.requested")); setNeed(null);
      if (!(reasonValue instanceof WalletApiError && reasonValue.code === "APPROVAL_SIMULATION_OFF"))
        setError(reasonValue instanceof Error ? reasonValue.message : t("shell.err.generic"));
    } finally { setBusy(false); }
  }

  const amount = need ? formatMoney(need.subject.amount, need.subject.currency, lang) : "";
  const review = need?.kind === "REVIEW" && <div className="service-policy" role="status" aria-live="polite">
    <h4><TierBadge tier="T3" /> {t("shell.policy.reviewTitle")}</h4>
    <p>{t("shell.policy.contact")}</p>
    <div className="policy-countdown" aria-hidden="true"><span style={{ width: `${Math.max(0, (REVIEW_SECONDS - left) / REVIEW_SECONDS * 100)}%` }} /></div>
    <p className="panel-muted">{left > 0 ? t("shell.policy.countdown", { n: left }) : t("shell.policy.approving")}</p>
    <div className="service-actions"><button className="secondary" disabled={busy} onClick={() => setNeed(null)}>{t("shell.policy.later")}</button></div>
  </div>;
  const panel = <>
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="service-notice" role="status">{notice}</p>}
    {need?.kind === "STEP_UP" && <div className="service-policy">
      <h4><TierBadge tier="T2" /> {t("shell.policy.stepUpTitle")}</h4>
      <p>{t("shell.policy.stepUpText", { amount })}</p>
      <form onSubmit={(event) => { event.preventDefault(); void confirmPassword(); }}>
        <label className="service-field">{t("shell.policy.password")}<input ref={passwordRef} type="password" autoComplete="current-password" /></label>
        <div className="service-actions">
          <button type="submit" className="primary" disabled={busy || preview}>{t("shell.policy.submit")}</button>
          <button type="button" className="secondary" disabled={busy} onClick={() => setNeed(null)}>{t("shell.cancel")}</button>
        </div>
      </form>
    </div>}
    {review}
    {need?.kind === "APPROVAL" && <div className="service-policy">
      <h4><TierBadge tier="T3" /> {t("shell.policy.approvalTitle")}</h4>
      <p>{t("shell.policy.approvalText")}</p>
      <label className="service-field">{t("shell.policy.reasonOptional")}<input value={reason} maxLength={500} placeholder={t("shell.policy.reasonHint")}
        onChange={(event) => setReason(event.target.value)} /></label>
      <div className="service-actions">
        <button className="primary" disabled={busy || preview} onClick={() => void requestApproval()}>{t("shell.policy.request")}</button>
        <button className="secondary" disabled={busy} onClick={() => setNeed(null)}>{t("shell.cancel")}</button>
      </div>
    </div>}
  </>;
  const modalPanel = need ? <FocusDialog title={t("ws.confirm")} busy={busy} onClose={() => setNeed(null)}><p>{amount} · {need.subject.target_id.slice(0, 8)}</p>{panel}</FocusDialog> : panel;
  return { run, panel: modalPanel, pending: need !== null };
}
