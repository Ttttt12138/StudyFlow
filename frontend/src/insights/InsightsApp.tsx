import { useToolRefresh, useToolActive, useEmbedded } from "../workspace/context";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ServiceShell } from "../services/ServiceShell";
import { formatDate, formatMoney } from "../backend/presenters";
import { intlLocale, useI18n, type MessageKey } from "../i18n";
import { SessionWalletClient, WalletApiError, type WalletClient } from "../wallet/client";
import { PanelAlert, PanelEmpty, PanelFacts, PanelHero, PanelInfo, PanelPager, PanelSheet, PanelSkeleton, ToolPanel, usePage } from "../workspace/ToolPanel";
import { Donut, LevelBar, StackBar, type Slice } from "../workspace/PanelCharts";
import { loadInsights, loadTransactions, newest, sha256, transactionsPath } from "./client";
import { confirmBody, coverageProblems, csvError, defaultSelection, humanize, isFinished, nextPath, pollDelays, recalculationJob, riskKind, unkeptSimilar, type CoverageDraft } from "./logic";
import { createInsightsPreview } from "./previewAdapter";
import { CATEGORIES, type Category, type CheckJob, type InsightsSnapshot, type RecurringExpense, type RiskCard, type SourceType, type Transaction, type TransactionImport } from "./types";
import "../wallet/wallet.css";
import "./insights.css";

const signInUrl = `/auth?next=${encodeURIComponent(window.location.origin + "/?insights=1")}`;
const initial: InsightsSnapshot = { state: null, clock: null, imports: [], recurring: [], risks: [], checks: [], briefing: null, errors: {} };
const KNOWN_COSTS = ["tuition", "housing", "food", "transport", "communications", "utilities", "insurance", "visa", "deposit", "enrollment", "study_materials", "travel", "dorm_card"];
const KNOWN_TRIGGERS = ["manual", "consumption_changed", "daily", "budget_changed", "state_changed", "context_changed", "scenario_applied", "semester_created"];
/** Money moving between own accounts, coming in, or coming back is not spending. */
const NOT_SPENDING: readonly string[] = ["Transfer", "Income", "Refund"];
const CATEGORY_COLORS: Record<string, string> = {
  Rent: "#1677ff", Food: "#ff8a3d", Transport: "#722ed1", Mobile: "#eb2f96", Utilities: "#13a8a8", Subscription: "#91caff", Other: "#8f959e",
};
type Recalc = { phase: "idle" | "waiting" | "done" | "retry" | "timeout"; code?: string };
type Revision = { id: string; category: Category; cost_id: string; refund_of: string; reason: string };
type Tab = "overview" | "categories" | "forecast" | "transactions";
type Sheet = "import" | "review" | "revise" | "checks" | "resolved" | "recurring" | null;
/** Whole cents, so sums of amounts stay exact. */
const cents = (value: string | null | undefined) => { const n = Math.round(Math.abs(Number(value)) * 100); return Number.isFinite(n) ? n : 0; };

