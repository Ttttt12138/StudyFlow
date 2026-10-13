import { useEmbedded, useToolRefresh } from "../workspace/context";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ServiceShell } from "../services/ServiceShell";
import { PanelAlert, PanelEmpty, PanelFacts, PanelHero, PanelInfo, PanelPager, PanelSheet, PanelSkeleton, ToolPanel } from "../workspace/ToolPanel";
import { BarCompare, LevelBar, StackBar, StepTrack } from "../workspace/PanelCharts";
import { formatDate, formatMoney } from "../backend/presenters";
import { fractionToPercent } from "../loans/logic";
import { intlLocale, useI18n, type MessageKey } from "../i18n";
import { SessionWalletClient, WalletApiError, type WalletClient } from "../wallet/client";
import { loadCopilot } from "./client";
import { buildWhatIf, conditionLabel, costChange, defaultDate, deltaTone, emptyLoan, issueText, MAX_COSTS, MAX_SCENARIOS, MAX_SUPPORT,
  rerunScenarios, toMoney, tone, type FormError, type ScenarioForm } from "./logic";
import { createCopilotPreview, previewApplyPreview, previewReview, previewRun, previewTrace } from "./previewAdapter";
import type { ApplyPreview, ApplyResult, Cost, CopilotSnapshot, DeltaKey, DiffEntry, Explanation, Layer, Month, Notification, ReviewHistory, ReviewItem,
  ScenarioInput, ScenarioResult, WhatIfRun } from "./types";
import "../wallet/wallet.css";
import "./copilot.css";

const signInUrl = `/auth?next=${encodeURIComponent(window.location.origin + "/?copilot=1")}`;
const initial: CopilotSnapshot = { state: null, reviews: [], notifications: [], errors: {} };
const lost = (reason: unknown) => reason instanceof WalletApiError && (reason.status === 0 || reason.status >= 500);
const KNOWN_COSTS = ["tuition", "housing", "food", "transport", "communications", "utilities", "insurance", "visa", "deposit", "enrollment", "study_materials", "travel", "dorm_card"];
const REVIEW_KINDS = ["protected_cost", "material", "loan", "beneficiary", "payment", "remittance", "model_failure"];
const LAYERS = ["jev", "llm", "deterministic", "policy"] as const;
const DENIAL_CODES = ["CONFIRMATION_INVALID_OR_EXPIRED", "CONFIRMATION_MISMATCH", "SCENARIO_ALREADY_APPLIED", "REVIEW_REQUIRED", "SEMESTER_NOT_ACTIVE",
  "COST_OVERRIDE_REQUIRES_THB_BASELINE", "SETTLED_COST_IS_IMMUTABLE", "INVALID_LOAN_DATES", "REPLACEMENT_EVIDENCE_REQUIRED"];
const OPEN_REVIEW = ["OPEN", "IN_PROGRESS", "WAITING_INFORMATION"];
const AFFORD_RANK: Record<string, number> = { AFFORDABLE: 0, INSUFFICIENT_DATA: 1, UNAFFORDABLE: 2 };
const ROWS_PER_PAGE = 2;
const humanize = (text: string) => text ? text.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : "—";
const slice = <T,>(rows: T[], size: number, page: number) => {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const index = Math.min(Math.max(page, 0), pages - 1);
  return { rows: rows.slice(index * size, index * size + size), index, pages, offset: index * size };
};
let serial = 0;
const key = () => `k${++serial}`;
const newForm = (name = ""): ScenarioForm => ({ key: key(), name, costs: [], support: [], allowLoan: true, loan: emptyLoan() });
const runParam = () => new URLSearchParams(window.location.search).get("run");
function rememberRun(id: string | null) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("run", id); else url.searchParams.delete("run");
  window.history.replaceState(window.history.state, "", url);
}
// The preview shows the two sample scenarios as filled-in (disabled) forms.
const previewForms = (): ScenarioForm[] => [
  { ...newForm("Parents add THB 20,000; tuition instalment"), costs: [{ key: key(), cost_id: "tuition", amount: "42000.00", effective_on: "2026-11-15" }],
    support: [{ key: key(), source_id: "", amount: "20000.00", available_on: "2026-11-25" }] },
  { ...newForm("Borrow THB 30,000 over 12 months"), loan: { principal: "30000.00", rate: "5", fees: "600.00", months: "12", first_due_date: "2027-01-15", available_on: "2026-11-25" } },
];

type Tab = "build" | "compare" | "detail" | "apply" | "follow";
type Part = "costs" | "support" | "loan";
type Sheet = "measures" | "loan" | "issues" | "why" | "diff" | "history" | null;
type BarMetric = "maximum_reserve_gap" | "loan_needed" | "remaining_expenses";
type MetricRow = { id: string; k?: keyof ScenarioResult; label: string; kind: "money" | "date" | "bool" | "afford"; delta?: DeltaKey; better?: "higher" };
const partFor = (code: string): Part | null => code.startsWith("cost") || code === "tooManyCosts" ? "costs"
  : code.startsWith("support") || code === "tooManySupport" ? "support" : code.startsWith("loan") ? "loan" : null;

/** Which of two results is weaker on one measure, from the values Django returned (no arithmetic on money). */
function weaker(row: MetricRow, a: ScenarioResult, b: ScenarioResult): "a" | "b" | null {
  if (row.kind === "afford") {
    const rank = (s: ScenarioResult) => s.loan?.affordability ? AFFORD_RANK[s.loan.affordability.status] ?? null : null;
    const x = rank(a), y = rank(b);
    return x === null || y === null || x === y ? null : x > y ? "a" : "b";
  }
  const x = a[row.k!], y = b[row.k!];
  if (row.kind === "money") {
    const p = Number(x), q = Number(y);
    if (!Number.isFinite(p) || !Number.isFinite(q) || p === q) return null;
    return (row.better === "higher" ? p < q : p > q) ? "a" : "b";
  }
  // A date that never comes is best; otherwise the earlier one is weaker.
  if (row.kind === "date") return x === y ? null : !x ? "b" : !y ? "a" : String(x) < String(y) ? "a" : "b";
  return !!x === !!y ? null : x ? "b" : "a";
}

/** Ending and lowest balance per month on one scale that includes zero. */
function BalanceChart({ months, label, legend, describe }: { months: Month[]; label: string; legend: { ending: string; minimum: string; zero: string }; describe: (m: Month) => string }) {
  const ending = months.map((m) => Number(m.ending_balance) || 0), minimum = months.map((m) => Number(m.minimum_balance) || 0);
  const all = [...ending, ...minimum, 0];
  const lo = Math.min(...all), hi = Math.max(...all), span = hi - lo || 1;
  const step = months.length > 1 ? 100 / (months.length - 1) : 0;
  const y = (v: number) => (2 + (hi - v) / span * 36).toFixed(2);
  const line = (values: number[]) => values.map((v, i) => `${(i * step).toFixed(2)},${y(v)}`).join(" ");
  return <figure className="copilot-chart">
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label={label}>
      {lo < 0 && <line className="is-zero" x1="0" x2="100" y1={y(0)} y2={y(0)} />}
      <polyline className="is-minimum" points={line(minimum)} />
      <polyline className="is-ending" points={line(ending)} />
    </svg>
    <figcaption>
      <span className="chart-axis"><span>{months[0].month}</span><span>{months[months.length - 1].month}</span></span>
      <span className="chart-legend is-inline"><span className="is-mint">{legend.ending}</span><span className="is-muted">{legend.minimum}</span>{lo < 0 && <span className="is-red">{legend.zero}</span>}</span>
      <ul className="copilot-sr">{months.map((m) => <li key={m.month}>{describe(m)}</li>)}</ul>
    </figcaption>
  </figure>;
}

