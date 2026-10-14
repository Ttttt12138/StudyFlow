import { useState } from "react";
import { formatMoney } from "../backend/presenters";
import { useI18n, type MessageKey } from "../i18n";
import type { WalletClient } from "../wallet/client";
import { FocusDialog } from "../workspace/FocusDialog";
import { QuoteFacts } from "./AssessmentResults";
import type { LoanPayout, PlanningAssessment, PlanningQuote } from "./assessmentTypes";
import { useShow } from "./currency";
import { pick } from "./format";

/**
 * After the plan is confirmed, the loan goes as it does with a lender: approval, the documents, signing, then
 * payment to the school bill by bill. Repayments of the signed loan follow in AssessmentProgress.
 */
export function LoanStage({ data, quote, client, refresh }: {
  data: PlanningAssessment; quote?: PlanningQuote; client: WalletClient; refresh: () => Promise<void>;
}) {
  const { t, lang } = useI18n();
  const show = useShow();
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [signing, setSigning] = useState(false);
  const application = data.lifecycle?.applications.find(a => a.status !== "CANCELLED");
  if (!application) return null;
  const stage = data.loan_stage ?? { documents: [], payouts: [], signed: false };
  const left = stage.documents.filter(d => !d.done).length;
  const loanTotal = stage.payouts.reduce((sum, p) => sum + Number(p.amount), 0);
  const payee = stage.school_payee;
  const held = payee?.verified === false;
  const canSign = application.status === "APPROVED" && !stage.signed && left === 0 && !held;
  async function run(action: () => Promise<unknown>) {
    setBusy(true); setError("");
    try { await action(); await refresh(); return true; }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); return false; }
    finally { setBusy(false); }
  }
  const tick = (id: string, done: boolean, version: number) => void run(() =>
    client.post("planning/loan/documents/", { task_id: id, done, expected_version: version }, `loan-doc:${id}:${version}`));
  const sign = () => void run(() => client.post("planning/loan/sign/", { application_id: application.id, expected_version: application.version },
    `loan-sign:${application.id}:${application.version}`)).then(ok => { if (ok) setSigning(false); });
  const status = stage.signed ? t("stage.signed") : application.status === "APPROVED" ? t("stage.approved")
    : application.status === "UNDER_REVIEW" ? t("stage.review") : application.status === "REJECTED" ? t("stage.rejected") : "";
  return <section className="loan-stage" aria-label={t("stage.title")}>
    <h3 className="panel-section-title">{t("stage.title")}</h3>
    {status && <p className={stage.signed ? "plan-visual-gap" : "panel-muted"} role="status">{status}</p>}
    {payee && <p className="panel-muted loan-stage-payee">{t("stage.payee", { name: payee.name, account: payee.account })}
      {!held && <> · <span className="panel-tag">{t("stage.payeeVerified")}</span></>}</p>}
    {held && <p className="life-warning" role="alert">{t("stage.payeeUnverified")}</p>}
    {!stage.signed && stage.documents.length > 0 && <fieldset className="loan-stage-docs" disabled={busy}>
      <legend>{t("stage.docs")}{left > 0 && ` · ${t("stage.docsLeft", { n: left })}`}</legend>
      {stage.documents.map(d => <label key={d.id}>
        <input type="checkbox" checked={d.done} onChange={e => tick(d.id, e.target.checked, d.version)} />
        <span>{d.title ? pick(d.title, lang) : d.key}</span>
        {d.due_date && <small className="panel-muted">{d.due_date}</small>}
      </label>)}
    </fieldset>}
    {application.status === "APPROVED" && !stage.signed &&
      <button type="button" className="primary assessment-main" disabled={busy || !canSign} onClick={() => setSigning(true)}>{t("stage.sign")}</button>}
    {stage.payouts.length > 0 && <div className="loan-stage-payouts">
      <h4>{t("stage.payouts")}</h4>
      <p className="plan-visual-gap">{t("stage.loanCovers", { amount: show(loanTotal, "THB", lang).main,
        rest: show(Math.max(0, Number(data.prequal?.gap ?? 0) - loanTotal), "THB", lang).main })}</p>
      <ul>{byDate(stage.payouts).map(group => <li key={group.date} className={group.paid ? "is-paid" : ""}
        title={group.items.map(p => typeof p.bill_label === "string" ? p.bill_label : pick(p.bill_label, lang)).join("\n")}>
        <span>{[...new Set(group.items.map(p => t(KIND[p.kind] ?? "stage.kind.other")))].join("、")}</span>
        <strong>{show(group.total, "THB", lang).main}</strong>
        <small className="panel-muted">{group.paid ? t("stage.paidOn", { date: group.date }) : t("stage.scheduled", { date: group.date })}
          {group.items[0].bill_currency !== "THB" && ` · ${formatMoney(group.billTotal.toFixed(2), group.items[0].bill_currency, lang)}`}</small>
      </li>)}</ul>
      <p className="panel-muted">{t("stage.family")}</p>
    </div>}
    {error && <p role="alert">{error}</p>}
    {signing && quote && <FocusDialog title={t("stage.signTitle")} busy={busy} onClose={() => setSigning(false)}>
      <h2>{t("stage.signTitle")}</h2>
      <p>{quote.inputs.grace_months ? t("choose.termWithStudy", { study: quote.inputs.grace_months, n: quote.inputs.months })
        : t("simple.months", { n: quote.inputs.months })}</p><QuoteFacts quote={quote} toSchool />
      <p>{t("stage.signHint")}</p>{error && <p role="alert">{error}</p>}
      <button className="primary" disabled={busy} onClick={sign}>{t("stage.sign")}</button>
      <button className="secondary" disabled={busy} onClick={() => setSigning(false)}>{t("simple.cancel")}</button>
    </FocusDialog>}
  </section>;
}

const KIND: Record<string, MessageKey> = { tuition: "stage.kind.tuition", housing: "stage.kind.housing",
  insurance: "stage.kind.insurance", visa: "stage.kind.visa" };

/** One line per payment date: what the loan pays the school that day, in THB and in the school's currency. */
function byDate(payouts: LoanPayout[]) {
  const groups = new Map<string, LoanPayout[]>();
  for (const p of payouts) groups.set(p.due_date, [...(groups.get(p.due_date) ?? []), p]);
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([date, items]) => ({ date, items,
    total: items.reduce((sum, p) => sum + Number(p.amount), 0), billTotal: items.reduce((sum, p) => sum + Number(p.bill_amount), 0),
    paid: items.every(p => p.status === "PAID") }));
}
