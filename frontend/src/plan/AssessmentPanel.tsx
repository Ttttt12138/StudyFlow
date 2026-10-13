import { useState } from "react";
import { useI18n } from "../i18n";
import { useToolRefresh } from "../workspace/context";
import { FocusDialog } from "../workspace/FocusDialog";
import { PanelAlert, PanelEmpty, PanelSkeleton, ToolPanel } from "../workspace/ToolPanel";
import type { WalletClient } from "../wallet/client";
import type { Plan } from "./types";
import { AssessmentForm } from "./AssessmentForm";
import { AssessmentResults, QuoteChoices, QuoteFacts } from "./AssessmentResults";
import { AssessmentProgress } from "./AssessmentProgress";
import { useAssessment } from "./useAssessment";
import { pick } from "./format";
import type { PlanningAssessment, PlanningQuote } from "./assessmentTypes";
import "./assessment.css";
import { loanProductLabel } from "../loans/products";

export function AssessmentPanel({ plan, client, preview }: { plan: Plan | null; client: WalletClient; preview: boolean }) {
  const { t } = useI18n();
  const control = useAssessment(client, plan, preview);
  const { data, inputs, edit, busy, dirty, error, setError, refresh, persist } = control;
  const [editing, setEditing] = useState(false), [confirm, setConfirm] = useState(false), [submitting, setSubmitting] = useState(false);
  const [selected, setSelected] = useState("");
  const stale = useToolRefresh(refresh);
  const quote = data?.quotes.find(q => q.id === selected) ?? data?.quotes[0];
  const hasResult = !!data?.forecast && !data.draft && !data.stale && !dirty;
  const showForm = !hasResult || editing;
  async function evaluate(event: React.FormEvent) {
    event.preventDefault();
    try { const next = await persist(false); if (next) { setSelected(next.quotes[0]?.id ?? ""); setEditing(false);
      requestAnimationFrame(() => document.querySelector('.tool-content[data-tool="funding"] .panel-body')?.scrollTo(0, 0));
    } }
    catch { /* the hook retains the draft and displays the error */ }
  }
  async function submit() {
    if (!quote || !data || !plan || !hasResult || busy) return;
    setSubmitting(true); setError("");
    try {
      await client.post("planning/loan-applications/", { expected_version: data.version, plan_version: plan.version, quote_id: quote.id },
        `planning-apply:${quote.id}:${data.version}`);
      setConfirm(false); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setSubmitting(false); }
  }
  if (!plan) return <ToolPanel label={t("simple.plan")}><PanelEmpty title={t("simple.empty")} /></ToolPanel>;
  if (preview) return <ToolPanel label={t("simple.plan")}><div className="assessment-panel"><p>{t("simple.preview")}</p>
    {data ? <><AssessmentResults data={data} /><QuoteChoices quotes={data.quotes} selected={quote?.id ?? ""} onSelect={setSelected} /><PlanSummary data={data} quote={quote} /></> : <PanelSkeleton />}
    {error && <PanelAlert message={error} />}</div></ToolPanel>;
  return <ToolPanel label={t("simple.plan")} notices={stale}><div className="assessment-panel">
    <p className="panel-muted">{t("simple.simulated")}</p>
    {error && <PanelAlert message={error} onRetry={() => void refresh().catch(e => setError(String(e)))} />}
    {!inputs ? <PanelSkeleton /> : <>
      {data?.stale && <p role="status">{t("simple.stale")}</p>}
      {showForm && <form onSubmit={evaluate}>
        <AssessmentForm value={inputs} onChange={edit} estimate={data?.estimate} disabled={submitting} />
        <p className="panel-muted" role="status">{busy ? t("simple.saving") : !dirty && data?.version ? t("simple.saved") : ""}</p>
        <button type="submit" className="primary assessment-main" disabled={busy || submitting}>{t("simple.evaluate")}</button>
      </form>}
      {hasResult && data && <><AssessmentResults data={data} />
        {!editing && <button type="button" className="link-button" onClick={() => setEditing(true)}>{t("simple.edit")}</button>}
        {data.quotes.length > 0 ? <QuoteChoices quotes={data.quotes} selected={quote?.id ?? ""} onSelect={setSelected} />
          : data.suggested_principal === "0.00" ? <p>{t("simple.noGap")}</p> : <p>{t("simple.needAmount")}</p>}
        {quote && !editing && !data.lifecycle?.applications.some(a => a.loan === quote.id || ["UNDER_REVIEW", "APPROVED", "DISBURSED"].includes(a.status)) &&
          <button className="primary assessment-main" disabled={busy || submitting} onClick={() => setConfirm(true)}>{t("simple.submit")}</button>}
        <PlanSummary data={data} quote={quote} />
      </>}
      {data && <AssessmentProgress data={data} client={client} refresh={refresh} />}
    </>}
    {confirm && quote && hasResult && <FocusDialog title={t("simple.confirmTitle")} busy={submitting} onClose={() => setConfirm(false)}>
      <h2>{t("simple.confirmTitle")}</h2><p>{t("simple.months", { n: quote.inputs.months })}</p><QuoteFacts quote={quote} />
      <p>{t("simple.confirmHint")}</p>{error && <p role="alert">{error}</p>}
      <button className="primary" disabled={submitting} onClick={() => void submit()}>{t("simple.confirm")}</button>
      <button className="secondary" disabled={submitting} onClick={() => setConfirm(false)}>{t("simple.cancel")}</button>
    </FocusDialog>}
  </div></ToolPanel>;
}

