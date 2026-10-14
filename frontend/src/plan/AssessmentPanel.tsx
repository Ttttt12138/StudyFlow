import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { useToolRefresh } from "../workspace/context";
import { FocusDialog } from "../workspace/FocusDialog";
import { PanelAlert, PanelEmpty, PanelSkeleton, ToolPanel } from "../workspace/ToolPanel";
import type { WalletClient } from "../wallet/client";
import type { Plan } from "./types";
import { AssessmentForm } from "./AssessmentForm";
import { AssessmentResults } from "./AssessmentResults";
import { BalanceForecast, PlanVisual } from "./PlanVisual";
import { LoanChooser, PrequalForm, PrequalResult, type LoanChoice } from "./LoanChooser";
import { LoanStage } from "./LoanStage";
import { PanelLink, PanelPage } from "../workspace/PanelPage";
import { AssessmentProgress } from "./AssessmentProgress";
import { useAssessment } from "./useAssessment";
import { verdict } from "./verdict";
import { pick } from "./format";
import type { LoanPreview, PlanningAssessment, PlanningQuote, Term } from "./assessmentTypes";
import { useShow } from "./currency";
import "./assessment.css";
import { loanProductLabel } from "../loans/products";

export function AssessmentPanel({ plan, client, preview, onConfirmed }: {
  plan: Plan | null; client: WalletClient; preview: boolean; onConfirmed?: () => Promise<void> | void;
}) {
  const { t, lang } = useI18n();
  const control = useAssessment(client, plan, preview);
  const { data, inputs, edit, busy, dirty, error, setError, refresh, persist } = control;
  const [page, setPage] = useState<"main" | "details" | "edit">("main"), [confirm, setConfirm] = useState(false), [submitting, setSubmitting] = useState(false);
  const show = useShow();
  const stale = useToolRefresh(refresh);
  const draft = plan?.status === "DRAFT";
  // Once confirmed, only the loan actually applied for is shown.
  const appliedIds = new Set(data?.lifecycle?.applications.filter(a => a.status !== "CANCELLED").map(a => a.loan) ?? []);
  const quote = data?.quotes.find(q => appliedIds.has(q.id)) ?? data?.quotes[0];
  const check = data?.prequal;
  const max = Number(check?.max_principal ?? 0);
  const canBorrow = check?.status === "enough" && max > 0;
  // The amount, term and product picked within the pre-check; it starts from what was last evaluated.
  const [choice, setChoice] = useState<LoanChoice | null>(null), [figures, setFigures] = useState<LoanPreview | null>(null);
  useEffect(() => {
    if (!data?.inputs || !check) return;
    const terms = data.inputs.loan;
    const product = terms.product ?? "custom";
    const allowed = check.products?.find(o => o.key === product)?.terms ?? [24, 36, 48, 60];
    const months = terms.months ?? terms.periods?.[0] ?? 48;
    const ways = check.products?.find(o => o.key === product)?.methods ?? ["amortized"];
    setChoice({ principal: Math.min(Number(terms.principal ?? check.max_principal ?? 0), max),
      months: (allowed.includes(months) ? months : Math.max(...allowed)) as Term, product,
      method: terms.method && ways.includes(terms.method) ? terms.method : "amortized" });
  }, [data?.version, check?.max_principal]);
  const borrowing = canBorrow && !!choice && choice.principal > 0;
  const hasResult = !!data?.forecast && !data.draft && !data.stale && !dirty;
  // Asked in the panel itself until saved: the money on hand decides the gap.
  const needsEssentials = !!data && !data.inputs?.available_funds;
  // Stays up while typing (drafts autosave underneath) until the gap is worked out.
  const [asking, setAsking] = useState(false);
  // The read-only preview still lets a visitor compare the recorded options; nothing is saved.
  const [previewPick, setPreviewPick] = useState("");
  useEffect(() => { if (needsEssentials) setAsking(true); }, [needsEssentials]);
  // No form up front: an unevaluated draft is evaluated once from what the conversation already knows.
  const evaluated = useRef(0);
  useEffect(() => {
    if (preview || !data || !inputs || hasResult || busy || error || dirty || evaluated.current === data.version) return;
    evaluated.current = data.version;
    void persist(false).catch(() => undefined);
  }, [preview, data, inputs, hasResult, busy, error, dirty, persist]);
  async function evaluate(event: React.FormEvent) {
    event.preventDefault();
    try { const next = await persist(false); if (next) { setPage("main"); setAsking(false);
      requestAnimationFrame(() => document.querySelector('.tool-content[data-tool="funding"] .panel-body')?.scrollTo(0, 0));
    } }
    catch { /* the hook retains the draft and displays the error */ }
  }
  async function confirmPlan() {
    if (!data || !plan || !inputs || !hasResult || busy) return;
    setSubmitting(true); setError("");
    try {
      let version = data.version, quoteId: string | null = null;
      if (borrowing && choice) {
        edit({ ...inputs, loan: { ...inputs.loan, principal: choice.principal.toFixed(2), months: choice.months, product: choice.product,
          method: choice.method } });
        const next = await persist(false);
        if (!next?.quotes[0]) throw new Error(t("simple.needAmount"));
        version = next.version; quoteId = next.quotes[0].id;
      }
      await client.post("planning/plan/confirm/", { expected_version: version, plan_version: plan.version, quote_id: quoteId },
        `planning-confirm:${plan.id}:${plan.version}:${version}:${quoteId ?? "none"}`);
      setConfirm(false); await refresh(); await onConfirmed?.();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setSubmitting(false); }
  }
  if (!plan) return <ToolPanel label={t("simple.plan")}><PanelEmpty title={t("simple.empty")} /></ToolPanel>;
  const back = () => setPage("main");
  // The plan is pictures on the main page; sources and the hand-edit form are pages of their own (no folding).
  const picked = preview ? data?.quotes.find(q => q.id === previewPick) ?? data?.quotes[0] : quote;
  const details = data && <PanelPage title={t("simple.details")} onBack={back}><BalanceForecast data={data} /><AssessmentResults data={data} />
    {(hasResult || preview) && <PlanSummary data={data} quote={picked} />}</PanelPage>;
  const links = data && <div className="assessment-links">
    <PanelLink onClick={() => setPage("details")} note={t("simple.detailsNote")}>{t("simple.details")}</PanelLink>
    {!preview && <PanelLink onClick={() => setPage("edit")} note={t("simple.manualNote")}>{t("simple.manual")}</PanelLink>}</div>;
  if (preview) return <ToolPanel label={t("simple.plan")}><div className="assessment-panel">
    {page === "details" && details ? details : <><p>{t("simple.preview")}</p>
      {data ? <><PlanVisual data={data} selected={picked?.id ?? ""} onSelect={setPreviewPick} showQuotes />{links}</> : <PanelSkeleton />}</>}
    {error && <PanelAlert message={error} />}</div></ToolPanel>;
  return <ToolPanel label={t("simple.plan")} notices={stale}><div className="assessment-panel">
    {error && <PanelAlert message={error} onRetry={() => void refresh().catch(e => setError(String(e)))} />}
    {!inputs ? <PanelSkeleton /> : page === "details" && details ? details
    : page === "edit" ? <PanelPage title={t("simple.manual")} onBack={back}><form className="assessment-edit" onSubmit={evaluate}>
        <AssessmentForm value={inputs} onChange={edit} estimate={data?.estimate} disabled={submitting} />
        <p className="panel-muted" role="status">{busy ? t("simple.saving") : !dirty && data?.version ? t("simple.saved") : ""}</p>
        <button type="submit" className="primary assessment-main" disabled={busy || submitting}>{t("simple.evaluate")}</button>
      </form></PanelPage>
    : <>
      <p className="panel-muted">{t("simple.simulated")}</p>
      {data?.stale && <p role="status">{t("simple.stale")}</p>}
      {data && <PlanVisual data={data} selected="" onSelect={() => undefined} />}
      {draft && (asking || !check || check.status === "unknown")
        ? <PrequalForm value={inputs} onChange={edit} disabled={busy || submitting} onSubmit={evaluate} />
        : draft && check && <>
          <PrequalResult check={check} onEdit={() => setAsking(true)} />
          {canBorrow && choice && <LoanChooser client={client} check={check} choice={choice} onChange={setChoice} onPreview={setFigures} />}
          {hasResult && <button className="primary assessment-main" disabled={busy || submitting} onClick={() => setConfirm(true)}>
            {t(borrowing ? "simple.confirmWithLoan" : "simple.confirmPlan")}</button>}
        </>}
      {!draft && hasResult && data && <>
        {plan.status === "CONFIRMED" && <p className="plan-visual-gap" role="status">{t("simple.planConfirmed")}</p>}
        <LoanStage data={data} quote={quote} client={client} refresh={refresh} />
      </>}
      {!hasResult && busy && <p className="panel-muted" role="status">{t("simple.saving")}</p>}
      {data && <AssessmentProgress data={data} client={client} refresh={refresh} />}
      {links}
    </>}
    {confirm && draft && hasResult && data && <FocusDialog title={t("simple.confirmPlanTitle")} busy={submitting} onClose={() => setConfirm(false)}>
      <h2>{t("simple.confirmPlanTitle")}</h2>
      <p>{data.plan?.school && pick(data.plan.school.name, lang)} · {t("simple.years", { n: data.estimate?.years ?? plan.years })}</p>
      {borrowing && choice ? <><p>{t("simple.withLoan")}</p>
        <dl className="assessment-facts">
          <div><dt>{t("choose.amount")}</dt><dd>{show(choice.principal, "THB", lang).main}</dd></div>
          <div><dt>{t("choose.term")}</dt><dd>{figures?.interest_only_months
            ? t("choose.termWithStudy", { study: figures.interest_only_months, n: choice.months }) : t("simple.months", { n: choice.months })}</dd></div>
          {figures?.interest_only_months ? <div><dt>{t("choose.studyMonthly")}</dt><dd>{show(figures.interest_only_payment, "THB", lang).main}</dd></div> : null}
          {figures && <div><dt>{t(figures.interest_only_months ? "choose.afterMonthly" : "simple.monthly")}</dt><dd>{show(figures.monthly_payment, "THB", lang).main}</dd></div>}
          {figures && <div><dt>{t("simple.firstDue")}</dt><dd>{figures.first_due_date}</dd></div>}
        </dl>
        <p>{t("simple.nextSteps")}</p><p className="panel-muted">{t("simple.confirmHint")}</p></>
        : <p>{t("simple.withoutLoan")}</p>}
      <p className="panel-muted">{t("simple.confirmPlanHint")}</p>{error && <p role="alert">{error}</p>}
      <button className="primary" disabled={submitting} onClick={() => void confirmPlan()}>{t(borrowing ? "simple.confirmWithLoan" : "simple.confirmPlan")}</button>
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
    quote ? verdict(t, quote) : "",
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
