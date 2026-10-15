import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import { FocusDialog } from "../workspace/FocusDialog";
import type { WalletClient } from "../wallet/client";
import type { PlanningAssessment } from "./assessmentTypes";
import { QuoteFacts } from "./AssessmentResults";
import { matchesLoanReview, type LoanReview } from "./loanAdvice";

export function LoanApplicationReview({ review, client, onClose, onApplied, onLatest }: {
  review: LoanReview; client: WalletClient; onClose: () => void; onApplied: () => Promise<void>; onLatest: () => void;
}) {
  const { t } = useI18n();
  const [data, setData] = useState<PlanningAssessment | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    client.get<PlanningAssessment>("planning/assessment/").then(current => {
      if (!alive) return;
      if (matchesLoanReview(current, review)) setData(current);
      else setError(t("advice.stale"));
    }).catch(e => { if (alive) setError(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, [client, review, t]);
  async function submit() {
    if (!data || busy) return;
    setBusy(true); setError("");
    try {
      await client.post("planning/plan/confirm/", { expected_version: review.assessmentVersion,
        plan_version: review.planVersion, quote_id: review.quoteId },
      `planning-confirm:${review.planId}:${review.planVersion}:${review.assessmentVersion}:${review.quoteId}`);
      await onApplied(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  const quote = data?.quotes.find(row => row.id === review.quoteId);
  return <FocusDialog title={t("advice.review")} busy={busy} onClose={onClose}>
    <h2>{t("advice.review")}</h2>
    {quote ? <><p>{quote.inputs.grace_months ? t("choose.termWithStudy", { study: quote.inputs.grace_months, n: quote.inputs.months })
      : t("simple.months", { n: quote.inputs.months })} · {t(quote.inputs.grace_months ? "choose.method.interestOnly" : "choose.method.amortized")}</p>
      <QuoteFacts quote={quote} toSchool /><p>{t("simple.nextSteps")}</p><p className="panel-muted">{t("simple.confirmHint")}</p></>
      : !error && <p role="status">{t("advice.loading")}</p>}
    {error && <p role="alert">{error}</p>}
    {quote && <button type="button" className="primary" disabled={busy} onClick={() => void submit()}>{t("simple.confirmWithLoan")}</button>}
    {error && <button type="button" className="secondary" disabled={busy} onClick={onLatest}>{t("advice.openPlan")}</button>}
    <button type="button" className="secondary" disabled={busy} onClick={onClose}>{t("simple.cancel")}</button>
  </FocusDialog>;
}
