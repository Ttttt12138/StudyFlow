import { useToolRefresh, useToolActive, useClearWhenHidden, useWorkspace } from "../workspace/context";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ServiceSection, ServiceShell } from "../services/ServiceShell";
import { TierBadge } from "../services/TierBadge";
import { formatDate, formatMoney } from "../backend/presenters";
import { intlLocale, useI18n, type MessageKey } from "../i18n";
import { SessionWalletClient, WalletApiError, type WalletClient } from "../wallet/client";
import { loadInsights, loadTransactions, newest, sha256, transactionsPath } from "./client";
import { confirmBody, coverageProblems, csvError, defaultSelection, humanize, isFinished, nextPath, pollDelays, recalculationJob, riskKind, unkeptSimilar, type CoverageDraft } from "./logic";
import { createInsightsPreview } from "./previewAdapter";
import { CATEGORIES, type Category, type CheckJob, type InsightsSnapshot, type RecurringExpense, type RiskCard, type SourceType, type Transaction, type TransactionImport } from "./types";
import "../wallet/wallet.css";
import "./insights.css";

const signInUrl = `/api/auth/login/?next=${encodeURIComponent(window.location.origin + "/?insights=1")}`;
const initial: InsightsSnapshot = { state: null, clock: null, imports: [], recurring: [], risks: [], checks: [], briefing: null, errors: {} };
const KNOWN_COSTS = ["tuition", "housing", "food", "transport", "communications", "utilities", "insurance", "visa", "deposit", "enrollment", "study_materials", "travel", "dorm_card"];
const KNOWN_TRIGGERS = ["manual", "consumption_changed", "daily", "budget_changed", "state_changed", "context_changed", "scenario_applied", "semester_created"];
type Recalc = { phase: "idle" | "waiting" | "done" | "retry" | "timeout"; code?: string };
type Revision = { id: string; category: Category; cost_id: string; refund_of: string; reason: string };