function PlanSummary({ data, quote }: { data: PlanningAssessment; quote?: PlanningQuote }) {
  const { t, lang } = useI18n();
  const [notice, setNotice] = useState("");
  const e = data.estimate, f = data.forecast;
  const text = [t("simple.summary"), data.plan?.school ? pick(data.plan.school.name, lang) : "",
    `${t("simple.total")}: ${e?.total ?? "—"} ${e?.currency ?? ""}`,
    `${t("simple.firstYear")}: ${e?.first_year ?? "—"} ${e?.currency ?? ""}`,
    `${t("simple.forecast", { days: f?.horizon ?? 90 })}: ${f?.as_of} → ${f?.end_date}`,
    `${t("simple.gap")}: ${f?.complete ? f.maximum_reserve_gap + " THB" : t("simple.unknown")}`,
    quote ? t(loanProductLabel(quote.inputs.product)) : "",
    quote ? `${t("simple.months", { n: quote.inputs.months })} · ${t("simple.monthly")}: ${quote.result.maximum_installment} THB · ${t("simple.totalRepay")}: ${quote.result.total_repayment} THB` : "",
    quote ? `${t("simple.net")}: ${quote.result.net_proceeds} THB · ${t("simple.rate")}: ${Number(quote.inputs.annual_rate) * 100}% · ${t("simple.fees")}: ${quote.result.fees} THB` : "",
    quote ? t(quote.assessment.status === "AFFORDABLE" ? "simple.affordable" : quote.assessment.status === "UNAFFORDABLE" ? "simple.unaffordable" : "simple.insufficient") : "",
    `${t("simple.missing")}: ${[...(e?.missing_cost_ids ?? []), ...(f?.issues ?? [])].join(", ") || "—"}`,
    t("simple.simulated")].filter(Boolean).join("\n");
  return <section className="assessment-summary"><h3>{t("simple.summary")}</h3><pre>{text}</pre>
    <button className="secondary" onClick={() => void navigator.clipboard.writeText(text).then(() => setNotice(t("simple.copied"))).catch(() => setNotice(t("simple.copy")))}>{t("simple.copy")}</button>
    <button className="secondary" onClick={() => printSummary(text)}>{t("simple.print")}</button>
    {notice && <p role="status">{notice}</p>}</section>;
}

function printSummary(text: string) {
  const paper = document.createElement("pre");
  paper.id = "planning-print-summary"; paper.textContent = text;
  document.body.append(paper); document.body.classList.add("planning-print");
  try { window.print(); }
  finally { paper.remove(); document.body.classList.remove("planning-print"); }
}