export function CopilotApp({ preview, onExit }: { preview: boolean; onExit: () => void }) {
  const { lang, t } = useI18n();
  const embedded = useEmbedded();
  const client = useMemo<WalletClient>(() => preview ? createCopilotPreview() : new SessionWalletClient(), [preview]);
  const [snapshot, setSnapshot] = useState<CopilotSnapshot>(initial);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [denied, setDenied] = useState(false);
  const [notice, setNotice] = useState("");
  const [forms, setForms] = useState<ScenarioForm[]>(() => preview ? previewForms() : [newForm()]);
  const [formErrors, setFormErrors] = useState<(FormError & { scenario: number })[]>([]);
  const [run, setRun] = useState<WhatIfRun | null>(null);
  const [plan, setPlan] = useState<ApplyPreview | null>(null);
  const [planCheck, setPlanCheck] = useState(false);
  const [applied, setApplied] = useState<ApplyResult | null>(null);
  const [traceInput, setTraceInput] = useState("");
  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [traceError, setTraceError] = useState("");
  const [histories, setHistories] = useState<Record<string, ReviewHistory[]>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  // Layout only: which tab, scenario, part, page and sheet are on screen.
  const [tab, setTab] = useState<Tab | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [active, setActive] = useState(0);
  const [part, setPart] = useState<Part>("costs");
  const [rowPage, setRowPage] = useState(0);
  const [pair, setPair] = useState<[number, number] | null>(null);
  const [barMetric, setBarMetric] = useState<BarMetric>("maximum_reserve_gap");
  const [detail, setDetail] = useState<number | null>(null);
  const [followView, setFollowView] = useState<"review" | "notif">("review");
  const [reviewIndex, setReviewIndex] = useState(0);
  const [notifPage, setNotifPage] = useState(0);
  const [layerPick, setLayerPick] = useState<(typeof LAYERS)[number] | null>(null);

  const money = (value: unknown) => formatMoney(value, "THB", lang);
  const date = (value: unknown) => value ? formatDate(value, lang) : t("copilot.never");
  const when = (value: string) => new Date(value).toLocaleString(intlLocale(lang), { dateStyle: "medium", timeStyle: "short" });
  const message = (reason: unknown) => reason instanceof Error ? reason.message : t("shell.err.generic");
  const signedOut = !preview && /^HTTP (401|403):/.test(snapshot.errors.state ?? "") && !snapshot.state;
  const state = snapshot.state;
  const costs = state?.estimated_expenses ?? [];
  const editable = costs.filter((c) => !c.paid && c.applicability !== "NOT_APPLICABLE");
  const sources = (state?.expected_income ?? []).filter((s) => ["family", "family_support"].includes(s.kind) && !s.received && !s.already_in_opening);
  const today = defaultDate(state?.assets?.balance_as_of);
  const costName = (id: string) => {
    if (KNOWN_COSTS.includes(id)) return t(`copilot.cost.${id}` as MessageKey);
    const cost = costs.find((c) => c.cost_id === id);
    return cost?.label || humanize(cost?.category || id);
  };
  const costAmount = (cost: Cost | undefined) => {
    if (!cost) return "—";
    const base = cost.amount ? money(cost.amount) : cost.lower && cost.upper ? `${money(cost.lower)} – ${money(cost.upper)}` : t("copilot.cost.missing");
    return cost.period === "monthly" ? t("copilot.cost.monthly", { amount: base }) : base;
  };
  const isProtected = (cost: Cost | undefined) => !!cost && (!!cost.locked || !!cost.conflict || cost.confidence_type === "VERIFIED");

  const refresh = useCallback(async (api = client) => {
    setLoading(true);
    const result = await loadCopilot(api);
    setSnapshot(result);
    setLoading(false);
    return result;
  }, [client]);

  const showRun = useCallback((next: WhatIfRun | null) => {
    setRun(next); setPlan(null); setPlanCheck(false); setPair(null); setDetail(null);
    setApplied(next && next.applied_index !== null && "status" in next.application ? next.application as ApplyResult : null);
    if (!preview) rememberRun(next?.id ?? null);
  }, [preview]);

  useEffect(() => {
    setError(""); setNotice("");
    void refresh().catch((reason: unknown) => { setError(message(reason)); setLoading(false); });
    if (preview) {
      setRun(previewRun); setPlan(previewApplyPreview); setExplanation(previewTrace); setTraceInput(previewTrace.trace_id);
      void client.get<ReviewItem & { history: ReviewHistory[] }>(`review-queue/${previewReview.id}/`)
        .then((item) => setHistories({ [item.id]: item.history }));
      return;
    }
    // A refresh keeps the last comparison: its id is in ?run=, and Django recomputes whether it is stale.
    const saved = runParam();
    if (saved) void client.get<WhatIfRun>(`readiness/what-if/${encodeURIComponent(saved)}/`).then(showRun).catch(() => rememberRun(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh]);

  async function reloadRun(id: string) {
    const next = await client.get<WhatIfRun>(`readiness/what-if/${id}/`);
    setRun(next);
    return next;
  }

  async function perform(action: () => Promise<void>) {
    if (preview) return;
    setBusy(true); setError(""); setNotice(""); setDenied(false);
    try { await action(); }
    catch (reason) {
      if (reason instanceof WalletApiError && reason.status === 409) {
        await refresh().catch(() => {});
        if (run) await reloadRun(run.id).catch(() => {});
        setPlan(null); setPlanCheck(false);
        setError(t("shell.err.changed"));
      } else if (reason instanceof WalletApiError && DENIAL_CODES.includes(reason.code)) {
        if (["CONFIRMATION_INVALID_OR_EXPIRED", "CONFIRMATION_MISMATCH", "REVIEW_REQUIRED"].includes(reason.code)) { setPlan(null); setPlanCheck(false); }
        setError(`${reason.message} ${t(`copilot.err.${reason.code}` as MessageKey)}`); setDenied(true);
      } else {
        setError(message(reason));
        setDenied(reason instanceof WalletApiError && reason.status >= 400 && reason.status < 500);
      }
    } finally { setBusy(false); }
  }

  function editForm(index: number, patch: Partial<ScenarioForm>) { setForms((prior) => prior.map((f, i) => i === index ? { ...f, ...patch } : f)); }
  function pickScenario(index: number) { setActive(index); setRowPage(0); }
  function pickPart(next: Part) { setPart(next); setRowPage(0); }
  /** Bring the first scenario with a problem (and the part it is in) on screen. */
  function showProblems(errors: (FormError & { scenario: number })[]) {
    const first = errors[0];
    if (!first) return;
    setActive(first.scenario); setRowPage(0);
    const target = partFor(first.code);
    if (target) setPart(target);
  }

  async function submit(scenarios: ScenarioInput[] | null) {
    const fresh = (await refresh()).state;
    if (!fresh) { setError(snapshot.errors.state ?? t("copilot.err.noState")); return; }
    let body: object;
    if (scenarios) body = { semester_id: fresh.semester_id, state_version: fresh.state_version, budget_version: fresh.budget_version, analysis_version: fresh.analysis_version, scenarios };
    else {
      const built = buildWhatIf(fresh, forms);
      setFormErrors(built.errors);
      if (!built.body) { showProblems(built.errors); setError(t("copilot.err.form")); return; }
      body = built.body;
    }
    let result: WhatIfRun;
    try { result = await client.post<WhatIfRun>("readiness/what-if/", body, "whatif"); }
    catch (reason) {
      // There is no list route to look for a stored run; retrying sends the same Idempotency-Key.
      if (lost(reason)) { setError(t("shell.err.lost")); return; }
      throw reason;
    }
    showRun(result);
    setTab("compare"); setSheet(null);
    setNotice(t("copilot.notice.compared"));
  }

  async function compare() {
    if (!state) return;
    const local = buildWhatIf(state, forms);
    setFormErrors(local.errors);
    if (!local.body) { showProblems(local.errors); setError(t("copilot.err.form")); return; }
    await perform(() => submit(null));
  }

  async function rerun() {
    if (!run) return;
    const saved = rerunScenarios(run.scenarios.map((s) => s.assumptions));
    await perform(() => submit(saved.length === run.scenarios.length ? saved : null));
  }

  async function previewApply(index: number) {
    if (!run) return;
    await perform(async () => {
      const result = await client.post<ApplyPreview>(`readiness/what-if/${run.id}/apply-preview/`, { scenario_index: index }, `whatif-preview:${run.id}:${index}`);
      setPlan(result); setPlanCheck(false); setApplied(null); setTab("apply"); setSheet(null);
      if (result.blockers.length) await refresh();
    });
  }

  async function apply() {
    if (!run || !plan?.confirmation) return;
    const confirmation = plan.confirmation;
    await perform(async () => {
      let result: ApplyResult;
      try { result = await client.post<ApplyResult>(`readiness/what-if/${run.id}/apply/`, { confirmation }, `whatif-apply:${run.id}`); }
      catch (reason) {
        if (lost(reason)) {
          const latest = await reloadRun(run.id).catch(() => null);
          if (latest && latest.applied_index !== null && "status" in latest.application) { setApplied(latest.application as ApplyResult); setPlan(null); setNotice(t("copilot.notice.applied")); return; }
          setError(t("shell.err.lost")); return;
        }
        throw reason;
      }
      setApplied(result); setPlan(null); setPlanCheck(false);
      await refresh(); await reloadRun(run.id).catch(() => {});
      setNotice(t("copilot.notice.applied"));
    });
  }

  async function explain(trace: string) {
    const id = trace.trim();
    setTraceInput(id); setTraceError(""); setLayerPick(null);
    if (!id) { setTraceError(t("copilot.why.empty")); return; }
    try { setExplanation(await client.get<Explanation>(`readiness/explanations/${encodeURIComponent(id)}/`)); }
    catch (reason) { setExplanation(null); setTraceError(reason instanceof WalletApiError && reason.status === 404 ? t("copilot.why.notFound") : message(reason)); }
  }

  async function loadHistory(item: ReviewItem) {
    try {
      const detail = await client.get<ReviewItem & { history: ReviewHistory[] }>(`review-queue/${item.id}/`);
      setHistories((prior) => ({ ...prior, [item.id]: detail.history ?? [] }));
    } catch (reason) { setError(message(reason)); }
  }

  async function recheck(item: ReviewItem) {
    const reason = (reasons[item.id] ?? "").trim();
    if (!reason) { setError(t("copilot.review.reasonRequired")); return; }
    await perform(async () => {
      const updated = await client.post<ReviewItem>(`review-queue/${item.id}/actions/`, { expected_version: item.version, action: "recheck", reason },
        `review-recheck:${item.id}:${item.version}`);
      await refresh(); setReasons((prior) => ({ ...prior, [item.id]: "" }));
      if (histories[item.id]) await loadHistory(updated);
      setNotice(t("copilot.notice.rechecked", { status: t(`copilot.review.status.${updated.status}` as MessageKey) }));
    });
  }

  async function markRead(item: Notification) {
    await perform(async () => {
      await client.post(`readiness/notifications/${item.id}/read/`, {}, `notification-read:${item.id}`);
      await refresh(); setNotice(t("copilot.notice.read"));
    });
  }

  const chip = (status: string | null | undefined, label?: string) => <span className={`status-chip status-${tone(status)}`}>{label ?? humanize(status ?? "")}</span>;
  const deltaView = (k: DeltaKey, delta: string | undefined) => {
    if (delta === undefined) return null;
    const verdict = deltaTone(k, delta);
    const value = Number(delta);
    const text = verdict === "same" ? t("copilot.delta.same") : t(`copilot.delta.${verdict}`, { value: `${value > 0 ? "+" : "−"}${money(Math.abs(value).toFixed(2))}` });
    return <span className={`copilot-delta copilot-${verdict}`}>{text}</span>;
  };
  const conditionText = (code: string) => {
    const label = conditionLabel(code);
    return label.key ? t(label.key as MessageKey, { cost: label.cost ? costName(label.cost) : "" }) : label.raw;
  };
  const diffView = (entry: DiffEntry) => {
    if (entry.kind === "cost") {
      const c = costChange(entry);
      return { what: t("copilot.diff.cost", { cost: costName(c.cost_id) }), before: c.before ? money(c.before) : c.lower && c.upper ? `${money(c.lower)} – ${money(c.upper)}` : "—",
        after: t("copilot.diff.costAfter", { amount: money(c.amount), date: date(c.effective_on) }),
        confirm: t("copilot.confirm.cost", { cost: costName(c.cost_id), amount: money(c.amount), date: date(c.effective_on) }) };
    }
    if (entry.kind === "family_support") {
      const before = entry.before as { amount: string; available_on: string } | null;
      const after = entry.after as { amount: string; available_on: string; status?: string };
      return { what: t(before ? "copilot.diff.supportReplace" : "copilot.diff.supportNew"), before: before ? `${money(before.amount)} · ${date(before.available_on)}` : "—",
        after: t("copilot.diff.supportAfter", { amount: money(after.amount), date: date(after.available_on) }),
        confirm: t("copilot.confirm.support", { amount: money(after.amount), date: date(after.available_on) }) };
    }
    if (entry.kind === "loan_draft") {
      const after = entry.after as { principal: string; annual_rate: string; months: number; first_due_date: string };
      const vars = { principal: money(after.principal), months: after.months, rate: fractionToPercent(after.annual_rate), date: date(after.first_due_date) };
      return { what: t("copilot.diff.loan"), before: "—", after: t("copilot.diff.loanAfter", vars), confirm: t("copilot.confirm.loan", vars) };
    }
    const yesNo = (v: unknown) => t(v ? "copilot.yes" : "copilot.no");
    return { what: t("copilot.diff.allowLoan"), before: yesNo(entry.before), after: yesNo(entry.after), confirm: t("copilot.confirm.preference", { value: yesNo(entry.after) }) };
  };
  const rulesView = (rules: unknown) => {
    if (rules === undefined || rules === null || (Array.isArray(rules) && rules.length === 0)) return null;
    if (Array.isArray(rules)) return <ul>{rules.map((r, i) => <li key={i}>{issueText(r)}</li>)}</ul>;
    if (typeof rules === "object") {
      const r = rules as Record<string, unknown>;
      if (typeof r.message === "string" || typeof r.detail === "string") return <p>{String(r.message ?? r.detail)}{typeof r.code === "string" && <> <code>{r.code}</code></>}</p>;
      return <ul>{Object.entries(r).map(([k, v]) => <li key={k}><code>{k}</code>: {issueText(Array.isArray(v) ? v.map(issueText).join(" ") : v)}</li>)}</ul>;
    }
    return <p>{String(rules)}</p>;
  };
  const layerView = (name: (typeof LAYERS)[number], layer: Layer | undefined) => {
    const status = layer?.status ?? "NOT_CALLED";
    const technical = layer && (layer.inputs !== undefined || layer.outcome !== undefined) ? JSON.stringify({ inputs: layer.inputs, outcome: layer.outcome }, null, 2) : "";
    const facts: [ReactNode, ReactNode][] = [];
    if (layer?.decision) facts.push([t("copilot.why.decision"), chip(layer.decision, t(`copilot.decision.${layer.decision}` as MessageKey))]);
    if (layer?.calls && layer.calls.length > 0) facts.push([t("copilot.why.calls"), layer.calls.map((c) => [c.provider, c.mode, c.error_code].filter(Boolean).join(" · ")).join("; ")]);
    if (layer?.route) facts.push([t("copilot.why.route"), <><code>{layer.route}</code>{layer.http_status ? ` · HTTP ${layer.http_status}` : ""}</>]);
    if (layer?.error_code) facts.push([t("copilot.why.errorCode"), <code>{layer.error_code}</code>]);
    if (layer?.engine_version) facts.push([t("copilot.why.engine"), layer.engine_version]);
    return <article key={name} className="copilot-layer" aria-labelledby={`layer-${name}`}>
      <div className="panel-row"><h4 id={`layer-${name}`}>{t(`copilot.layer.${name}` as MessageKey)}</h4>{chip(status, t(`copilot.layerStatus.${status}` as MessageKey))}</div>
      <p className="panel-muted">{t(`copilot.layer.${name}.text` as MessageKey)}</p>
      {facts.length > 0 && <PanelFacts items={facts} />}
      {layer?.calls_are_original && <p className="panel-muted">{t("copilot.why.cached")}</p>}
      {rulesView(layer?.rules) && <><h5>{t("copilot.why.rules")}</h5>{rulesView(layer?.rules)}</>}
      {layer?.formulas && <><h5>{t("copilot.why.formulas")}</h5><ul>{Object.entries(layer.formulas).map(([k, v]) => <li key={k}><code>{k} = {v}</code></li>)}</ul></>}
      {layer?.events && layer.events.length > 0 && <><h5>{t("copilot.why.events")}</h5><ul>{layer.events.map((e, i) => <li key={i}>{when(e.timestamp)} · <code>{e.action}</code>{e.decision ? ` · ${t(`copilot.decision.${e.decision}` as MessageKey)}` : ""}</li>)}</ul></>}
      {layer?.next_action && <p className="panel-note">{t("copilot.why.next", { action: layer.next_action })}</p>}
      {technical && <details className="copilot-details"><summary>{t("copilot.why.technical")}</summary><pre>{technical.length > 4000 ? `${technical.slice(0, 4000)}…` : technical}</pre></details>}
    </article>;
  };

  // ---- comparison data ----
  const columns: ScenarioResult[] = run ? [run.baseline, ...run.scenarios] : [];
  const planName = (i: number) => i === 0 ? t("copilot.results.baseline") : columns[i]?.name ?? "";
  const metricRows: MetricRow[] = [
    { id: "gap", k: "maximum_reserve_gap", label: t("copilot.m.gap"), kind: "money", delta: "maximum_reserve_gap" },
    { id: "min", k: "minimum_balance", label: t("copilot.m.min"), kind: "money", delta: "minimum_balance", better: "higher" },
    { id: "below", k: "first_below_reserve", label: t("copilot.m.below"), kind: "date" },
    { id: "negative", k: "first_negative_date", label: t("copilot.m.negative"), kind: "date" },
    { id: "remaining", k: "remaining_expenses", label: t("copilot.m.remaining"), kind: "money", delta: "remaining_expenses" },
    { id: "semester", k: "semester_funding_gap", label: t("copilot.m.semester"), kind: "money" },
    { id: "loan", k: "loan_needed", label: t("copilot.m.loanNeeded"), kind: "money", delta: "loan_needed" },
    { id: "unmet", k: "unmet_gap", label: t("copilot.m.unmet"), kind: "money" },
    { id: "complete", k: "complete", label: t("copilot.m.complete"), kind: "bool" },
    { id: "afford", label: t("copilot.loan.afford"), kind: "afford" },
  ];
  const keyRows = metricRows.filter((row) => ["gap", "min", "loan", "afford"].includes(row.id));
  const cellView = (s: ScenarioResult, i: number, row: MetricRow) => {
    let value: ReactNode;
    if (row.kind === "afford") value = s.loan?.affordability ? chip(s.loan.affordability.status, t(`copilot.afford.${s.loan.affordability.status}` as MessageKey)) : "—";
    else {
      const v = s[row.k!];
      value = row.kind === "money" ? money(v) : row.kind === "date" ? date(v) : t(v ? "copilot.m.completeYes" : "copilot.m.completeNo");
    }
    return <>{value}{i > 0 && row.delta && <><br />{deltaView(row.delta, s.delta?.[row.delta])}</>}</>;
  };
  const measuresTable = () => <div className="copilot-scroll"><table className="panel-table copilot-measures">
    <caption className="copilot-sr">{t("copilot.results.caption")}</caption>
    <thead><tr><th scope="col">{t("copilot.results.metric")}</th>{columns.map((_, i) => <th key={i} scope="col">{planName(i)}</th>)}</tr></thead>
    <tbody>{metricRows.map((row) => <tr key={row.id}><th scope="row">{row.label}</th>{columns.map((c, i) => <td key={i}>{cellView(c, i, row)}</td>)}</tr>)}</tbody>
  </table></div>;
  const fallbackPair: [number, number] = columns.length > 2 ? [1, 2] : [0, Math.min(1, Math.max(columns.length - 1, 0))];
  const [pa, pb] = (pair ?? fallbackPair).map((n) => Math.min(n, Math.max(columns.length - 1, 0))) as [number, number];
  const A = columns[pa], B = columns[pb];
  const target = pb > 0 ? pb : pa > 0 ? pa : null;
  const barValues = columns.map((c) => Number(c[barMetric]) || 0);
  const bestBar = barValues.length > 1 && new Set(barValues).size > 1 ? barValues.indexOf(Math.min(...barValues)) : -1;
  const di = Math.min(detail ?? (columns.length > 1 ? 1 : 0), Math.max(columns.length - 1, 0));
  const D = columns[di];

  // ---- follow-up data ----
  const unread = snapshot.notifications.filter((n) => !n.read_at).length;
  const openReviews = snapshot.reviews.filter((r) => OPEN_REVIEW.includes(r.status)).length;
  const review = snapshot.reviews[Math.min(reviewIndex, Math.max(snapshot.reviews.length - 1, 0))];
  const notes = slice(snapshot.notifications, 4, notifPage);
  const errorsFor = (index: number) => formErrors.filter((e) => e.scenario === index);
  const ai = Math.min(active, forms.length - 1);

  const auto: Tab = run ? "compare" : "build";
  const current = tab ?? auto;
  const select = (next: Tab) => { setTab(next); setSheet(null); };
  const applyTrack = run && <StepTrack label={t("copilot.p.track.label")} steps={[t("copilot.p.track.compare"), t("copilot.p.track.preview"), t("copilot.p.track.confirm"), t("copilot.p.track.applied")]}
    current={applied ? 4 : plan?.confirmation ? 2 : 1} failed={!applied && !!plan && plan.blockers.length > 0 && !plan.confirmation} />;
  const toReview = (event: React.MouseEvent) => { event.preventDefault(); select("follow"); setFollowView("review"); };
  const openWhy = (trace?: string) => { setSheet("why"); if (trace && !preview) void explain(trace); };
  const previewButton = (index: number | null) => index !== null && run && <button type="button" className="primary" disabled={preview || busy || run.applied_index !== null}
    onClick={() => void previewApply(index - 1)}>{t("copilot.apply.previewButton")}</button>;

  // ---- tab bodies ----
  const buildView = <section id="copilot-build" className="panel-view" hidden={current !== "build"} aria-labelledby="copilot-build-title">
    <div className="panel-card-head"><h3 id="copilot-build-title">{t("copilot.build.title")}</h3><PanelInfo>{t("copilot.build.text")} {t("copilot.build.noMoney")}</PanelInfo></div>
    {snapshot.errors.state && !signedOut && <PanelAlert message={snapshot.errors.state} onRetry={() => void refresh()} />}
    {loading && !state && !snapshot.errors.state ? <PanelSkeleton rows={1} />
      : <PanelHero label={t("copilot.p.build.hero")} value={String(forms.length)} unit={t("copilot.p.build.of", { max: MAX_SCENARIOS })}>
        {state && <span className="panel-muted">{t("copilot.build.versions", { state: state.state_version, budget: state.budget_version, analysis: state.analysis_version })}</span>}</PanelHero>}
    <div className="panel-row copilot-scenarios">
      <div className="panel-chips" role="group" aria-label={t("copilot.p.scenarios")}>
        {forms.map((form, i) => <button key={form.key} type="button" aria-pressed={i === ai} className={errorsFor(i).length ? "is-error" : ""} onClick={() => pickScenario(i)}>
          {form.name.trim() || t("copilot.form.legend", { n: i + 1 })}</button>)}
      </div>
      {forms.length > 1 && <button type="button" className="panel-link" disabled={preview}
        onClick={() => { setForms(forms.filter((_, i) => i !== ai)); setFormErrors([]); pickScenario(Math.max(0, ai - 1)); }}>{t("copilot.form.removeScenario")}</button>}
    </div>
    {forms.map((form, index) => {
      const problems = errorsFor(index);
      const costPage = slice(form.costs, ROWS_PER_PAGE, rowPage), supportPage = slice(form.support, ROWS_PER_PAGE, rowPage);
      return <fieldset key={form.key} className="copilot-form" hidden={index !== ai}>
        <legend className="copilot-sr">{t("copilot.form.legend", { n: index + 1 })}</legend>
        <label className="copilot-field">{t("copilot.form.name")}<input value={form.name} maxLength={100} disabled={preview} placeholder={t("copilot.form.namePlaceholder")}
          onChange={(e) => editForm(index, { name: e.target.value })} /></label>
        <div className="panel-chips copilot-parts" role="group" aria-label={t("copilot.p.parts")}>
          <button type="button" aria-pressed={part === "costs"} onClick={() => pickPart("costs")}>{t("copilot.p.part.costs", { n: form.costs.length })}</button>
          <button type="button" aria-pressed={part === "support"} onClick={() => pickPart("support")}>{t("copilot.p.part.support", { n: form.support.length })}</button>
          <button type="button" aria-pressed={part === "loan"} onClick={() => pickPart("loan")}>{t("copilot.form.loanTitle")}</button>
        </div>

        <div className="copilot-part" hidden={part !== "costs"}>
          <div className="panel-section-title"><span>{t("copilot.form.costs")}</span>
            <PanelPager index={costPage.index} count={costPage.pages} onChange={setRowPage} label={t("copilot.form.costs")} /></div>
          {form.costs.length === 0 && <p className="panel-muted">{t("copilot.form.noCosts")}</p>}
          {costPage.rows.map((row, i) => {
            const n = costPage.offset + i;
            const cost = costs.find((c) => c.cost_id === row.cost_id);
            const patch = (p: Partial<typeof row>) => editForm(index, { costs: form.costs.map((r) => r.key === row.key ? { ...r, ...p } : r) });
            const now = Number(cost?.amount), next = Number(toMoney(row.amount) ?? NaN);
            return <div key={row.key} className="copilot-row" role="group" aria-label={t("copilot.form.costRow", { n: n + 1 })}>
              <label className="copilot-field">{t("copilot.form.cost")}<select value={row.cost_id} disabled={preview} onChange={(e) => patch({ cost_id: e.target.value })}>
                <option value="">{t("copilot.form.pickCost")}</option>
                {(preview ? costs : editable).map((c) => <option key={c.cost_id} value={c.cost_id}>{costName(c.cost_id)}</option>)}
              </select></label>
              <label className="copilot-field">{t("copilot.form.newAmount")}<input inputMode="decimal" value={row.amount} disabled={preview} onChange={(e) => patch({ amount: e.target.value })} /></label>
              <label className="copilot-field">{t("copilot.form.effective")}<input type="date" value={row.effective_on} disabled={preview} onChange={(e) => patch({ effective_on: e.target.value })} /></label>
              <div className="copilot-current">
                {now > 0 && next >= 0 && <LevelBar value={now} after={next} max={Math.max(now, next)} />}
                <span>{t("copilot.form.current", { amount: costAmount(cost) })}{isProtected(cost) && <> · <strong>{t("copilot.form.protected")}</strong></>}</span>
                <button type="button" className="panel-link" disabled={preview} onClick={() => editForm(index, { costs: form.costs.filter((r) => r.key !== row.key) })}>{t("copilot.form.remove")}</button>
              </div>
            </div>;
          })}
          <button type="button" className="secondary" disabled={preview || form.costs.length >= MAX_COSTS || editable.length === 0}
            onClick={() => { editForm(index, { costs: [...form.costs, { key: key(), cost_id: "", amount: "", effective_on: today }] }); setRowPage(Math.floor(form.costs.length / ROWS_PER_PAGE)); }}>{t("copilot.form.addCost")}</button>
        </div>

        <div className="copilot-part" hidden={part !== "support"}>
          <div className="panel-section-title"><span>{t("copilot.form.support")}</span>
            <PanelPager index={supportPage.index} count={supportPage.pages} onChange={setRowPage} label={t("copilot.form.support")} /></div>
          {form.support.length === 0 && <p className="panel-muted">{t("copilot.form.noSupport")}</p>}
          {supportPage.rows.map((row, i) => {
            const n = supportPage.offset + i;
            const patch = (p: Partial<typeof row>) => editForm(index, { support: form.support.map((r) => r.key === row.key ? { ...r, ...p } : r) });
            return <div key={row.key} className="copilot-row" role="group" aria-label={t("copilot.form.supportRow", { n: n + 1 })}>
              <label className="copilot-field">{t("copilot.form.source")}<select value={row.source_id} disabled={preview} onChange={(e) => patch({ source_id: e.target.value })}>
                <option value="">{t("copilot.form.newSource")}</option>
                {sources.map((s) => <option key={s.id} value={s.id}>{t("copilot.form.replaceSource", { amount: money(s.amount), date: date(s.available_on) })}</option>)}
              </select></label>
              <label className="copilot-field">{t("copilot.form.amount")}<input inputMode="decimal" value={row.amount} disabled={preview} onChange={(e) => patch({ amount: e.target.value })} /></label>
              <label className="copilot-field">{t("copilot.form.availableOn")}<input type="date" value={row.available_on} disabled={preview} onChange={(e) => patch({ available_on: e.target.value })} /></label>
              <div className="copilot-current"><span />
                <button type="button" className="panel-link" disabled={preview} onClick={() => editForm(index, { support: form.support.filter((r) => r.key !== row.key) })}>{t("copilot.form.remove")}</button></div>
            </div>;
          })}
          <button type="button" className="secondary" disabled={preview || form.support.length >= MAX_SUPPORT}
            onClick={() => { editForm(index, { support: [...form.support, { key: key(), source_id: "", amount: "", available_on: today }] }); setRowPage(Math.floor(form.support.length / ROWS_PER_PAGE)); }}>{t("copilot.form.addSupport")}</button>
        </div>

        <div className="copilot-part" hidden={part !== "loan"}>
          <div className="panel-row">
            <label className="panel-check"><input type="checkbox" checked={form.allowLoan} disabled={preview} onChange={(e) => editForm(index, { allowLoan: e.target.checked })} />{t("copilot.form.allowLoan")}</label>
            <PanelInfo>{t("copilot.form.loanHint")}</PanelInfo>
          </div>
          <div className="copilot-loan">
            {([["principal", "copilot.form.principal", "decimal"], ["rate", "copilot.form.rate", "decimal"], ["fees", "copilot.form.fees", "decimal"], ["months", "copilot.form.months", "numeric"],
              ["available_on", "copilot.form.loanAvailable", "date"], ["first_due_date", "copilot.form.firstDue", "date"]] as const).map(([field, label, mode]) =>
              <label key={field} className="copilot-field">{t(label)}<input type={mode === "date" ? "date" : "text"} inputMode={mode === "date" ? undefined : mode} value={form.loan[field]}
                disabled={preview || !form.allowLoan} onChange={(e) => editForm(index, { loan: { ...form.loan, [field]: e.target.value } })} /></label>)}
          </div>
        </div>
        {problems.length > 0 && <ul className="error copilot-problems" role="alert">{problems.map((p, i) => <li key={i}>{t(`copilot.err.f.${p.code}` as MessageKey, { n: p.n ?? "" })}</li>)}</ul>}
      </fieldset>;
    })}
  </section>;

  const emptyCompare = <PanelEmpty title={t("copilot.p.compare.emptyTitle")} text={t("copilot.results.none")}
    action={<button type="button" className="secondary" onClick={() => select("build")}>{t("copilot.p.toBuild")}</button>} />;

  const compareView = <section id="copilot-results" className="panel-view" hidden={current !== "compare"} aria-labelledby="copilot-results-title">
    <h3 id="copilot-results-title" className="copilot-sr">{t("copilot.results.title")}</h3>
    {!run || !A || !B ? emptyCompare : <>
      {run.stale && <div className="panel-note is-warn copilot-stale" role="status"><span>{t("copilot.results.stale")}</span>
        <button type="button" className="secondary" disabled={preview || busy} onClick={() => void rerun()}>{t("copilot.results.rerun")}</button></div>}
      <div className="copilot-pair">
        <select aria-label={t("copilot.p.compare.a")} value={pa} onChange={(e) => setPair([Number(e.target.value), pb])}>
          {columns.map((_, i) => <option key={i} value={i}>{planName(i)}</option>)}</select>
        <span aria-hidden="true">{t("copilot.p.compare.vs")}</span>
        <select aria-label={t("copilot.p.compare.b")} value={pb} onChange={(e) => setPair([pa, Number(e.target.value)])}>
          {columns.map((_, i) => <option key={i} value={i}>{planName(i)}</option>)}</select>
        <PanelInfo>{t("copilot.results.text")} {t("copilot.results.caption")} {t("copilot.results.legend")}</PanelInfo>
      </div>
      <PanelHero label={t("copilot.p.compare.hero", { name: planName(pb) })} value={money(B.maximum_reserve_gap)} tone={Number(B.maximum_reserve_gap) > 0 ? "warn" : undefined} />
      {pa === pb && <p className="panel-muted">{t("copilot.p.compare.same")}</p>}
      <table className="panel-table copilot-pair-table">
        <caption className="copilot-sr">{t("copilot.results.caption")}</caption>
        <thead><tr><th scope="col">{t("copilot.results.metric")}</th><th scope="col">{planName(pa)}</th><th scope="col">{planName(pb)}</th></tr></thead>
        <tbody>{keyRows.map((row) => {
          const w = pa === pb ? null : weaker(row, A, B);
          return <tr key={row.id}><th scope="row">{row.label}</th>
            <td className={w === "a" ? "is-weaker" : ""}>{cellView(A, pa, row)}</td>
            <td className={w === "b" ? "is-weaker" : ""}>{cellView(B, pb, row)}</td></tr>;
        })}</tbody>
      </table>
      <div className="panel-section-title copilot-bars-head"><span>{t("copilot.p.compare.bars")}</span>
      <div className="panel-chips copilot-metric" role="group" aria-label={t("copilot.p.compare.metric")}>
        {(["maximum_reserve_gap", "loan_needed", "remaining_expenses"] as const).map((m) => <button key={m} type="button" aria-pressed={barMetric === m} onClick={() => setBarMetric(m)}>
          {metricRows.find((row) => row.k === m)!.label}</button>)}
      </div></div>
      <BarCompare label={t("copilot.p.bars.label", { measure: metricRows.find((row) => row.k === barMetric)!.label })}
        rows={columns.map((c, i) => ({ key: String(i), label: planName(i), value: barValues[i], display: money(c[barMetric]), best: i === bestBar }))} />
      <div className="panel-row"><button type="button" className="panel-link" onClick={() => setSheet("measures")}>{t("copilot.p.compare.all")} →</button></div>
    </>}
  </section>;

  const detailView = <section id="copilot-detail" className="panel-view" hidden={current !== "detail"} aria-labelledby="copilot-detail-title">
    {!run || !D ? emptyCompare : <>
      <div className="panel-card-head"><h3 id="copilot-detail-title">{planName(di)}</h3>
        <PanelPager index={di} count={columns.length} onChange={setDetail} label={t("copilot.p.detail.pager")} /></div>
      <PanelHero label={t("copilot.m.min")} value={money(D.minimum_balance)} tone={Number(D.minimum_balance) < 0 ? "warn" : undefined}>
        <span className="panel-muted">{t("copilot.m.negative")}: {date(D.first_negative_date)}</span></PanelHero>
      {(D.monthly?.length ?? 0) > 1 ? <BalanceChart months={D.monthly!} label={t("copilot.p.line.label")}
        legend={{ ending: t("copilot.p.line.ending"), minimum: t("copilot.p.line.minimum"), zero: t("copilot.p.line.zero") }}
        describe={(m) => t("copilot.p.detail.month", { month: m.month, ending: money(m.ending_balance), minimum: money(m.minimum_balance) })} />
        : D.monthly?.length === 1 && <p className="panel-muted">{t("copilot.p.detail.month", { month: D.monthly[0].month, ending: money(D.monthly[0].ending_balance), minimum: money(D.monthly[0].minimum_balance) })}</p>}
      {D.conditional ? <div className="copilot-conditions">
        <p className="panel-muted">{t("copilot.results.conditional")}</p>
        <ul>{D.conditions.map((c) => <li key={c}>{chip("PENDING", t("copilot.results.condition"))} <span>{conditionText(c)}</span></li>)}</ul>
      </div> : <p className="panel-muted">{t("copilot.results.unconditional")}</p>}
      <div className="panel-section-title"><span>{t("copilot.results.confirmed")} <PanelInfo>{t("copilot.results.confirmedText")}</PanelInfo></span></div>
      <PanelFacts items={[[t("copilot.m.gap"), money(D.confirmed.maximum_reserve_gap)], [t("copilot.m.min"), money(D.confirmed.minimum_balance)],
        [t("copilot.m.negative"), date(D.confirmed.first_negative_date)], [t("copilot.m.semester"), money(D.confirmed.semester_funding_gap)]]} />
      {D.loan && <div className="panel-row copilot-loan-row">
        <span>{t("copilot.loan.afford")} {D.loan.affordability ? chip(D.loan.affordability.status, t(`copilot.afford.${D.loan.affordability.status}` as MessageKey)) : "—"}</span>
        <button type="button" className="panel-link" onClick={() => setSheet("loan")}>{t("copilot.p.detail.loan")} →</button></div>}
      <div className="panel-row">
        {!!D.issues?.length && <button type="button" className="panel-link" onClick={() => setSheet("issues")}>{t("copilot.p.detail.issues", { n: D.issues.length })} →</button>}
        <button type="button" className="panel-link" onClick={() => setSheet("measures")}>{t("copilot.p.compare.all")} →</button>
      </div>
    </>}
  </section>;

  const planTarget = plan && run ? run.scenarios[plan.scenario_index]?.name ?? "" : "";
  const applyView = <section id="copilot-apply" className="panel-view" hidden={current !== "apply"} aria-labelledby="copilot-apply-title">
    <div className="panel-card-head"><h3 id="copilot-apply-title">{t("copilot.apply.title")}</h3><PanelInfo>{t("copilot.apply.text")}</PanelInfo></div>
    {!run ? <PanelEmpty title={t("copilot.p.apply.emptyTitle")} text={t("copilot.apply.none")}
      action={<button type="button" className="secondary" onClick={() => select("build")}>{t("copilot.p.toBuild")}</button>} />
    : applied ? <div className="panel-view" role="status">
      <PanelHero label={t("copilot.applied.title")} value={String(applied.diff.length)} unit={t("copilot.p.apply.applied")}>
        <span>{chip("APPLIED", t("copilot.applied.status"))}</span></PanelHero>
      {applyTrack}
      <p className="panel-muted">{t("copilot.applied.versions", { before: String(applied.before?.state_version ?? "—"), after: String(applied.after?.state_version ?? "—"),
        budgetBefore: String(applied.before?.budget_version ?? "—"), budgetAfter: String(applied.after?.budget_version ?? "—") })}</p>
      {applied.diff.length > 0 && <ul className="copilot-checklist">{applied.diff.map((entry, i) => <li key={i}>{diffView(entry).confirm}</li>)}</ul>}
      {applied.support_requests.length > 0 && <p className="panel-muted">{t("copilot.applied.support", { count: applied.support_requests.length })} <a className="panel-link" href="?family=1">{t("copilot.applied.familyLink")}</a></p>}
      {applied.loan && <p className="panel-muted">{t("copilot.applied.loan", { id: applied.loan.application.id.slice(0, 8) })} <a className="panel-link" href="?loans=1">{t("copilot.applied.loansLink")}</a></p>}
      <p className="panel-note">{t("copilot.applied.noMoney")}</p>
    </div>
    : plan ? <>
      <PanelHero label={t("copilot.apply.planFor", { name: planTarget })} value={String(plan.diff.length)} unit={t("copilot.p.apply.changes")} />
      {applyTrack}
      {plan.diff.length === 0 && <p className="panel-muted">{t("copilot.apply.noChanges")}</p>}
      {plan.blockers.length > 0 && <div className="panel-note is-warn copilot-blocked" role="status">
        <strong>{t("copilot.apply.blocked")}</strong>
        <ul>{plan.blockers.map((b) => <li key={b.cost_id}>{t("copilot.apply.blocker", { cost: costName(b.cost_id), before: costAmount(b.before), amount: money(b.proposed.amount) })}</li>)}</ul>
        <span>{t("copilot.apply.blockedText")} <a href="#copilot-review" onClick={toReview}>{t("copilot.apply.reviewLink")}</a></span>
      </div>}
      {plan.confirmation ? <div className="copilot-confirm">
        <h4>{t("copilot.confirm.title")}</h4>
        <ul className="copilot-checklist">
          {plan.diff.map((entry, i) => <li key={i}>{diffView(entry).confirm}</li>)}
          <li><strong>{t("copilot.confirm.noMoney")}</strong></li>
        </ul>
        <p className="panel-muted">{t("copilot.confirm.expires", { minutes: Math.round(plan.expires_in_seconds / 60) })}</p>
        <label className="panel-check"><input type="checkbox" checked={planCheck} disabled={preview} onChange={(e) => setPlanCheck(e.target.checked)} />{t("copilot.confirm.check")}</label>
      </div> : <ul className="panel-rows">{plan.diff.slice(0, 3).map((entry, i) => { const v = diffView(entry);
        return <li key={i}><span><strong>{v.what}</strong><small>{v.before} → {v.after}</small></span></li>; })}</ul>}
      <div className="panel-row"><button type="button" className="panel-link" onClick={() => setSheet("diff")}>{t("copilot.p.apply.beforeAfter")} →</button></div>
    </>
    : <>
      {run.applied_index !== null && <p className="panel-note">{t("copilot.apply.already", { name: run.scenarios[run.applied_index]?.name ?? "" })}</p>}
      {applyTrack}
      {run.applied_index === null && <PanelEmpty title={t("copilot.p.apply.emptyTitle")} text={t("copilot.apply.pick")}
        action={<button type="button" className="secondary" onClick={() => select("compare")}>{t("copilot.p.toCompare")}</button>} />}
    </>}
  </section>;

  const followView_ = <div className="panel-view" hidden={current !== "follow"}>
    <div className="panel-chips" role="group" aria-label={t("copilot.p.tab.follow")}>
      <button type="button" aria-pressed={followView === "review"} onClick={() => setFollowView("review")}>{t("copilot.p.follow.reviews", { n: snapshot.reviews.length })}</button>
      <button type="button" aria-pressed={followView === "notif"} onClick={() => setFollowView("notif")}>{t("copilot.p.follow.notifs", { n: unread })}</button>
    </div>
    <section id="copilot-review" className="panel-view" hidden={followView !== "review"} aria-labelledby="copilot-review-title">
      <div className="panel-card-head"><h3 id="copilot-review-title">{t("copilot.review.title")}</h3>
        <PanelPager index={Math.min(reviewIndex, Math.max(snapshot.reviews.length - 1, 0))} count={snapshot.reviews.length} onChange={setReviewIndex} label={t("copilot.p.follow.pager")} /></div>
      {snapshot.errors.reviews && !signedOut && <PanelAlert message={snapshot.errors.reviews} onRetry={() => void refresh()} />}
      {!review ? <PanelEmpty title={t("copilot.review.none")} text={t("copilot.review.text")} /> : <>
        <PanelHero label={t("copilot.p.follow.reviewHero")} value={String(openReviews)} tone={openReviews ? "warn" : undefined} />
        <StackBar label={t("copilot.p.stack.reviews")} parts={[
          { key: "open", value: openReviews, tone: "gold", label: t("copilot.p.stack.open", { n: openReviews }) },
          { key: "resolved", value: snapshot.reviews.filter((r) => r.status === "RESOLVED").length, tone: "mint", label: t("copilot.p.stack.resolved", { n: snapshot.reviews.filter((r) => r.status === "RESOLVED").length }) },
          { key: "rejected", value: snapshot.reviews.filter((r) => r.status === "REJECTED").length, tone: "red", label: t("copilot.p.stack.rejected", { n: snapshot.reviews.filter((r) => r.status === "REJECTED").length }) },
        ]} />
        {(() => {
          const blockers = Array.isArray(review.details.blockers) ? review.details.blockers as { cost_id: string; proposed?: { amount: string } }[] : [];
          const next = typeof review.details.next_action === "string" ? review.details.next_action : "";
          return <article className="copilot-review-item" aria-labelledby={`review-${review.id}`}>
            <div className="panel-row"><h4 id={`review-${review.id}`}>{REVIEW_KINDS.includes(review.kind) ? t(`copilot.review.kind.${review.kind}` as MessageKey) : humanize(review.kind)}</h4>
              {chip(review.status, t(`copilot.review.status.${review.status}` as MessageKey))}</div>
            <p className="panel-muted">{t("copilot.review.updated", { date: when(review.updated_at), version: review.version })}</p>
            {review.kind === "protected_cost" && <p className="panel-muted">{t("copilot.review.protectedText")}</p>}
            {blockers.length > 0 && <ul className="copilot-checklist">{blockers.map((b) => <li key={b.cost_id}>{t("copilot.review.blocker", { cost: costName(b.cost_id), amount: money(b.proposed?.amount) })}</li>)}</ul>}
            {next && <p className="panel-note">{t("copilot.why.next", { action: next })}</p>}
            {review.status !== "RESOLVED" && <label className="copilot-field">{t("copilot.review.reason")}<input value={reasons[review.id] ?? ""} maxLength={500} disabled={preview}
              onChange={(e) => setReasons({ ...reasons, [review.id]: e.target.value })} /></label>}
            <div className="panel-row"><button type="button" className="panel-link" onClick={() => { setSheet("history"); if (!histories[review.id]) void loadHistory(review); }}>{t("copilot.review.history")} →</button></div>
          </article>;
        })()}
      </>}
    </section>
    <section id="copilot-notifications" className="panel-view" hidden={followView !== "notif"} aria-labelledby="copilot-notifications-title">
      <div className="panel-card-head"><h3 id="copilot-notifications-title">{t("copilot.notif.title")}</h3>
        <PanelPager index={notes.index} count={notes.pages} onChange={setNotifPage} label={t("copilot.p.follow.notifPager")} /></div>
      {snapshot.errors.notifications && !signedOut && <PanelAlert message={snapshot.errors.notifications} onRetry={() => void refresh()} />}
      <PanelHero label={t("copilot.p.follow.unreadHero")} value={String(unread)} tone={unread ? "warn" : undefined} />
      <p className="panel-muted">{t("copilot.notif.text", { count: unread })}</p>
      {snapshot.notifications.length === 0 ? <PanelEmpty title={t("copilot.notif.none")} /> : <>
        <StackBar label={t("copilot.p.stack.notifs")} parts={[
          { key: "unread", value: unread, tone: "gold", label: t("copilot.p.stack.unread", { n: unread }) },
          { key: "read", value: snapshot.notifications.length - unread, tone: "muted", label: t("copilot.p.stack.read", { n: snapshot.notifications.length - unread }) },
        ]} />
        <ul className="panel-rows copilot-notifications">{notes.rows.map((n) => <li key={n.id} className={n.read_at ? "" : "copilot-unread"}>
          <span><strong>{humanize(n.payload?.kind ?? "")} · {humanize(n.transition.toLowerCase())}</strong><small>{when(n.created_at)}</small></span>
          {n.read_at ? chip("RESOLVED", t("copilot.notif.read")) : <button type="button" className="secondary copilot-mini" disabled={preview || busy} onClick={() => void markRead(n)}>{t("copilot.notif.markRead")}</button>}
        </li>)}</ul>
      </>}
    </section>
  </div>;

  // ---- pinned actions ----
  let footer: ReactNode = null;
  if (current === "build") footer = <>
    <button type="button" className="secondary" disabled={preview || forms.length >= MAX_SCENARIOS}
      onClick={() => { setForms([...forms, newForm()]); pickScenario(forms.length); setPart("costs"); }}>{t("copilot.form.addScenario")}</button>
    <button type="button" className="primary" disabled={preview || busy || !state} onClick={() => void compare()}>{t("copilot.form.compare")}</button></>;
  else if (current === "compare" && run) footer = <>
    <button type="button" className="panel-link panel-footer-note" onClick={() => openWhy(run.id)}>{t("copilot.why.explainRun")}</button>
    {previewButton(target)}</>;
  else if (current === "detail" && run) footer = <>
    <button type="button" className="panel-link panel-footer-note" onClick={() => openWhy(run.id)}>{t("copilot.why.explainRun")}</button>
    {previewButton(di > 0 ? di : null)}</>;
  else if (current === "apply" && plan && !applied) footer = plan.confirmation ? <>
    <button type="button" className="secondary" disabled={busy} onClick={() => { setPlan(null); setPlanCheck(false); }}>{t("copilot.confirm.cancel")}</button>
    <button type="button" className="primary" disabled={preview || busy || !planCheck} onClick={() => void apply()}>{t("copilot.confirm.button")}</button></>
    : <button type="button" className="secondary" onClick={() => select("compare")}>{t("copilot.p.apply.back")}</button>;
  else if (current === "follow" && followView === "review" && review && review.status !== "RESOLVED") footer =
    <button type="button" className="primary" disabled={preview || busy} onClick={() => void recheck(review)}>{t("copilot.review.recheck")}</button>;

  // ---- secondary detail: sheets, and the second column of an expanded dock ----
  const diffTable = () => plan && <table className="panel-table">
    <thead><tr><th scope="col">{t("copilot.apply.change")}</th><th scope="col">{t("copilot.apply.before")}</th><th scope="col">{t("copilot.apply.after")}</th></tr></thead>
    <tbody>{plan.diff.map((entry, i) => { const v = diffView(entry); return <tr key={i}><th scope="row">{v.what}</th><td>{v.before}</td><td>{v.after}</td></tr>; })}</tbody>
  </table>;
  const historyList = () => !review ? null : !histories[review.id] ? <p className="panel-muted">{t("common.loading")}</p>
    : histories[review.id].length === 0 ? <p className="panel-muted">{t("copilot.review.noHistory")}</p>
    : <ul className="panel-rows">{histories[review.id].map((h) => <li key={h.id}><span><strong>{humanize(h.action)}{h.before?.status && h.after?.status ? ` · ${h.before.status} → ${h.after.status}` : ""}</strong>
      <small>{when(h.created_at)} — {h.reason}</small></span></li>)}</ul>;
  const layerName = layerPick ?? (explanation ? LAYERS.find((name) => (explanation.layers[name]?.status ?? "NOT_CALLED") !== "NOT_CALLED") ?? "policy" : "policy");
  const close = () => setSheet(null);
  const sheets: Record<Exclude<Sheet, null>, () => ReactNode> = {
    measures: () => <PanelSheet title={t("copilot.p.compare.all")} onClose={close}>
      <p className="panel-muted">{t("copilot.results.text")} {t("copilot.results.legend")}</p>{measuresTable()}</PanelSheet>,
    loan: () => D?.loan && <PanelSheet title={t("copilot.loan.title")} onClose={close}><div className="panel-sheet-stack">
      <p className="panel-muted">{planName(di)}</p>
      <PanelFacts items={[[t("copilot.loan.net"), money(D.loan.net_proceeds)], [t("copilot.loan.interest"), money(D.loan.total_interest)],
        [t("copilot.loan.fees"), money(D.loan.fees)], [t("copilot.loan.max"), money(D.loan.maximum_installment)], [t("copilot.loan.count"), D.loan.repayments.length],
        [t("copilot.loan.afford"), D.loan.affordability ? chip(D.loan.affordability.status, t(`copilot.afford.${D.loan.affordability.status}` as MessageKey)) : "—"]]} />
      {!!D.loan.affordability?.missing_inputs?.length && <p className="panel-note is-warn">{t("copilot.loan.missing", { months: [...new Set(D.loan.affordability.missing_inputs.map((m) => m.slice(0, 7)))].join(", ") })}</p>}
      {!!D.loan.affordability?.shortfall_months?.length && <p className="panel-note is-warn">{t("copilot.loan.shortfall", { months: D.loan.affordability.shortfall_months.join(", ") })}</p>}
      <h4 className="panel-section-title">{t("copilot.p.loan.schedule")}</h4>
      <table className="panel-table"><thead><tr><th scope="col">#</th><th scope="col">{t("copilot.p.loan.due")}</th><th scope="col">{t("copilot.p.loan.amount")}</th></tr></thead>
        <tbody>{D.loan.repayments.map((r) => <tr key={r.number}><td>{r.number}</td><td>{date(r.due_date)}</td><td>{money(r.amount)}</td></tr>)}</tbody></table>
    </div></PanelSheet>,
    issues: () => <PanelSheet title={t("copilot.results.issues")} onClose={close}>
      <p className="panel-muted">{planName(di)}</p>
      <ul className="copilot-checklist">{(D?.issues ?? []).map((issue, n) => <li key={n}>{issueText(issue)}</li>)}</ul></PanelSheet>,
    diff: () => <PanelSheet title={t("copilot.p.apply.beforeAfter")} onClose={close}>
      {plan ? <>{planTarget && <p className="panel-muted">{t("copilot.apply.planFor", { name: planTarget })}</p>}{diffTable()}</> : <p className="panel-muted">{t("copilot.apply.pick")}</p>}</PanelSheet>,
    history: () => <PanelSheet title={t("copilot.review.history")} onClose={close}>{historyList()}</PanelSheet>,
    why: () => <PanelSheet title={t("copilot.why.title")} onClose={close}><div id="copilot-why" className="panel-sheet-stack">
      <p className="panel-muted">{t("copilot.why.text")}</p>
      <form className="copilot-trace" onSubmit={(e) => { e.preventDefault(); void explain(traceInput); }}>
        <label className="copilot-field">{t("copilot.why.trace")}<input value={traceInput} disabled={preview} onChange={(e) => setTraceInput(e.target.value)} /></label>
        <button type="submit" className="secondary" disabled={preview}>{t("copilot.why.lookup")}</button>
      </form>
      <p className="panel-muted">{t("copilot.why.hint")}</p>
      {traceError && <p className="error" role="alert">{traceError}</p>}
      {explanation && <>
        <p className="panel-muted">{t("copilot.why.recorded", { id: explanation.trace_id, date: when(explanation.created_at) })}</p>
        <div className="panel-chips" role="group" aria-label={t("copilot.p.why.layers")}>{LAYERS.map((name) => <button key={name} type="button" aria-pressed={layerName === name}
          onClick={() => setLayerPick(name)}>{t(`copilot.layer.${name}` as MessageKey)}</button>)}</div>
        {layerView(layerName, explanation.layers[layerName])}
      </>}
    </div></PanelSheet>,
  };
  const aside = current === "build" ? <>
      <h3 className="panel-section-title">{t("copilot.p.build.costs")}</h3>
      {costs.length === 0 ? <p className="panel-muted">{t("copilot.p.build.noCosts")}</p>
        : <ul className="panel-rows">{costs.map((c) => <li key={c.cost_id}><span><strong>{costName(c.cost_id)}</strong>
          {isProtected(c) && <small>{t("copilot.form.protected")}</small>}</span><span>{costAmount(c)}</span></li>)}</ul>}
    </>
    : (current === "compare" || current === "detail") && run ? <><h3 className="panel-section-title">{t("copilot.p.compare.all")}</h3>{measuresTable()}</>
    : current === "apply" && plan ? <><h3 className="panel-section-title">{t("copilot.p.apply.beforeAfter")}</h3>{diffTable()}</>
    : current === "follow" && followView === "review" && review ? <><h3 className="panel-section-title">{t("copilot.review.history")}</h3>{historyList()}</>
    : undefined;

  const steps = [
    { key: "build" as const, label: t("copilot.p.tab.build") },
    { key: "compare" as const, label: t("copilot.p.tab.compare") },
    { key: "detail" as const, label: t("copilot.p.tab.detail") },
    { key: "apply" as const, label: t("copilot.p.tab.apply") },
    { key: "follow" as const, label: openReviews + unread ? `${t("copilot.p.tab.follow")} · ${openReviews + unread}` : t("copilot.p.tab.follow") },
  ];

  const staleStatus = useToolRefresh(() => refresh());
  return (
    <ServiceShell className="copilot-app" eyebrow={t("copilot.eyebrow")} title={t("copilot.title")} intro={t("copilot.intro")} sideLabel={t("copilot.side.label")}
      sections={[]} noteTitle={t("copilot.side.noteTitle")} noteText={t("copilot.side.noteText")} preview={preview}
      previewTitle={t("copilot.preview.title")} previewText={t("copilot.preview.text")} bannerText={t("copilot.banner.text")}
      signedOut={signedOut} signInUrl={signInUrl} signedOutText={t("copilot.signedOut")} onExit={onExit}
      onRefresh={embedded ? undefined : () => void refresh()} refreshing={loading || busy}>
      {staleStatus}
      <ToolPanel steps={steps} active={current} onSelect={select} numbered={false} label={t("copilot.p.tabs")}
        tools={<button type="button" className="panel-link copilot-why-link" onClick={() => openWhy()}>{t("copilot.why.title")}</button>}
        notices={((loading && !!state) || error || notice) && <>
          {loading && !!state && <div className="activity" role="status"><span className="activity-dot" aria-hidden="true" />{t("common.loading")}</div>}
          {error && <div className="stale-banner" role="alert">{error}{denied && <> {t("copilot.why.denied")} <button type="button" className="panel-link" onClick={() => openWhy()}>{t("copilot.why.link")}</button></>}</div>}
          {notice && <div className="demo" role="status">{notice}</div>}</>}
        footer={footer} sheet={sheet && sheets[sheet]()} aside={aside}>
        {buildView}
        {compareView}
        {detailView}
        {applyView}
        {followView_}
      </ToolPanel>
    </ServiceShell>
  );
}