export function InsightsApp({ preview, onExit }: { preview: boolean; onExit: () => void }) {
  const { lang, t } = useI18n();
  const toolActive = useToolActive();
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
            if (existing) { setReview(existing.status === "NEEDS_REVIEW" ? existing : null); setNotice(t("insights.import.recovered")); return; }
          }
        }
        throw reason;
      }
      if (fileRef.current) fileRef.current.value = "";
      setFile(null);
      await refresh();
      if (item.status !== "NEEDS_REVIEW") { setReview(null); setNotice(t("insights.import.already", { date: when(item.created_at) })); return; }
      setReview(item);
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
      setReview(null);
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
      setRevision(null); setTxReload((n) => n + 1);
      await refresh();
      setNotice(t("insights.tx.saved"));
    });
  }

  async function decide(item: RecurringExpense, decision: "accepted" | "ignored") {
    const cost = decision === "accepted" ? links[item.id] ?? item.cost_id ?? "" : "";
    await perform(async () => {
      await client.post<RecurringExpense>(`readiness/recurring-expenses/${item.id}/review/`, { decision, cost_id: cost }, `recurring:${item.id}`);
      await refresh();
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
  const shown = onlyReview ? txs.filter((item) => item.needs_review) : txs;
  const purchases = txs.filter((item) => Number(item.amount) < 0 && !item.needs_review && !["Transfer", "Refund", "Income"].includes(item.category));
  const activeRisks = snapshot.risks.filter((card) => card.active), resolved = snapshot.risks.filter((card) => !card.active);
  const sections = [
    { id: "insights-import", label: t("insights.import.title") }, { id: "insights-transactions", label: t("insights.tx.title") },
    { id: "insights-recurring", label: t("insights.rec.title") }, { id: "insights-risks", label: t("insights.risk.title") },
    { id: "insights-checks", label: t("insights.check.title") },
  ];

  const staleStatus = useToolRefresh(() => refresh());
  return (
    <ServiceShell className="insights-app" eyebrow={t("insights.eyebrow")} title={t("insights.title")} intro={t("insights.intro")}
      sideLabel={t("insights.side.label")} sections={sections} noteTitle={t("insights.side.noteTitle")} noteText={t("insights.side.noteText")}
      preview={preview} previewTitle={t("insights.preview.title")} previewText={t("insights.preview.text")} bannerText={t("insights.banner")}
      signedOut={signedOut} signInUrl={signInUrl} signedOutText={t("insights.signedOut")} onExit={onExit}
      onRefresh={() => { void refresh(); setTxReload((n) => n + 1); }} refreshing={loading || busy}>
      {staleStatus}
      {loading && <div className="activity" role="status"><span className="activity-dot" aria-hidden="true" />{t("common.loading")}</div>}
      {error && <div className="stale-banner" role="alert">{error}</div>}
      {notice && <div className="demo" role="status">{notice}</div>}

      <ServiceSection id="insights-import" tier={<TierBadge tier="T1" />} title={t("insights.import.title")} text={t("insights.import.text")}>
        {snapshot.errors.state && !signedOut && <p className="error">{snapshot.errors.state} {t("insights.noSemester")}</p>}
        <form className="insights-upload" onSubmit={(event) => { event.preventDefault(); void upload(); }}>
          <label className="service-field">{t("insights.import.file")}
            <input ref={fileRef} type="file" accept=".csv,text/csv" disabled={preview || busy} onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
          <label className="service-field">{t("insights.import.source")}
            <select value={source} disabled={preview || busy} onChange={(event) => setSource(event.target.value as SourceType)}>
              <option value="user_uploaded">{t("insights.import.source.user_uploaded")}</option>
              <option value="synthetic">{t("insights.import.source.synthetic")}</option>
            </select></label>
          <div className="service-actions"><button type="submit" className="primary" disabled={preview || busy || !file}>{busy && file ? t("insights.import.uploading") : t("insights.import.upload")}</button></div>
        </form>

        {review && body && <div className="insights-review" aria-labelledby="insights-review-title">
          <h3 id="insights-review-title">{t("insights.review.title", { date: when(review.created_at) })}</h3>
          <p className="service-muted">{t("insights.review.source", { source: t(`insights.import.source.${review.source_type}` as MessageKey), rows: rows.length })} · {t("insights.review.text")}</p>
          <div className="table-scroll"><table className="service-table">
            <thead><tr>
              <th><label className="insights-check"><input type="checkbox" aria-label={t("insights.review.selectAll")} disabled={preview} checked={rows.length > 0 && selected.length === rows.length}
                onChange={(event) => setSelected(event.target.checked ? rows.map((row) => row.locator) : [])} />{t("insights.review.select")}</label></th>
              <th>{t("insights.review.date")}</th><th>{t("insights.review.account")}</th><th>{t("insights.review.counterparty")}</th><th>{t("insights.review.description")}</th>
              <th>{t("insights.review.amount")}</th><th>{t("insights.review.category")}</th><th>{t("insights.review.flags")}</th>
            </tr></thead>
            <tbody>{rows.map((row) => <tr key={row.locator} className={row.duplicate || row.suspected_duplicate ? "insights-flagged" : undefined}>
              <td><input type="checkbox" aria-label={t("insights.review.selectRow", { row: row.locator })} disabled={preview} checked={selected.includes(row.locator)} onChange={(event) => setSelected((prior) => toggle(prior, row.locator, event.target.checked))} /></td>
              <td>{date(row.date)}</td><td>{row.account_id}</td><td>{row.counterparty}</td><td>{row.description}</td>
              <td className="insights-amount">{money(row.amount, row.currency)}</td>
              <td>{categoryName(row.classification.category)}{row.classification.category === "Other" && <small>{t("insights.review.needsReview")}</small>}</td>
              <td>
                {row.duplicate && <span className="status-chip status-used">{t("insights.review.duplicate")}</span>}
                {row.suspected_duplicate && <><span className="status-chip status-pending">{t("insights.review.suspected")}</span>
                  <label className="insights-check"><input type="checkbox" aria-label={t("insights.review.keepRow", { row: row.locator })} disabled={preview} checked={kept.includes(row.locator)}
                    onChange={(event) => { const on = event.target.checked; setKept((prior) => toggle(prior, row.locator, on)); if (on) setSelected((prior) => toggle(prior, row.locator, true)); }} />{t("insights.review.keep")}</label></>}
              </td>
            </tr>)}</tbody>
          </table></div>
          <p className="service-muted">{t("insights.review.selected", { count: selected.length, total: rows.length })}</p>
          {issues.length > 0 && <div className="service-alert insights-issues"><strong>{t("insights.review.invalidTitle")}</strong>
            <ul>{issues.map((issue, n) => <li key={`${issue.locator}-${n}`}><code>{issue.locator ?? "—"}</code> {issue.message}</li>)}</ul></div>}
          {unkept.length > 0 && <p className="service-alert">{t("insights.review.unkept")}</p>}

          <h3>{t("insights.coverage.title")}</h3>
          <p className="service-muted">{t("insights.coverage.text")}</p>
          {body.coverage.length === 0 ? <p className="service-muted">{t("insights.review.none")}</p> : body.coverage.map((scope) => <fieldset key={scope.account_id} className="insights-coverage">
            <legend>{t("insights.coverage.account", { account: scope.account_id })}</legend>
            <div className="insights-dates">
              <label className="service-field">{t("insights.coverage.start")}<input type="date" value={scope.start} max={today ?? undefined} disabled={preview} onChange={(event) => editCoverage(scope.account_id, { start: event.target.value })} /></label>
              <label className="service-field">{t("insights.coverage.end")}<input type="date" value={scope.end} max={today ?? undefined} disabled={preview} onChange={(event) => editCoverage(scope.account_id, { end: event.target.value })} /></label>
            </div>
            <label className="wallet-confirm"><input type="checkbox" checked={scope.complete} disabled={preview} onChange={(event) => editCoverage(scope.account_id, { complete: event.target.checked })} />{t("insights.coverage.complete")}</label>
            {problems[scope.account_id]?.map((code) => <p key={code} className="error">{t(`insights.coverage.${code}` as MessageKey, { date: date(today) })}</p>)}
          </fieldset>)}
          <div className="service-actions">
            <button className="primary" disabled={preview || busy || selected.length === 0 || unkept.length > 0 || Object.keys(problems).length > 0} onClick={() => void confirm()}>{t("insights.review.confirm")}</button>
          </div>
        </div>}

        {recalc.phase !== "idle" && <p className={recalc.phase === "done" ? "service-notice" : "service-alert"} role="status">
          {recalc.phase === "waiting" && <span className="activity-dot" aria-hidden="true" />}
          {t(`insights.recalc.${recalc.phase}` as MessageKey, { code: recalc.code ?? "" })}</p>}

        <h3>{t("insights.changes.title")}</h3>
        {snapshot.errors.briefing && !signedOut && <p className="error">{snapshot.errors.briefing}</p>}
        {snapshot.briefing && <p className="insights-briefing">{t("insights.briefing.status")} <span className={`status-chip status-${snapshot.briefing.status === "SAFE" ? "ok" : snapshot.briefing.status === "AT_RISK" ? "failed" : "pending"}`}>{t(`insights.briefing.${snapshot.briefing.status}` as MessageKey)}</span>
          {snapshot.briefing.earliest_risk_date && <span className="service-muted"> · {t("insights.briefing.risk", { date: date(snapshot.briefing.earliest_risk_date) })}</span>}</p>}
        <p className="service-muted">{t("insights.changes.text")}</p>
        {!changes?.costs?.length ? <p>{t("insights.changes.none")}</p> : <>
          <div className="table-scroll"><table className="service-table insights-changes">
            <thead><tr><th>{t("insights.changes.cost")}</th><th>{t("insights.changes.amounts")}</th><th>{t("insights.changes.result")}</th><th>{t("insights.changes.months")}</th></tr></thead>
            <tbody>{changes.costs.map((cost) => <tr key={cost.cost_id}>
              <td><strong>{costName(cost.cost_id)}</strong></td>
              <td>{money(cost.original_amount)} → <strong>{money(cost.forecast_amount)}</strong></td>
              <td>{cost.applied && <span className="status-chip status-ok">{t("insights.changes.applied")}</span>}
                <small>{["MONTHLY_MEDIAN", "LOCKED_OR_CONTRACTUAL", "INSUFFICIENT_COMPLETE_MONTHS"].includes(cost.reason) ? t(`insights.changes.reason.${cost.reason}` as MessageKey) : cost.reason}</small></td>
              <td>{t("insights.changes.monthsCount", { count: cost.sample_months })}</td>
            </tr>)}</tbody>
          </table></div>
          {!!changes.complete_months?.length && <p className="service-muted">{t("insights.changes.completeMonths", { months: changes.complete_months.join(", ") })}</p>}
          {changes.unresolved_transactions && <p className="service-alert">{t("insights.changes.unresolved")}</p>}
        </>}

        <h3>{t("insights.history.title")}</h3>
        {snapshot.errors.imports && !signedOut && <p className="error">{snapshot.errors.imports}</p>}
        {snapshot.imports.length === 0 ? <p className="service-muted">{t("insights.history.none")}</p> : <ul className="service-list">
          {snapshot.imports.map((item) => <li key={item.id}>
            <span><strong>{when(item.created_at)}</strong> · {t(`insights.import.source.${item.source_type}` as MessageKey)} · {t("insights.history.rows", { count: item.confirmation.selected_rows?.length ?? item.preview.rows.length })}{" "}
              <span className={`status-chip status-${item.status === "COMMITTED" ? "ok" : "pending"}`}>{item.status === "COMMITTED" || item.status === "NEEDS_REVIEW" ? t(`insights.status.${item.status}` as MessageKey) : item.status}</span></span>
            {item.status === "NEEDS_REVIEW" && review?.id !== item.id && <button className="link-button" onClick={() => setReview(item)}>{t("insights.history.review")}</button>}
          </li>)}
        </ul>}
      </ServiceSection>

      <ServiceSection id="insights-transactions" tier={<TierBadge tier="T1" />} title={t("insights.tx.title")} text={t("insights.tx.text")}>
        <div className="insights-filters">
          <label className="service-inline-field">{t("insights.tx.filter")}
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="">{t("insights.tx.all")}</option>
              {CATEGORIES.map((value) => <option key={value} value={value}>{categoryName(value)}</option>)}
            </select></label>
          <label className="insights-check"><input type="checkbox" checked={onlyReview} onChange={(event) => setOnlyReview(event.target.checked)} />{t("insights.tx.onlyReview")}</label>
        </div>
        {txError && !signedOut && <p className="error">{txError}</p>}
        {shown.length === 0 ? <p>{t("insights.tx.none")}</p> : <div className="table-scroll"><table className="service-table">
          <thead><tr><th>{t("insights.review.date")}</th><th>{t("insights.review.counterparty")}</th><th>{t("insights.review.amount")}</th><th>{t("insights.tx.category")}</th><th>{t("insights.tx.cost")}</th><th /></tr></thead>
          <tbody>{shown.map((item) => <tr key={item.id}>
            <td>{date(item.date)}</td>
            <td>{item.counterparty}<small>{item.description}</small></td>
            <td className="insights-amount">{money(item.amount, item.currency)}</td>
            <td>{categoryName(item.category)}{item.needs_review && <small><span className="status-chip status-pending">{t("insights.review.needsReview")}</span></small>}</td>
            <td>{item.cost_id ? costName(item.cost_id) : "—"}</td>
            <td><button className="secondary insights-small" disabled={preview || busy} aria-label={t("insights.tx.fixRow", { name: item.counterparty, date: date(item.date) })}
              onClick={() => setRevision({ id: item.id, category: item.category, cost_id: item.cost_id, refund_of: item.refund_of ?? "", reason: "" })}>{t("insights.tx.fix")}</button></td>
          </tr>)}</tbody>
        </table></div>}
        <div className="service-actions">
          <span className="service-muted">{t("insights.tx.loaded", { shown: txs.length, count: txCount })}</span>
          {txNext && <button className="secondary" onClick={() => void loadTx(txNext, true)}>{t("insights.tx.more")}</button>}
        </div>
        {revision && <form className="service-policy" aria-labelledby="insights-revise-title" onSubmit={(event) => { event.preventDefault(); void revise(); }}>
          <h4 id="insights-revise-title"><TierBadge tier="T1" /> {t("insights.tx.reviseTitle")}</h4>
          <label className="service-field">{t("insights.tx.category")}
            <select value={revision.category} onChange={(event) => setRevision({ ...revision, category: event.target.value as Category })}>
              {CATEGORIES.map((value) => <option key={value} value={value}>{categoryName(value)}</option>)}
            </select></label>
          <label className="service-field">{t("insights.tx.costLink")}
            <select value={revision.cost_id} onChange={(event) => setRevision({ ...revision, cost_id: event.target.value })}>
              <option value="">{t("insights.tx.noCost")}</option>
              {costs.map((cost) => <option key={cost.cost_id} value={cost.cost_id}>{costName(cost.cost_id)}</option>)}
            </select></label>
          {revision.category === "Refund" && <label className="service-field">{t("insights.tx.refundOf")}
            <select value={revision.refund_of} onChange={(event) => setRevision({ ...revision, refund_of: event.target.value })}>
              <option value="">{t("insights.tx.pickPurchase")}</option>
              {purchases.map((item) => <option key={item.id} value={item.id}>{date(item.date)} · {item.counterparty} · {money(item.amount, item.currency)}</option>)}
            </select></label>}
          <label className="service-field">{t("insights.tx.reason")}<input value={revision.reason} maxLength={500} required onChange={(event) => setRevision({ ...revision, reason: event.target.value })} /></label>
          <div className="service-actions">
            <button type="submit" className="primary" disabled={preview || busy || !revision.reason.trim() || (revision.category === "Refund" && !revision.refund_of)}>{t("insights.tx.save")}</button>
            <button type="button" className="secondary" onClick={() => setRevision(null)}>{t("insights.tx.cancel")}</button>
          </div>
        </form>}
      </ServiceSection>

      <ServiceSection id="insights-recurring" tier={<TierBadge tier="T1" />} title={t("insights.rec.title")} text={t("insights.rec.text")}>
        {snapshot.errors.recurring && !signedOut && <p className="error">{snapshot.errors.recurring}</p>}
        {snapshot.recurring.length === 0 ? <p>{t("insights.rec.none")}</p> : <div className="table-scroll"><table className="service-table">
          <thead><tr><th>{t("insights.review.counterparty")}</th><th>{t("insights.rec.amount")}</th><th>{t("insights.rec.next")}</th><th>{t("insights.rec.confidence")}</th><th>{t("insights.rec.decision")}</th></tr></thead>
          <tbody>{snapshot.recurring.map((item) => {
            const name = item.result.counterparty ?? item.merchant_key;
            const support = item.result.supporting_transaction_ids?.length ?? 0;
            return <tr key={item.id}>
              <td><strong>{name}</strong><small>{categoryName(humanize(item.result.category ?? ""))}</small></td>
              <td>{money(item.result.amount, item.result.currency ?? currency)}</td>
              <td>{date(item.result.expected_next_date)}</td>
              <td>{support ? t("insights.rec.confidenceInferred", { count: support }) : t("insights.rec.inferredOnly")}{item.result.basis && <small>{item.result.basis}</small>}</td>
              <td>
                <span className={`status-chip status-${item.decision === "accepted" ? "ok" : item.decision === "ignored" ? "used" : "pending"}`}>{["inferred", "accepted", "ignored"].includes(item.decision) ? t(`insights.rec.decision.${item.decision}` as MessageKey) : item.decision}</span>
                {item.cost_id && <small>{costName(item.cost_id)}</small>}
                <div className="insights-decide">
                  <select aria-label={t("insights.rec.link", { name })} value={links[item.id] ?? item.cost_id} disabled={preview || busy} onChange={(event) => setLinks({ ...links, [item.id]: event.target.value })}>
                    <option value="">{t("insights.tx.noCost")}</option>
                    {costs.map((cost) => <option key={cost.cost_id} value={cost.cost_id}>{costName(cost.cost_id)}</option>)}
                  </select>
                  <button className="secondary insights-small" disabled={preview || busy} onClick={() => void decide(item, "accepted")}>{t("insights.rec.accept")}</button>
                  <button className="secondary insights-small" disabled={preview || busy} onClick={() => void decide(item, "ignored")}>{t("insights.rec.ignore")}</button>
                </div>
              </td>
            </tr>;
          })}</tbody>
        </table></div>}
      </ServiceSection>

      <ServiceSection id="insights-risks" tier={<TierBadge tier="T0" />} title={t("insights.risk.title")} text={t("insights.risk.text")}>
        {snapshot.errors.risks && !signedOut && <p className="error">{snapshot.errors.risks}</p>}
        {activeRisks.length === 0 ? <p>{t("insights.risk.none")}</p> : <div className="insights-risks">
          {activeRisks.map((card) => <article key={card.id} className={`insights-risk risk-${riskKind(card.kind)}`}>
            <h3>{riskTitle(card)}</h3>
            {riskDetail(card) && <p>{riskDetail(card)}</p>}
            <small className="service-muted">{t("insights.risk.updated", { when: when(card.updated_at) })}</small>
          </article>)}
        </div>}
        {resolved.length > 0 && <details className="insights-resolved"><summary>{t("insights.risk.resolved", { count: resolved.length })}</summary>
          <ul className="service-list">{resolved.map((card) => <li key={card.id}><span>{riskTitle(card)}</span><small className="service-muted">{t("insights.risk.updated", { when: when(card.updated_at) })}</small></li>)}</ul>
        </details>}
      </ServiceSection>

      <ServiceSection id="insights-checks" tier={<TierBadge tier="T1" />} title={t("insights.check.title")} text={t("insights.check.text")}>
        <div className="service-actions"><button className="primary" disabled={preview || busy || !snapshot.state} onClick={() => void runCheck()}>{t("insights.check.run")}</button></div>
        {snapshot.errors.checks && !signedOut && <p className="error">{snapshot.errors.checks}</p>}
        {snapshot.checks.length === 0 ? <p className="service-muted">{t("insights.check.none")}</p> : <div className="table-scroll"><table className="service-table">
          <thead><tr><th>{t("insights.check.when")}</th><th>{t("insights.check.trigger")}</th><th>{t("insights.check.status")}</th><th>{t("insights.check.attempts")}</th></tr></thead>
          <tbody>{snapshot.checks.slice(0, 10).map((job) => <tr key={job.id}>
            <td>{when(job.created_at)}</td>
            <td>{job.payload?.trigger && KNOWN_TRIGGERS.includes(job.payload.trigger) ? t(`insights.trigger.${job.payload.trigger}` as MessageKey) : job.payload?.trigger ?? job.kind}</td>
            <td><span className={`status-chip status-${job.status === "DONE" ? "ok" : job.status === "RETRY" ? "failed" : "pending"}`}>{["QUEUED", "RUNNING", "DONE", "RETRY"].includes(job.status) ? t(`insights.check.status.${job.status}` as MessageKey) : job.status}</span>
              {job.error_code && <small><code>{job.error_code}</code></small>}</td>
            <td>{job.attempts}</td>
          </tr>)}</tbody>
        </table></div>}
      </ServiceSection>
    </ServiceShell>
  );
}
