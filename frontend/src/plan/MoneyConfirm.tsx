import { useEffect, useRef, useState } from "react";
import { useI18n, type MessageKey } from "../i18n";
import { WalletApiError, type WalletClient } from "../wallet/client";
import { FocusDialog } from "../workspace/FocusDialog";
import { cash } from "./currency";
import type { PendingAction } from "./types";

const ACTIONS = ["remittance.submit", "wallet.convert"];
export const moneyActionName = (action: string, t: (key: MessageKey) => string) =>
  ACTIONS.includes(action) ? t(`agent.action.${action}` as MessageKey) : action;

function describe(err: unknown, t: (key: MessageKey) => string) {
  if (err instanceof WalletApiError) {
    const known = ({ STEP_UP_FAILED: "agent.err.stepUpFailed", STEP_UP_INVALID: "agent.err.stepUpInvalid",
      PENDING_ACTION_CLOSED: "agent.err.closed", APPROVAL_ALREADY_OPEN: "agent.err.approvalOpen" } as Record<string, MessageKey>)[err.code];
    if (known) return t(known);
    if (err.status === 429) return t("agent.err.throttled");
    return err.message;
  }
  return err instanceof Error ? err.message : t("agent.err.generic");
}

/**
 * A money proposal from the conversation (transfer, currency exchange), confirmed in place: the password buys a
 * single-use step-up grant bound to this action and amount, then the proposal is confirmed with it. Above the
 * user's limit the server answers APPROVAL_REQUIRED and the dialog turns into an operator-approval request.
 */
export function MoneyConfirm({ action, client, onClose, onDone }: {
  action: PendingAction; client: WalletClient; onClose: () => void; onDone: (notice: string) => Promise<void>;
}) {
  const { lang, t } = useI18n();
  const password = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [approval, setApproval] = useState(false);
  const [reason, setReason] = useState("");
  const amount = action.amount ? cash(action.amount, action.currency ?? "", lang) : "";
  // The approval form replaces the password form; move focus to its first field.
  useEffect(() => { if (approval) document.querySelector<HTMLTextAreaElement>(".money-confirm textarea")?.focus(); }, [approval]);
  useEffect(() => () => { if (password.current) password.current.value = ""; }, []);

  async function confirm() {
    const secret = password.current?.value ?? "";
    if (!secret) { password.current?.focus(); return; }
    setBusy(true); setError("");
    try {
      const grant = await client.post<{ token: string }>("auth/step-up/", {
        password: secret, action: action.action, target_id: action.target_id, amount: action.amount, currency: action.currency,
      }, "auth/step-up/");
      if (password.current) password.current.value = "";
      try {
        const decided = await client.post<PendingAction>(`agent/pending-actions/${action.id}/confirm/`, {},
          `agent-confirm:${action.id}`, { "X-Step-Up-Token": grant.token });
        // Confirming a proposal whose quote has expired executes nothing; the order result says so.
        const outcome = String(decided.result?.effective_status ?? decided.result?.status ?? "");
        window.dispatchEvent(new Event("studyflow:write"));
        await onDone(decided.status === "CONFIRMED" && outcome === "EXPIRED" ? t("agent.notice.expiredOrder")
          : decided.status === "CONFIRMED" ? t("agent.notice.confirmed")
          : t("agent.notice.decided", { status: t(`agent.pending.${decided.status}` as MessageKey) }));
      } catch (err) {
        if (err instanceof WalletApiError && err.code === "APPROVAL_REQUIRED") { setApproval(true); setError(t("agent.err.approvalRequired")); }
        else throw err;
      }
    } catch (err) { setError(describe(err, t)); }
    finally { if (password.current) password.current.value = ""; setBusy(false); }
  }

  async function reject() {
    setBusy(true); setError("");
    try {
      await client.post(`agent/pending-actions/${action.id}/reject/`, {}, `agent-reject:${action.id}`);
      await onDone(t("agent.notice.rejected"));
    } catch (err) { setError(describe(err, t)); } finally { setBusy(false); }
  }

  async function requestApproval() {
    setBusy(true); setError("");
    try {
      await client.post("approvals/", { action: action.action, target_id: action.target_id, amount: action.amount,
        currency: action.currency, reason: reason.trim() }, `approval:${action.action}:${action.target_id}`);
      await onDone(t("agent.notice.approvalRequested"));
    } catch (err) { setError(describe(err, t)); } finally { setBusy(false); }
  }

  return <FocusDialog title={t("ws.confirm")} onClose={onClose} busy={busy} initialFocusSelector="input, textarea">
    <div className="money-confirm">
      <h2>{moneyActionName(action.action, t)}</h2>
      {amount && <p className="price-big">{amount}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {approval ? <form onSubmit={event => { event.preventDefault(); void requestApproval(); }}>
        <p className="panel-muted"><strong>{t("agent.approval.title")}</strong> {t("agent.approval.text")}</p>
        <label className="money-field">{t("agent.approval.reason")}
          <textarea value={reason} maxLength={500} rows={2} onChange={event => setReason(event.target.value)} /></label>
        <div className="price-actions">
          <button type="submit" className="primary" disabled={busy || !reason.trim()}>{t("agent.approval.submit")}</button>
          <button type="button" className="secondary" disabled={busy} onClick={onClose}>{t("common.cancel")}</button>
        </div>
      </form> : <form onSubmit={event => { event.preventDefault(); void confirm(); }}>
        <p className="panel-muted"><strong>{t("agent.stepUp.title")}</strong> {t("agent.stepUp.text", { amount })}</p>
        <label className="money-field">{t("agent.stepUp.password")}
          <input ref={password} type="password" autoComplete="current-password" /></label>
        <div className="price-actions">
          <button type="submit" className="primary" disabled={busy}>{t("agent.stepUp.submit")}</button>
          <button type="button" className="secondary" disabled={busy} onClick={() => void reject()}>{t("plan.confirm.no")}</button>
        </div>
      </form>}
    </div>
  </FocusDialog>;
}