export function InsightsApp({ preview, onExit }: { preview: boolean; onExit: () => void }) {
  const { lang, t } = useI18n();
  const toolActive = useToolActive();
  const embedded = useEmbedded();
  const client = useMemo<WalletClient>(() => preview ? createInsightsPreview() : new SessionWalletClient(), [preview]);
  const [snapshot, setSnapshot] = useState<InsightsSnapshot>(initial);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState<SourceType>("user_uploaded");
  const [review, setReview] = useState<TransactionImport | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [kept, setKept] = useState<string[]>([]);
  const [draft, setDraft] = useState<CoverageDraft>({});
  const [recalc, setRecalc] = useState<Recalc>({ phase: "idle" });
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [txCount, setTxCount] = useState(0);
  const [txNext, setTxNext] = useState<string | null>(null);
  const [txError, setTxError] = useState("");
  const [category, setCategory] = useState("");
  const [onlyReview, setOnlyReview] = useState(false);
  const [txReload, setTxReload] = useState(0);
  const [revision, setRevision] = useState<Revision | null>(null);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<Tab>("overview");
  const [sheet, setSheet] = useState<Sheet>(null);
  const [deciding, setDeciding] = useState("");
  const [reviewView, setReviewView] = useState<"rows" | "coverage">("rows");
  const [pages, setPages] = useState({ risks: 0, recurring: 0, costs: 0, txs: 0, rows: 0, imports: 0, checks: 0 });
  const turn = (key: keyof typeof pages) => (index: number) => setPages((prior) => ({ ...prior, [key]: index }));
  const fileRef = useRef<HTMLInputElement>(null);
  const alive = useRef(true);

  const currency = snapshot.state?.assets.currency ?? "THB";
  const money = (value: unknown, code = currency) => formatMoney(value, code, lang);
  const date = (value: unknown) => formatDate(value, lang);
  const when = (value: string | null | undefined) => value
    ? new Date(value).toLocaleString(intlLocale(lang), { dateStyle: "medium", timeStyle: "short" }) : "—";
  const message = (reason: unknown) => reason instanceof Error ? reason.message : t("insights.err.generic");
  const costName = (id: string) => KNOWN_COSTS.includes(id) ? t(`insights.cost.${id}` as MessageKey) : humanize(id);
  const categoryName = (value: string) => (CATEGORIES as readonly string[]).includes(value) ? t(`insights.category.${value}` as MessageKey) : value;
  const signedOut = !preview && /^HTTP (401|403):/.test(snapshot.errors.state ?? snapshot.errors.imports ?? "") && !snapshot.state;
  const costs = snapshot.state?.estimated_expenses ?? [];
  const today = snapshot.clock;

  const pollGeneration = useRef(0);
  useEffect(() => { alive.current = toolActive; pollGeneration.current++; return () => { alive.current = false; pollGeneration.current++; }; }, [toolActive]);

  const refresh = useCallback(async (api = client) => {
    setLoading(true);
    const result = await loadInsights(api);
    setSnapshot(result);
    // Resume an import that is still waiting for review.
    setReview((prior) => prior ? result.imports.find((item) => item.id === prior.id && item.status === "NEEDS_REVIEW") ?? null
      : result.imports.find((item) => item.status === "NEEDS_REVIEW") ?? null);
    setLoading(false);
    return result;
  }, [client]);

  useEffect(() => {
    setError(""); setNotice(""); setRecalc({ phase: "idle" });
    void refresh().catch((reason: unknown) => { setError(message(reason)); setLoading(false); });
  }, [refresh]);

  useEffect(() => {
    setSelected(review ? defaultSelection(review.preview.rows) : []); setKept([]); setDraft({});
    setPages((prior) => ({ ...prior, rows: 0 })); setReviewView("rows");
  }, [review?.id]);

  const loadTx = useCallback(async (path: string, append: boolean) => {
    try {
      const page = await loadTransactions(client, path);
      setTxs((prior) => append ? [...prior, ...page.results] : page.results);
      setTxCount(page.count); setTxNext(nextPath(page.next, window.location.origin)); setTxError("");
    } catch (reason) { if (!append) setTxs([]); setTxError(reason instanceof WalletApiError ? `HTTP ${reason.status}: ${reason.message}` : message(reason)); }
  }, [client]);
  useEffect(() => { if (toolActive) void loadTx(transactionsPath(category), false); }, [loadTx, category, txReload, toolActive]);

  async function perform(action: () => Promise<void>) {
    if (preview) return;
    setBusy(true); setError(""); setNotice("");
    try { await action(); }
    catch (reason) {
      if (reason instanceof WalletApiError && reason.status === 409) {
        await refresh().catch(() => {});
        setError(t("shell.err.changed"));
      } else setError(message(reason));
    } finally { setBusy(false); }
  }

  /** Follows the check job the change queued, backing off from 1 s to 10 s, then reloads the briefing. */
  async function track(analysisVersion: number, jobId?: string) {
    const generation = pollGeneration.current;
    setRecalc({ phase: "waiting" });
    for (const delay of pollDelays()) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (!alive.current || generation !== pollGeneration.current) return;
      let jobs: CheckJob[];
      try { jobs = await newest<CheckJob>(client, "readiness/checks/"); } catch { continue; }
      const job = jobId ? jobs.find((item) => item.id === jobId) ?? null : recalculationJob(jobs, analysisVersion);
      if (job && isFinished(job)) {
        setRecalc(job.status === "DONE" ? { phase: "done" } : { phase: "retry", code: job.error_code || job.status });
        await refresh().catch(() => {});
        return;
      }
    }
    if (!alive.current || generation !== pollGeneration.current) return;
    setRecalc({ phase: "timeout" });
    await refresh().catch(() => {});
  }

  async function upload() {
    if (!file) return;
    await perform(async () => {
      const form = new FormData();
      form.append("file", file);
      form.append("source_type", source);
      let item: TransactionImport;
      try { item = await client.post<TransactionImport>("readiness/transaction-imports/", form, `upload:${file.name}:${file.size}:${file.lastModified}:${source}`); }
      catch (reason) {
        if (reason instanceof WalletApiError) {
          const code = csvError(reason.code);
          if (code) { setError(t(`insights.csv.${code}` as MessageKey)); return; }
          // A lost response may still have stored the import; Django keys imports by the file's SHA-256.
          if (reason.status === 0 || reason.status >= 500) {
            const digest = await sha256(file);
            const result = await refresh();
            const existing = digest ? result.imports.find((entry) => entry.sha256 === digest) : undefined;
            if (existing) {
              const pending = existing.status === "NEEDS_REVIEW";
              setReview(pending ? existing : null); setSheet(pending ? "review" : null); setNotice(t("insights.import.recovered")); return;
            }
          }
        }
        throw reason;
      }
      if (fileRef.current) fileRef.current.value = "";
      setFile(null);
      await refresh();
      if (item.status !== "NEEDS_REVIEW") { setReview(null); setSheet(null); setNotice(t("insights.import.already", { date: when(item.created_at) })); return; }
      setReview(item); setSheet("review");
      setNotice(t("insights.import.uploaded", { rows: item.preview.rows.length, issues: item.preview.issues.length }));
    });
  }

  const rows = review?.preview.rows ?? [];
  const issues = review?.preview.issues ?? [];
  const body = review ? confirmBody(rows, selected, kept, draft, today) : null;
  const problems = review && body ? coverageProblems(rows, issues, selected, body.coverage, today) : {};
  const unkept = review ? unkeptSimilar(rows, selected, kept) : [];
  const toggle = (list: string[], id: string, on: boolean) => on ? [...new Set([...list, id])] : list.filter((item) => item !== id);
  const editCoverage = (account: string, change: Partial<CoverageDraft[string]>) => setDraft((prior) => ({ ...prior, [account]: { ...prior[account], ...change } }));

  async function confirm() {
    if (!review || !body) return;
    const target = review;
    await perform(async () => {
      let version: number;
      try { version = (await client.post<TransactionImport>(`readiness/transaction-imports/${target.id}/confirm/`, body, `confirm-import:${target.id}`)).analysis_version ?? 0; }
      catch (reason) {
        if (reason instanceof WalletApiError && (reason.status === 0 || reason.status >= 500)) {
          const result = await refresh();
          if (result.imports.find((item) => item.id === target.id)?.status === "COMMITTED") version = result.state?.analysis_version ?? 0;
          else throw reason;
        } else throw reason;
      }
      setReview(null); setSheet(null);
      setNotice(t("insights.review.confirmed", { count: body.selected_rows.length }));
      setTxReload((n) => n + 1);
      void track(version);
    });
  }

  async function revise() {
    if (!revision) return;
    const item = revision;
    await perform(async () => {
      const payload: Record<string, string> = { category: item.category, reason: item.reason.trim() };
      if (item.cost_id) payload.cost_id = item.cost_id;
      if (item.category === "Refund" && item.refund_of) payload.refund_of = item.refund_of;
      await client.post<Transaction>(`readiness/transactions/${item.id}/revise/`, payload, `revise:${item.id}`);
      setRevision(null); setSheet(null); setTxReload((n) => n + 1);
      await refresh();
      setNotice(t("insights.tx.saved"));
    });
  }

  async function decide(item: RecurringExpense, decision: "accepted" | "ignored") {
    const cost = decision === "accepted" ? links[item.id] ?? item.cost_id ?? "" : "";
    await perform(async () => {
      await client.post<RecurringExpense>(`readiness/recurring-expenses/${item.id}/review/`, { decision, cost_id: cost }, `recurring:${item.id}`);
      await refresh();
      setSheet(null);
      setNotice(t("insights.rec.saved"));
    });
  }

  async function runCheck() {
    const state = snapshot.state;
    if (!state) return;
    await perform(async () => {
      const versions = { semester_id: state.semester_id, state_version: state.state_version, budget_version: state.budget_version, analysis_version: state.analysis_version };
      const job = await client.post<CheckJob>("readiness/checks/", versions, `check:${Object.values(versions).join(":")}`);
      setNotice(t("insights.check.queued"));
      await refresh();
      if (!isFinished(job)) void track(state.analysis_version, job.id);
    });
  }

  function riskDetail(card: RiskCard) {
    const d = card.details as Record<string, unknown>;
    const count = (key: string) => Array.isArray(d[key]) ? (d[key] as unknown[]).length : 0;
    switch (riskKind(card.kind)) {
      case "repayment_liquidity": return t("insights.riskd.repayment_liquidity", { amount: money(d.gap) });
      case "cashflow_gap": return t("insights.riskd.cashflow_gap", { amount: money(d.amount), date: date(d.date) });
      case "sponsor_delayed": return t("insights.riskd.sponsor_delayed", { count: count("source_ids") });
      case "spending_increased": return t("insights.riskd.spending_increased", { costs: ((d.cost_ids as string[]) ?? []).map(costName).join(", ") });
      case "overdue_obligations": return t("insights.riskd.overdue_obligations", { count: count("event_ids") });
      case "data_stale": return t("insights.riskd.data_stale");
      case "semester_gap": return t("insights.riskd.semester_gap", { amount: money(d.amount) });
      case "liquidity": return t("insights.riskd.liquidity", { amount: money(d.amount), date: date(d.date) });
      case "missing_information": return t("insights.riskd.missing_information", { count: count("issues") });
      default: return "";
    }
  }
  const riskTitle = (card: RiskCard) => riskKind(card.kind) === "unknown" ? t("insights.risk.unknown", { kind: card.kind }) : t(`insights.risk.${card.kind}` as MessageKey);
  const changes = snapshot.briefing?.forecast_changes;
  const changed = changes?.costs ?? [];
  const shown = onlyReview ? txs.filter((item) => item.needs_review) : txs;
  const purchases = txs.filter((item) => Number(item.amount) < 0 && !item.needs_review && !["Transfer", "Refund", "Income"].includes(item.category));
  const activeRisks = snapshot.risks.filter((card) => card.active), resolved = snapshot.risks.filter((card) => !card.active);
  const needReview = txs.filter((item) => item.needs_review).length;

  // Category shares: purchases among the transactions already loaded, in the plan currency only.
  const spending = txs.filter((item) => Number(item.amount) < 0 && !NOT_SPENDING.includes(item.category) && item.currency === currency);
  const spentCents = spending.reduce((sum, item) => sum + cents(item.amount), 0);
  const slices: Slice[] = CATEGORIES.filter((value) => !NOT_SPENDING.includes(value)).map((value) => {
    const total = spending.filter((item) => item.category === value).reduce((sum, item) => sum + cents(item.amount), 0);
    return { key: value, label: categoryName(value), value: total, color: CATEGORY_COLORS[value] ?? "#8f959e", display: money((total / 100).toFixed(2)) };
  }).sort((a, b) => b.value - a.value);

  const riskPage = usePage(activeRisks, 3, pages.risks);
  const recurringPage = usePage(snapshot.recurring, 3, pages.recurring);
  const costPage = usePage(changed, 4, pages.costs);
  const txPage = usePage(shown, 5, pages.txs);
  const rowPage = usePage(rows, 5, pages.rows);
  const importPage = usePage(snapshot.imports, 3, pages.imports);
  const checkPage = usePage(snapshot.checks.slice(0, 10), 5, pages.checks);
  const decidingItem = snapshot.recurring.find((item) => item.id === deciding) ?? null;
  const briefing = snapshot.briefing;
  const firstLoad = loading && !snapshot.state && !briefing && Object.keys(snapshot.errors).length === 0;
  const closeSheet = () => { if (sheet === "revise") setRevision(null); setSheet(null); };
  const sheetError = error && <p className="error" role="alert">{error}</p>;
  const openReview = (item: TransactionImport) => { setReview(item); setSheet("review"); };

  const staleStatus = useToolRefresh(() => { setTxReload((n) => n + 1); return refresh(); });

  const notices = (staleStatus || loading || (error && !sheet) || notice || recalc.phase !== "idle") && <>
    {staleStatus}
    {loading && <div className="activity" role="status"><span className="activity-dot" aria-hidden="true" />{t("common.loading")}</div>}
    {error && !sheet && <div className="stale-banner" role="alert">{error}</div>}
    {notice && <div className="demo" role="status">{notice}</div>}
    {recalc.phase !== "idle" && <p className={`panel-note${recalc.phase === "done" ? "" : " is-warn"}`} role="status">
      {recalc.phase === "waiting" && <span className="activity-dot" aria-hidden="true" />}
      {t(`insights.recalc.${recalc.phase}` as MessageKey, { code: recalc.code ?? "" })}</p>}
  </>;

  const importButton = <button type="button" className="primary" onClick={() => { setError(""); setSheet("import"); }}>{t("insights.p.import")}</button>;
  const toTransactions = (needing: boolean) => { setOnlyReview(needing); setPages((prior) => ({ ...prior, txs: 0 })); setTab("transactions"); };
  const footer = tab === "overview" ? <>
      <button type="button" className="panel-link panel-footer-note" onClick={() => setSheet("checks")}>{t("insights.p.checkHistory")}</button>
      <button type="button" className="secondary" disabled={preview || busy || !snapshot.state} onClick={() => void runCheck()}>{t("insights.check.run")}</button>
      {importButton}</>
    : tab === "categories" ? <>
      <button type="button" className="panel-link panel-footer-note" onClick={() => toTransactions(false)}>{t("insights.p.changeCategory")}</button>{importButton}</>
    : tab === "forecast" ? <>
      {changes?.unresolved_transactions && <button type="button" className="panel-link panel-footer-note" onClick={() => toTransactions(true)}>{t("insights.p.fixUnresolved")}</button>}{importButton}</>
    : <>{txNext && <button type="button" className="panel-link panel-footer-note" onClick={() => void loadTx(txNext, true)}>{t("insights.tx.more")}</button>}{importButton}</>;

  const sheets: Record<Exclude<Sheet, null>, () => ReactNode> = {
    import: () => <PanelSheet title={t("insights.import.title")} onClose={closeSheet}
      footer={<button type="submit" form="insights-upload" className="primary" disabled={preview || busy || !file}>{busy && file ? t("insights.import.uploading") : t("insights.import.upload")}</button>}>
      <div id="insights-import" className="panel-sheet-stack">
        <p className="panel-muted">{t("insights.import.text")}</p>
        {snapshot.errors.state && !signedOut && <p className="error">{snapshot.errors.state} {t("insights.noSemester")}</p>}
        <form id="insights-upload" className="panel-form" onSubmit={(event) => { event.preventDefault(); void upload(); }}>
          <label>{t("insights.import.file")}
            <input ref={fileRef} type="file" accept=".csv,text/csv" disabled={preview || busy} onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
          <label>{t("insights.import.source")}
            <select value={source} disabled={preview || busy} onChange={(event) => setSource(event.target.value as SourceType)}>
              <option value="user_uploaded">{t("insights.import.source.user_uploaded")}</option>
              <option value="synthetic">{t("insights.import.source.synthetic")}</option>
            </select></label>
        </form>
        {sheetError}
        <div className="panel-section-title"><span>{t("insights.history.title")}</span><PanelPager index={importPage.index} count={importPage.pages} onChange={turn("imports")} label={t("insights.history.title")} /></div>
        {snapshot.errors.imports && !signedOut && <p className="error">{snapshot.errors.imports}</p>}
        {snapshot.imports.length === 0 ? <p className="panel-muted">{t("insights.history.none")}</p> : <ul className="panel-rows">
          {importPage.rows.map((item) => <li key={item.id}>
            <span><strong>{when(item.created_at)}</strong>
              <small>{t(`insights.import.source.${item.source_type}` as MessageKey)} · {t("insights.history.rows", { count: item.confirmation.selected_rows?.length ?? item.preview.rows.length })}</small></span>
            <span className={`status-chip status-${item.status === "COMMITTED" ? "ok" : "pending"}`}>{item.status === "COMMITTED" || item.status === "NEEDS_REVIEW" ? t(`insights.status.${item.status}` as MessageKey) : item.status}</span>
            {item.status === "NEEDS_REVIEW" && <button type="button" className="panel-link" onClick={() => openReview(item)}>{t("insights.history.review")}</button>}
          </li>)}
        </ul>}
      </div>
    </PanelSheet>,

    review: () => review && body && <PanelSheet title={t("insights.review.title", { date: when(review.created_at) })} onClose={closeSheet}
      footer={<button type="button" className="primary" disabled={preview || busy || selected.length === 0 || unkept.length > 0 || Object.keys(problems).length > 0} onClick={() => void confirm()}>{t("insights.review.confirm")}</button>}>
      <div className="insights-review panel-sheet-stack">
        <p className="panel-muted">{t("insights.review.source", { source: t(`insights.import.source.${review.source_type}` as MessageKey), rows: rows.length })} <PanelInfo>{t("insights.review.text")}</PanelInfo></p>
        <div className="panel-chips" role="group" aria-label={t("insights.p.reviewParts")}>
          <button type="button" aria-pressed={reviewView === "rows"} onClick={() => setReviewView("rows")}>{t("insights.p.rowsChip", { count: selected.length, total: rows.length })}</button>
          <button type="button" aria-pressed={reviewView === "coverage"} onClick={() => setReviewView("coverage")}>{t("insights.coverage.title")}{Object.keys(problems).length > 0 && " ·  !"}</button></div>
        <div className="panel-sheet-stack" hidden={reviewView !== "rows"}>
        <div className="panel-row">
          <label className="panel-check"><input type="checkbox" aria-label={t("insights.review.selectAll")} disabled={preview} checked={rows.length > 0 && selected.length === rows.length}
            onChange={(event) => setSelected(event.target.checked ? rows.map((row) => row.locator) : [])} />{t("insights.review.selected", { count: selected.length, total: rows.length })}</label>
          <PanelPager index={rowPage.index} count={rowPage.pages} onChange={turn("rows")} label={t("insights.p.rows")} />
        </div>
        <ul className="insights-rows">{rowPage.rows.map((row) => <li key={row.locator} className={row.duplicate || row.suspected_duplicate ? "is-flagged" : undefined}>
          <input type="checkbox" aria-label={t("insights.review.selectRow", { row: row.locator })} disabled={preview} checked={selected.includes(row.locator)} onChange={(event) => setSelected((prior) => toggle(prior, row.locator, event.target.checked))} />
          <span><strong>{row.counterparty}</strong><small>{date(row.date)} · {row.description} · {categoryName(row.classification.category)}</small>
            {(row.duplicate || row.suspected_duplicate || row.classification.category === "Other") && <span className="insights-flags">
              {row.classification.category === "Other" && <span className="panel-tag is-warn">{t("insights.review.needsReview")}</span>}
              {row.duplicate && <span className="status-chip status-used">{t("insights.review.duplicate")}</span>}
              {row.suspected_duplicate && <span className="status-chip status-pending">{t("insights.review.suspected")}</span>}
            </span>}
            {row.suspected_duplicate && <label className="panel-check"><input type="checkbox" aria-label={t("insights.review.keepRow", { row: row.locator })} disabled={preview} checked={kept.includes(row.locator)}
              onChange={(event) => { const on = event.target.checked; setKept((prior) => toggle(prior, row.locator, on)); if (on) setSelected((prior) => toggle(prior, row.locator, true)); }} />{t("insights.review.keep")}</label>}
          </span>
          <span className="insights-amount">{money(row.amount, row.currency)}</span>
        </li>)}</ul>
        {issues.length > 0 && <div className="panel-note is-warn"><strong>{t("insights.review.invalidTitle")}</strong>
          <ul className="insights-issues">{issues.map((issue, n) => <li key={`${issue.locator}-${n}`}><code>{issue.locator ?? "—"}</code> {issue.message}</li>)}</ul></div>}
        {unkept.length > 0 && <p className="panel-note is-warn">{t("insights.review.unkept")}</p>}
        {Object.keys(problems).length > 0 && <p className="panel-note is-warn">{t("insights.p.coverageProblem")} <button type="button" className="panel-link" onClick={() => setReviewView("coverage")}>{t("insights.coverage.title")}</button></p>}
        </div>
        <div className="panel-sheet-stack" hidden={reviewView !== "coverage"}>
        <p className="panel-muted">{t("insights.coverage.text")}</p>
        {body.coverage.length === 0 ? <p className="panel-muted">{t("insights.review.none")}</p> : body.coverage.map((scope) => <fieldset key={scope.account_id} className="panel-fieldset insights-coverage">
          <legend>{t("insights.coverage.account", { account: scope.account_id })}</legend>
          <div className="panel-form">
            <label>{t("insights.coverage.start")}<input type="date" value={scope.start} max={today ?? undefined} disabled={preview} onChange={(event) => editCoverage(scope.account_id, { start: event.target.value })} /></label>
            <label>{t("insights.coverage.end")}<input type="date" value={scope.end} max={today ?? undefined} disabled={preview} onChange={(event) => editCoverage(scope.account_id, { end: event.target.value })} /></label>
          </div>
          <label className="panel-check"><input type="checkbox" checked={scope.complete} disabled={preview} onChange={(event) => editCoverage(scope.account_id, { complete: event.target.checked })} />{t("insights.coverage.complete")}</label>
          {problems[scope.account_id]?.map((code) => <p key={code} className="error">{t(`insights.coverage.${code}` as MessageKey, { date: date(today) })}</p>)}
        </fieldset>)}
        </div>
        {sheetError}
      </div>
    </PanelSheet>,

    revise: () => revision && <PanelSheet title={t("insights.tx.reviseTitle")} onClose={closeSheet}
      footer={<><button type="button" className="secondary" onClick={closeSheet}>{t("insights.tx.cancel")}</button>
        <button type="submit" form="insights-revise" className="primary" disabled={preview || busy || !revision.reason.trim() || (revision.category === "Refund" && !revision.refund_of)}>{t("insights.tx.save")}</button></>}>
      {(() => { const item = txs.find((entry) => entry.id === revision.id); return item && <PanelHero label={`${item.counterparty} · ${date(item.date)}`} value={money(item.amount, item.currency)}>
        {item.description && <span className="panel-muted">{item.description}</span>}</PanelHero>; })()}
      <form id="insights-revise" className="panel-form insights-revise" onSubmit={(event) => { event.preventDefault(); void revise(); }}>
        <label>{t("insights.tx.category")}
          <select value={revision.category} onChange={(event) => setRevision({ ...revision, category: event.target.value as Category })}>
            {CATEGORIES.map((value) => <option key={value} value={value}>{categoryName(value)}</option>)}
          </select></label>
        <label>{t("insights.tx.costLink")}
          <select value={revision.cost_id} onChange={(event) => setRevision({ ...revision, cost_id: event.target.value })}>
            <option value="">{t("insights.tx.noCost")}</option>
            {costs.map((cost) => <option key={cost.cost_id} value={cost.cost_id}>{costName(cost.cost_id)}</option>)}
          </select></label>
        {revision.category === "Refund" && <label className="insights-wide">{t("insights.tx.refundOf")}
          <select value={revision.refund_of} onChange={(event) => setRevision({ ...revision, refund_of: event.target.value })}>
            <option value="">{t("insights.tx.pickPurchase")}</option>
            {purchases.map((item) => <option key={item.id} value={item.id}>{date(item.date)} · {item.counterparty} · {money(item.amount, item.currency)}</option>)}
          </select></label>}
        <label className="insights-wide">{t("insights.tx.reason")}<input value={revision.reason} maxLength={500} required onChange={(event) => setRevision({ ...revision, reason: event.target.value })} /></label>
      </form>
      <p className="panel-muted">{t("insights.tx.text")}</p>
      {sheetError}
    </PanelSheet>,

    checks: () => <PanelSheet title={t("insights.check.title")} onClose={closeSheet}>
      <div id="insights-checks" className="panel-sheet-stack">
        <div className="panel-section-title"><span>{t("insights.check.text")}</span><PanelPager index={checkPage.index} count={checkPage.pages} onChange={turn("checks")} label={t("insights.check.title")} /></div>
        {snapshot.errors.checks && !signedOut && <p className="error">{snapshot.errors.checks}</p>}
        {snapshot.checks.length === 0 ? <PanelEmpty title={t("insights.check.none")} /> : <ul className="panel-rows">{checkPage.rows.map((job) => <li key={job.id}>
          <span><strong>{job.payload?.trigger && KNOWN_TRIGGERS.includes(job.payload.trigger) ? t(`insights.trigger.${job.payload.trigger}` as MessageKey) : job.payload?.trigger ?? job.kind}</strong>
            <small>{t("insights.check.when")} {when(job.created_at)} · {t("insights.check.attempts")} {job.attempts}{job.error_code && <> · <code>{job.error_code}</code></>}</small></span>
          <span className={`status-chip status-${job.status === "DONE" ? "ok" : job.status === "RETRY" ? "failed" : "pending"}`}>{["QUEUED", "RUNNING", "DONE", "RETRY"].includes(job.status) ? t(`insights.check.status.${job.status}` as MessageKey) : job.status}</span>
        </li>)}</ul>}
      </div>
    </PanelSheet>,

    resolved: () => <PanelSheet title={t("insights.risk.resolved", { count: resolved.length })} onClose={closeSheet}>
      <ul className="panel-rows">{resolved.map((card) => <li key={card.id}><span><strong>{riskTitle(card)}</strong><small>{t("insights.risk.updated", { when: when(card.updated_at) })}</small></span>
        <span className="status-chip status-closed">{t("insights.p.resolvedTag")}</span></li>)}</ul>
    </PanelSheet>,

    recurring: () => decidingItem && (() => {
      const item = decidingItem, name = item.result.counterparty ?? item.merchant_key;
      const support = item.result.supporting_transaction_ids?.length ?? 0;
      return <PanelSheet title={name} onClose={closeSheet} footer={<>
        <button type="button" className="secondary" disabled={preview || busy} onClick={() => void decide(item, "ignored")}>{t("insights.rec.ignore")}</button>
        <button type="button" className="primary" disabled={preview || busy} onClick={() => void decide(item, "accepted")}>{t("insights.rec.accept")}</button></>}>
        <PanelHero label={t("insights.rec.amount")} value={money(item.result.amount, item.result.currency ?? currency)}>
          <span className="panel-muted">{categoryName(humanize(item.result.category ?? ""))}</span></PanelHero>
        <PanelFacts items={[[t("insights.rec.next"), date(item.result.expected_next_date)],
          [t("insights.rec.confidence"), support ? t("insights.rec.confidenceInferred", { count: support }) : t("insights.rec.inferredOnly")],
          [t("insights.rec.decision"), ["inferred", "accepted", "ignored"].includes(item.decision) ? t(`insights.rec.decision.${item.decision}` as MessageKey) : item.decision],
          [t("insights.tx.cost"), item.cost_id ? costName(item.cost_id) : "—"]]} />
        {item.result.basis && <p className="panel-muted">{item.result.basis}</p>}
        <label className="panel-form-single">{t("insights.rec.link", { name })}
          <select value={links[item.id] ?? item.cost_id} disabled={preview || busy} onChange={(event) => setLinks({ ...links, [item.id]: event.target.value })}>
            <option value="">{t("insights.tx.noCost")}</option>
            {costs.map((cost) => <option key={cost.cost_id} value={cost.cost_id}>{costName(cost.cost_id)}</option>)}
          </select></label>
        <p className="panel-muted">{t("insights.rec.text")}</p>
        {sheetError}
      </PanelSheet>;
    })(),
  };

  const statusTone = briefing?.status === "SAFE" ? "ok" : briefing?.status === "AT_RISK" ? "failed" : "pending";
  const statusText = briefing ? t(`insights.briefing.${briefing.status}` as MessageKey) : "—";
  const applied = changed.filter((cost) => cost.applied).length;

  return (
    <ServiceShell className="insights-app" eyebrow={t("insights.eyebrow")} title={t("insights.title")} intro={t("insights.intro")}
      sideLabel={t("insights.side.label")} sections={[]} noteTitle={t("insights.side.noteTitle")} noteText={t("insights.side.noteText")}
      preview={preview} previewTitle={t("insights.preview.title")} previewText={t("insights.preview.text")} bannerText={t("insights.banner")}
      signedOut={signedOut} signInUrl={signInUrl} signedOutText={t("insights.signedOut")} onExit={onExit}
      onRefresh={embedded ? undefined : () => { void refresh(); setTxReload((n) => n + 1); }} refreshing={loading || busy}>
      <ToolPanel label={t("insights.p.tabs")} numbered={false} active={tab} onSelect={(key) => { setTab(key); if (sheet !== "review" && sheet !== "import") setSheet(null); }}
        steps={[{ key: "overview", label: t("insights.p.tab.overview") }, { key: "categories", label: t("insights.p.tab.categories") },
          { key: "forecast", label: t("insights.p.tab.forecast") }, { key: "transactions", label: t("insights.p.tab.transactions") }]}
        notices={notices} footer={footer} sheet={sheet && sheets[sheet]()}>

        <div id="insights-overview" className="panel-view" hidden={tab !== "overview"}>
          {firstLoad ? <PanelSkeleton rows={4} /> : <>
            {snapshot.errors.state && !signedOut && <><PanelAlert message={snapshot.errors.state} onRetry={() => void refresh()} /><p className="panel-muted">{t("insights.noSemester")}</p></>}
{review && <div className="panel-note is-warn insights-pending">
      <span>{t("insights.p.pending", { date: when(review.created_at) })}</span>
      <button type="button" className="panel-link" onClick={() => setSheet("review")}>{t("insights.p.reviewNow")}</button></div>}
            <PanelHero label={t("insights.p.status")} value={statusText} tone={briefing && briefing.status !== "SAFE" ? "warn" : undefined}>
              {briefing && <span className="panel-muted">{briefing.earliest_risk_date ? t("insights.briefing.risk", { date: date(briefing.earliest_risk_date) }) : t("insights.p.asOf", { date: date(briefing.as_of) })}</span>}
            </PanelHero>
            {snapshot.errors.briefing && !signedOut && <p className="error">{snapshot.errors.briefing}</p>}
            {txs.length > 0 && <StackBar label={t("insights.p.txMix")} parts={[
              { key: "ok", value: txs.length - needReview, tone: "mint", label: t("insights.p.categorized", { count: txs.length - needReview }) },
              { key: "review", value: needReview, tone: "gold", label: t("insights.p.needsReview", { count: needReview }) }]} />}
            <section id="insights-risks" className="panel-sheet-stack" aria-labelledby="insights-risks-title">
              <div className="panel-section-title"><span id="insights-risks-title">{t("insights.p.risksActive", { count: activeRisks.length })}</span>
                <PanelPager index={riskPage.index} count={riskPage.pages} onChange={turn("risks")} label={t("insights.risk.title")} /></div>
              {snapshot.errors.risks && !signedOut && <p className="error">{snapshot.errors.risks}</p>}
              {activeRisks.length === 0 ? <p className="panel-muted">{t("insights.risk.none")}</p> : <ul className="panel-rows insights-risks">
                {riskPage.rows.map((card) => <li key={card.id} className={`risk-${riskKind(card.kind)}`}><span>
                  <h4>{riskTitle(card)}</h4>
                  {riskDetail(card) && <small>{riskDetail(card)}</small>}
                  <small>{t("insights.risk.updated", { when: when(card.updated_at) })}</small></span></li>)}
              </ul>}
              {resolved.length > 0 && <button type="button" className="panel-link insights-start" onClick={() => setSheet("resolved")}>{t("insights.risk.resolved", { count: resolved.length })}</button>}
            </section>
          </>}
        </div>

        <div id="insights-categories" className="panel-view" hidden={tab !== "categories"}>
          <div className="panel-card-head"><h3>{t("insights.p.donut")}</h3><span className="panel-tag">{t("insights.p.loaded", { count: txs.length })}</span></div>
          {txError && !signedOut && <p className="error">{txError}</p>}
          {category ? <div className="panel-note"><span>{t("insights.p.filtered", { category: categoryName(category) })}</span>{" "}
            <button type="button" className="panel-link" onClick={() => setCategory("")}>{t("insights.tx.all")}</button></div>
            : spentCents === 0 ? <PanelEmpty title={t("insights.p.noSpend")} text={t("insights.tx.text")} />
            : <>
              <PanelHero label={t("insights.p.spent")} value={money((spentCents / 100).toFixed(2))}>
                <span className="panel-muted">{t("insights.p.spentNote", { count: spending.length })}</span></PanelHero>
              <Donut label={t("insights.p.donut")} slices={slices} center={<><strong>{slices.filter((slice) => slice.value > 0).length}</strong>{t("insights.p.categories")}</>} />
            </>}
          <section id="insights-recurring" className="panel-sheet-stack" aria-labelledby="insights-recurring-title">
            <div className="panel-section-title"><span id="insights-recurring-title">{t("insights.rec.title")} <PanelInfo>{t("insights.rec.text")}</PanelInfo></span>
              <PanelPager index={recurringPage.index} count={recurringPage.pages} onChange={turn("recurring")} label={t("insights.rec.title")} /></div>
            {snapshot.errors.recurring && !signedOut && <p className="error">{snapshot.errors.recurring}</p>}
            {snapshot.recurring.length === 0 ? <p className="panel-muted">{t("insights.rec.none")}</p> : <ul className="panel-rows">
              {recurringPage.rows.map((item) => {
                const name = item.result.counterparty ?? item.merchant_key;
                return <li key={item.id}>
                  <span><strong>{name}</strong><small>{t("insights.rec.next")} {date(item.result.expected_next_date)}{item.cost_id ? ` · ${costName(item.cost_id)}` : ""}</small></span>
                  <span className="insights-amount">{money(item.result.amount, item.result.currency ?? currency)}</span>
                  <span className={`status-chip status-${item.decision === "accepted" ? "ok" : item.decision === "ignored" ? "ignored" : "pending"}`}>{["inferred", "accepted", "ignored"].includes(item.decision) ? t(`insights.rec.decision.${item.decision}` as MessageKey) : item.decision}</span>
                  <button type="button" className="secondary insights-small" aria-label={t("insights.p.decideRow", { name })} onClick={() => { setDeciding(item.id); setError(""); setSheet("recurring"); }}>{t("insights.p.decide")}</button>
                </li>;
              })}
            </ul>}
          </section>
        </div>

        <div id="insights-forecast" className="panel-view" hidden={tab !== "forecast"}>
          <div className="panel-card-head"><h3>{t("insights.changes.title")} <PanelInfo>{t("insights.changes.text")}</PanelInfo></h3>
            {briefing && <span className={`status-chip status-${statusTone}`}>{statusText}</span>}</div>
          {snapshot.errors.briefing && !signedOut && <p className="error">{snapshot.errors.briefing}</p>}
          {!changed.length ? <PanelEmpty title={t("insights.changes.none")} text={t("insights.changes.text")} /> : <>
            <PanelHero label={t("insights.p.applied")} value={String(applied)} unit={t("insights.p.ofCosts", { count: changed.length })} />
            <div className="panel-section-title"><span className="insights-legend"><span className="is-planned">{t("insights.p.planned")}</span><span className="is-forecast">{t("insights.p.forecast")}</span></span>
              <PanelPager index={costPage.index} count={costPage.pages} onChange={turn("costs")} label={t("insights.changes.cost")} /></div>
            <ul className="insights-costs" aria-label={t("insights.p.compare")}>{costPage.rows.map((cost) => {
              const planned = Number(cost.original_amount ?? 0), forecast = Number(cost.forecast_amount ?? 0);
              const peak = Math.max(planned, forecast);
              return <li key={cost.cost_id}>
                <div className="insights-cost-head">
                  <strong>{costName(cost.cost_id)}</strong>
                  <span className="insights-amount">{money(cost.original_amount)} → <strong>{money(cost.forecast_amount)}</strong></span>
                </div>
                <div className="insights-cost-bars" aria-hidden="true"><LevelBar value={planned} max={peak} /><LevelBar value={0} after={forecast} max={peak} tone={forecast > planned ? "warn" : undefined} /></div>
                <small>{cost.applied && <span className="status-chip status-ok">{t("insights.changes.applied")}</span>}
                  <span>{["MONTHLY_MEDIAN", "LOCKED_OR_CONTRACTUAL", "INSUFFICIENT_COMPLETE_MONTHS"].includes(cost.reason) ? t(`insights.changes.reason.${cost.reason}` as MessageKey) : cost.reason}</span>
                  <span>· {t("insights.changes.monthsCount", { count: cost.sample_months })}</span></small>
              </li>;
            })}</ul>
            {!!changes?.complete_months?.length && <p className="panel-muted">{t("insights.changes.completeMonths", { months: changes.complete_months.join(", ") })}</p>}
            {changes?.unresolved_transactions && <p className="panel-note is-warn">{t("insights.changes.unresolved")}</p>}
          </>}
        </div>

        <div id="insights-transactions" className="panel-view" hidden={tab !== "transactions"}>
          <div className="panel-row insights-hero-row"><PanelHero label={t("insights.p.txHero")} value={String(txCount)} />
            {needReview > 0 && <button type="button" className="panel-tag is-warn" aria-pressed={onlyReview} onClick={() => { setOnlyReview(!onlyReview); setPages((prior) => ({ ...prior, txs: 0 })); }}>{t("insights.p.needsReview", { count: needReview })}</button>}</div>
          <div className="panel-row insights-filters">
            <label className="insights-filter">{t("insights.tx.filter")}
              <select value={category} onChange={(event) => { setCategory(event.target.value); setPages((prior) => ({ ...prior, txs: 0 })); }}>
                <option value="">{t("insights.tx.all")}</option>
                {CATEGORIES.map((value) => <option key={value} value={value}>{categoryName(value)}</option>)}
              </select></label>
            <label className="panel-check"><input type="checkbox" checked={onlyReview} onChange={(event) => { setOnlyReview(event.target.checked); setPages((prior) => ({ ...prior, txs: 0 })); }} />{t("insights.tx.onlyReview")}</label>
          </div>
          {txError && !signedOut && <p className="error">{txError}</p>}
          {shown.length === 0 ? <p className="panel-muted">{t("insights.tx.none")}</p> : <ul className="panel-rows">{txPage.rows.map((item) => <li key={item.id}>
            <span><strong>{item.counterparty}</strong>
              <small>{date(item.date)} · {categoryName(item.category)}{item.cost_id ? ` · ${costName(item.cost_id)}` : ""}{item.needs_review && <> <span className="panel-tag is-warn insights-tag">{t("insights.review.needsReview")}</span></>}</small></span>
            <span className="insights-amount">{money(item.amount, item.currency)}</span>
            <button type="button" className="secondary insights-small" disabled={preview || busy} aria-label={t("insights.tx.fixRow", { name: item.counterparty, date: date(item.date) })}
              onClick={() => { setError(""); setRevision({ id: item.id, category: item.category, cost_id: item.cost_id, refund_of: item.refund_of ?? "", reason: "" }); setSheet("revise"); }}>{t("insights.tx.fix")}</button>
          </li>)}</ul>}
          <div className="panel-row">
            <span className="panel-muted">{t("insights.tx.loaded", { shown: txs.length, count: txCount })}</span>
            <PanelPager index={txPage.index} count={txPage.pages} onChange={turn("txs")} label={t("insights.tx.title")} />
          </div>
        </div>
      </ToolPanel>
    </ServiceShell>
  );
}
