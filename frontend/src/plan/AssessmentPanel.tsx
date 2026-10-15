import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import { FocusDialog } from "../workspace/FocusDialog";
import { PanelAlert, PanelEmpty, PanelSkeleton, ToolPanel } from "../workspace/ToolPanel";
import { PanelPage, PanelLink } from "../workspace/PanelPage";
import { useToolRefresh } from "../workspace/context";
import type { WalletClient } from "../wallet/client";
import type { Plan } from "./types";
import { useAssessment } from "./useAssessment";
import { AssessmentForm } from "./AssessmentForm";
import { AssessmentResults, QuoteFacts, QuoteChoices } from "./AssessmentResults";
import { AssessmentProgress } from "./AssessmentProgress";
import { LoanStage } from "./LoanStage";
import { LoanChooser, type LoanChoice } from "./LoanChooser";
import { PlanVisual } from "./PlanVisual";
import "./assessment.css";

export function AssessmentPanel({ client, plan, preview, onConfirmed }: {
  client: WalletClient; plan: Plan | null; preview: boolean; onConfirmed?: () => Promise<void>;
}) {
  const { t } = useI18n();
  const { data, inputs, edit, busy, dirty, error, setError, refresh, persist } = useAssessment(client, plan, preview);
  const stale = useToolRefresh(refresh);
  const [page, setPage] = useState<"main" | "details" | "edit" | "sign">("main");
  const [confirm, setConfirm] = useState(false), [submitting, setSubmitting] = useState(false);
  const [picked, setPicked] = useState("");
  const quote = data?.quotes.find(q => q.id === picked) ?? data?.quotes[0];
  const draft = plan?.status === "DRAFT";
  const application = data?.lifecycle?.applications.find(a => a.status !== "CANCELLED");
  const needsSigning = !preview && !draft && !!application && !data?.loan_stage?.signed
    && ["APPROVED", "UNDER_REVIEW"].includes(application.status);
  const loanQuote = data?.quotes.find(q => q.id === application?.loan) ?? quote;
  useEffect(() => {
    if (needsSigning) setPage("sign");
  }, [needsSigning, application?.id, plan?.id]);
  const valid = !!quote && !data?.draft && !data?.stale && !dirty;
  const choice: LoanChoice | null = inputs ? { principal: Number(inputs.loan.principal ?? 0), months: inputs.loan.months,
    product: inputs.loan.product, method: inputs.loan.method } : null;
  const choose = (value: LoanChoice) => inputs && edit({ ...inputs, loan: { ...inputs.loan,
    ...value, principal: value.principal > 0 ? value.principal.toFixed(2) : null } });
  async function evaluate() {
    try { await persist(false); } catch { /* useAssessment displays the error */ }
  }
  async function submit() {
    if (!plan || !data || !quote || !valid || submitting) return;
    setSubmitting(true); setError("");
    try {
      await client.post("planning/plan/confirm/", { expected_version: data.version, plan_version: plan.version, quote_id: quote.id },
        `planning-confirm:${plan.id}:${plan.version}:${data.version}:${quote.id}`);
      setConfirm(false); setPage("sign"); await refresh(); await onConfirmed?.();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setSubmitting(false); }
  }
  if (!plan) return <ToolPanel label={t("simple.plan")}><PanelEmpty title={t("simple.empty")} /></ToolPanel>;
  return <ToolPanel label={t("simple.plan")} notices={stale}><div className="assessment-panel">
    {error && <PanelAlert message={error} onRetry={() => void refresh().catch(e => setError(String(e)))} />}
    {!data || !inputs ? <PanelSkeleton /> : page === "details" ? <PanelPage title={t("simple.details")} onBack={() => setPage("main")}>
      <AssessmentResults data={data} />{quote && <QuoteFacts quote={quote} toSchool />}</PanelPage>
      : page === "edit" ? <PanelPage title={t("simple.manual")} onBack={() => setPage("main")}>
        <AssessmentForm value={inputs} onChange={edit} disabled={busy || submitting || !draft || preview} />
        <button className="primary" disabled={busy || preview || !draft} onClick={() => { void evaluate(); setPage("main"); }}>{t("simple.evaluate")}</button></PanelPage>
      : page === "sign" && !draft && application ? <PanelPage title={t(data.loan_stage?.signed ? "stage.signed" : "stage.completeSigning")} onBack={() => setPage("main")}>
        <LoanStage data={data} quote={loanQuote} client={client} refresh={refresh} preview={preview} showHeading={false} />
        <AssessmentProgress data={data} client={client} refresh={refresh} /></PanelPage>
      : <>
        {preview && <p className="panel-muted">{t("simple.preview")}</p>}
        {needsSigning && <div className="panel-note assessment-signing-notice" role="status">
          <p>{t("stage.pendingSigning")}</p>
          <button className="primary" onClick={() => setPage("sign")}>{t("stage.nextSigning")}</button>
        </div>}
        <PlanVisual data={data} />
        {draft && !preview && choice && <>
          <LoanChooser client={client} check={{ currency: "THB", max_principal: data.limit?.max_principal ?? null, products: data.products }}
            choice={choice} onChange={choose} />
          <button className="primary assessment-main" disabled={busy || submitting || choice.principal <= 0}
            onClick={() => void evaluate()}>{t("simple.evaluate")}</button>
        </>}
        {quote && (valid || preview || !draft) && <QuoteChoices quotes={data.quotes} selected={quote.id} onSelect={setPicked} />}
        {draft && valid && !preview && <button className="primary assessment-main" disabled={busy || submitting} onClick={() => setConfirm(true)}>
          {t("simple.confirmWithLoan")}</button>}
        {!draft && !needsSigning && <LoanStage data={data} quote={loanQuote} client={client} refresh={refresh} preview={preview} />}
        {!preview && <AssessmentProgress data={data} client={client} refresh={refresh} />}
        <div className="assessment-links"><PanelLink onClick={() => setPage("details")}>{t("simple.details")}</PanelLink>
          {draft && !preview && <PanelLink onClick={() => setPage("edit")}>{t("simple.manual")}</PanelLink>}</div>
      </>}
    {confirm && valid && quote && <FocusDialog title={t("simple.confirmPlanTitle")} busy={submitting} onClose={() => setConfirm(false)}>
      <h2>{t("simple.confirmPlanTitle")}</h2><QuoteFacts quote={quote} toSchool />
      <p>{t("simple.nextSteps")}</p><p className="panel-muted">{t("simple.confirmHint")}</p>
      {error && <p role="alert">{error}</p>}
      <button className="primary" disabled={submitting} onClick={() => void submit()}>{t("simple.confirmWithLoan")}</button>
      <button className="secondary" disabled={submitting} onClick={() => setConfirm(false)}>{t("simple.cancel")}</button>
    </FocusDialog>}
  </div></ToolPanel>;
}
