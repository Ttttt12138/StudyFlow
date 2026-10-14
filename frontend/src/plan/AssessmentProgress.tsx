import { useState } from "react";
import { useI18n } from "../i18n";
import { useWorkspace } from "../workspace/context";
import { FocusDialog } from "../workspace/FocusDialog";
import { usePolicyAction } from "../services/usePolicyAction";
import { formatMoney } from "../backend/presenters";
import type { WalletClient } from "../wallet/client";
import type { LoanAccount, Installment } from "../loans/types";
import type { PlanningAssessment } from "./assessmentTypes";

export function AssessmentProgress({ data, client, refresh }: {
  data: PlanningAssessment; client: WalletClient; refresh: () => Promise<void>;
}) {
  const { t, lang } = useI18n();
  const workspace = useWorkspace(), policy = usePolicyAction(client, false);
  const [confirm, setConfirm] = useState<{ account: LoanAccount; next: Installment } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const apps = data.lifecycle?.applications ?? [];
  async function repay() {
    if (!confirm || busy) return;
    const { account, next } = confirm;
    setBusy(true); setError("");
    try {
      await policy.run({ action: "loan.repay", target_id: account.id, amount: next.amount, currency: "THB" }, async token => {
        await client.post(`loan-accounts/${account.id}/repay/`, { expected_version: account.version, installment_number: next.number },
          `loan-repay:${account.id}:${account.version}:${next.number}`, token ? { "X-Step-Up-Token": token } : {});
        await refresh();
      });
      setConfirm(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); await refresh().catch(() => undefined); }
    finally { setBusy(false); }
  }
  // Approval, documents and signing are shown by LoanStage; this section is the signed loan's repayments.
  const signed = apps.filter(a => data.lifecycle?.disbursements.some(d => d.application === a.id));
  if (!signed.length) return null;
  return <section><h3>{t("simple.lifecycle")}</h3>{signed.map(a => {
    const disbursement = data.lifecycle?.disbursements.find(d => d.application === a.id);
    const account = data.lifecycle?.accounts.find(r => r.disbursement === disbursement?.id);
    const next = account?.installments.find(r => r.status !== "PAID");
    return <div key={a.id} className="assessment-item">
      {disbursement && disbursement.status !== "school" && <p>{t("simple.net")}: {formatMoney(disbursement.amount, "THB", lang)} · {disbursement.scheduled_on}</p>}
      {next && account && <><p>{t("simple.next")}: {next.due_on} · {formatMoney(next.amount, "THB", lang)} · {t(`loans.status.${next.status}`)}</p>
        <button className="primary" disabled={busy || policy.pending || next.status === "SCHEDULED"} onClick={() => setConfirm({ account, next })}>{t("simple.confirmRepay")}</button>
        {next.status === "SCHEDULED" && <p className="panel-muted">{t("simple.notDue")}</p>}</>}
      {account?.status === "CLOSED" && <p>{t("loans.status.CLOSED")}</p>}
    </div>;
  })}
    {error && <p role="alert">{error}</p>}{policy.panel}
    <button className="link-button" onClick={() => void refresh().catch(e => setError(String(e)))}>{t("simple.refresh")}</button>{" · "}
    <button className="link-button" onClick={() => workspace?.open({ kind: "loans" })}>{t("simple.loanDetails")}</button>
    {confirm && <FocusDialog title={t("simple.confirmRepay")} busy={busy} onClose={() => setConfirm(null)}>
      <p>{confirm.next.due_on} · {formatMoney(confirm.next.amount, "THB", lang)}</p>
      <button className="primary" disabled={busy} onClick={() => void repay()}>{t("simple.confirmRepay")}</button>
      <button className="secondary" disabled={busy} onClick={() => setConfirm(null)}>{t("simple.cancel")}</button>
    </FocusDialog>}
  </section>;
}
