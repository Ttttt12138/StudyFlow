import { useToolRefresh, useToolActive, useClearWhenHidden, useWorkspace } from "../workspace/context";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ServiceShell, ServiceSection } from "../services/ServiceShell";
import { TierBadge } from "../services/TierBadge";
import { formatDate, formatMoney } from "../backend/presenters";
import { fractionToPercent } from "../loans/logic";
import { intlLocale, useI18n, type MessageKey } from "../i18n";
import { SessionWalletClient, WalletApiError, type WalletClient } from "../wallet/client";
import { loadCopilot } from "./client";
import { barScale, buildWhatIf, conditionLabel, costChange, defaultDate, deltaTone, emptyLoan, issueText, MAX_COSTS, MAX_SCENARIOS, MAX_SUPPORT,
  rerunScenarios, tone, type FormError, type ScenarioForm } from "./logic";
import { createCopilotPreview, previewApplyPreview, previewReview, previewRun, previewTrace } from "./previewAdapter";
import type { ApplyPreview, ApplyResult, Cost, CopilotSnapshot, DeltaKey, DiffEntry, Explanation, Layer, Notification, ReviewHistory, ReviewItem,
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
const humanize = (text: string) => text ? text.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : "—";
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

export function CopilotApp({ preview, onExit }: { preview: boolean; onExit: () => void }) {
  const { lang, t } = useI18n();
  const toolActive = useToolActive();
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
    setRun(next); setPlan(null); setPlanCheck(false);
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

  async function submit(scenarios: ScenarioInput[] | null) {
    const fresh = (await refresh()).state;
    if (!fresh) { setError(snapshot.errors.state ?? t("copilot.err.noState")); return; }
    let body: object;
    if (scenarios) body = { semester_id: fresh.semester_id, state_version: fresh.state_version, budget_version: fresh.budget_version, analysis_version: fresh.analysis_version, scenarios };
    else {
      const built = buildWhatIf(fresh, forms);
      setFormErrors(built.errors);
      if (!built.body) { setError(t("copilot.err.form")); return; }
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
    setNotice(t("copilot.notice.compared"));
  }

  async function compare() {
    if (!state) return;
    const local = buildWhatIf(state, forms);
    setFormErrors(local.errors);
    if (!local.body) { setError(t("copilot.err.form")); return; }
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
      setPlan(result); setPlanCheck(false); setApplied(null);
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
    setTraceInput(id); setTraceError("");
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
    return <article key={name} className="copilot-layer" aria-labelledby={`layer-${name}`}>
      <div className="service-title-row"><h3 id={`layer-${name}`}>{t(`copilot.layer.${name}` as MessageKey)}</h3>{chip(status, t(`copilot.layerStatus.${status}` as MessageKey))}</div>
      <p className="service-muted">{t(`copilot.layer.${name}.text` as MessageKey)}</p>
      <dl className="comparison-facts">
        {layer?.decision && <div><dt>{t("copilot.why.decision")}</dt><dd>{chip(layer.decision, t(`copilot.decision.${layer.decision}` as MessageKey))}</dd></div>}
        {layer?.calls && layer.calls.length > 0 && <div><dt>{t("copilot.why.calls")}</dt><dd>{layer.calls.map((c) => [c.provider, c.mode, c.error_code].filter(Boolean).join(" · ")).join("; ")}</dd></div>}
        {layer?.route && <div><dt>{t("copilot.why.route")}</dt><dd><code>{layer.route}</code>{layer.http_status ? ` · HTTP ${layer.http_status}` : ""}</dd></div>}
        {layer?.error_code && <div><dt>{t("copilot.why.errorCode")}</dt><dd><code>{layer.error_code}</code></dd></div>}
        {layer?.engine_version && <div><dt>{t("copilot.why.engine")}</dt><dd>{layer.engine_version}</dd></div>}
      </dl>
      {layer?.calls_are_original && <p className="service-muted">{t("copilot.why.cached")}</p>}
      {rulesView(layer?.rules) && <><h4>{t("copilot.why.rules")}</h4>{rulesView(layer?.rules)}</>}
      {layer?.formulas && <><h4>{t("copilot.why.formulas")}</h4><ul>{Object.entries(layer.formulas).map(([k, v]) => <li key={k}><code>{k} = {v}</code></li>)}</ul></>}
      {layer?.events && layer.events.length > 0 && <><h4>{t("copilot.why.events")}</h4><ul>{layer.events.map((e, i) => <li key={i}>{when(e.timestamp)} · <code>{e.action}</code>{e.decision ? ` · ${t(`copilot.decision.${e.decision}` as MessageKey)}` : ""}</li>)}</ul></>}
      {layer?.next_action && <p className="service-notice">{t("copilot.why.next", { action: layer.next_action })}</p>}
      {technical && <details className="copilot-details"><summary>{t("copilot.why.technical")}</summary><pre>{technical.length > 4000 ? `${technical.slice(0, 4000)}…` : technical}</pre></details>}
    </article>;
  };
  const columns: ScenarioResult[] = run ? [run.baseline, ...run.scenarios] : [];
  const scale = barScale(columns.flatMap((c) => (c.monthly ?? []).map((m) => m.minimum_balance)));
  const metricRows: { k: keyof ScenarioResult; label: string; kind: "money" | "date" | "bool"; delta?: DeltaKey }[] = [
    { k: "maximum_reserve_gap", label: t("copilot.m.gap"), kind: "money", delta: "maximum_reserve_gap" },
    { k: "minimum_balance", label: t("copilot.m.min"), kind: "money", delta: "minimum_balance" },
    { k: "first_below_reserve", label: t("copilot.m.below"), kind: "date" },
    { k: "first_negative_date", label: t("copilot.m.negative"), kind: "date" },
    { k: "remaining_expenses", label: t("copilot.m.remaining"), kind: "money", delta: "remaining_expenses" },
    { k: "semester_funding_gap", label: t("copilot.m.semester"), kind: "money" },
    { k: "loan_needed", label: t("copilot.m.loanNeeded"), kind: "money", delta: "loan_needed" },
    { k: "unmet_gap", label: t("copilot.m.unmet"), kind: "money" },
    { k: "complete", label: t("copilot.m.complete"), kind: "bool" },
  ];
  const cell = (s: ScenarioResult, row: (typeof metricRows)[number]) => {
    const value = s[row.k];
    return row.kind === "money" ? money(value) : row.kind === "date" ? date(value) : t(value ? "copilot.m.completeYes" : "copilot.m.completeNo");
  };
  const unread = snapshot.notifications.filter((n) => !n.read_at).length;
  const errorsFor = (index: number) => formErrors.filter((e) => e.scenario === index);

  const sections = [
    { id: "copilot-build", label: t("copilot.build.title") }, { id: "copilot-results", label: t("copilot.results.title") },
    { id: "copilot-apply", label: t("copilot.apply.title") }, { id: "copilot-why", label: t("copilot.why.title") },
    { id: "copilot-review", label: t("copilot.review.title") }, { id: "copilot-notifications", label: t("copilot.notif.title") },
  ];

  const staleStatus = useToolRefresh(() => refresh());
  return (
    <ServiceShell className="copilot-app" eyebrow={t("copilot.eyebrow")} title={t("copilot.title")} intro={t("copilot.intro")} sideLabel={t("copilot.side.label")}
      sections={sections} noteTitle={t("copilot.side.noteTitle")} noteText={t("copilot.side.noteText")} preview={preview}
      previewTitle={t("copilot.preview.title")} previewText={t("copilot.preview.text")} bannerText={t("copilot.banner.text")}
      signedOut={signedOut} signInUrl={signInUrl} signedOutText={t("copilot.signedOut")} onExit={onExit}
      onRefresh={() => void refresh()} refreshing={loading || busy}>
      {staleStatus}
      {loading && <div className="activity" role="status"><span className="activity-dot" aria-hidden="true" />{t("common.loading")}</div>}
      {error && <div className="stale-banner" role="alert">{error}{denied && <> {t("copilot.why.denied")} <a href="#copilot-why">{t("copilot.why.link")}</a></>}</div>}
      {notice && <div className="demo" role="status">{notice}</div>}

      <ServiceSection id="copilot-build" title={t("copilot.build.title")} text={t("copilot.build.text")} tier={<TierBadge tier="T0" />}>
        {snapshot.errors.state && !signedOut && <p className="error">{snapshot.errors.state}</p>}
        {state && <p className="service-muted">{t("copilot.build.versions", { state: state.state_version, budget: state.budget_version, analysis: state.analysis_version })}</p>}
        <div className="copilot-forms">
          {forms.map((form, index) => {
            const problems = errorsFor(index);
            return <fieldset key={form.key} className="copilot-form">
              <legend>{t("copilot.form.legend", { n: index + 1 })}</legend>
              <label className="copilot-field">{t("copilot.form.name")}<input value={form.name} maxLength={100} disabled={preview} placeholder={t("copilot.form.namePlaceholder")}
                onChange={(e) => editForm(index, { name: e.target.value })} /></label>

              <h3>{t("copilot.form.costs")}</h3>
              {form.costs.length === 0 && <p className="service-muted">{t("copilot.form.noCosts")}</p>}
              {form.costs.map((row, n) => {
                const cost = costs.find((c) => c.cost_id === row.cost_id);
                const patch = (p: Partial<typeof row>) => editForm(index, { costs: form.costs.map((r) => r.key === row.key ? { ...r, ...p } : r) });
                return <div key={row.key} className="copilot-row" role="group" aria-label={t("copilot.form.costRow", { n: n + 1 })}>
                  <label className="copilot-field">{t("copilot.form.cost")}<select value={row.cost_id} disabled={preview} onChange={(e) => patch({ cost_id: e.target.value })}>
                    <option value="">{t("copilot.form.pickCost")}</option>
                    {(preview ? costs : editable).map((c) => <option key={c.cost_id} value={c.cost_id}>{costName(c.cost_id)}</option>)}
                  </select></label>
                  <p className="copilot-current">{t("copilot.form.current", { amount: costAmount(cost) })}{isProtected(cost) && <> · <strong>{t("copilot.form.protected")}</strong></>}</p>
                  <label className="copilot-field">{t("copilot.form.newAmount")}<input inputMode="decimal" value={row.amount} disabled={preview} onChange={(e) => patch({ amount: e.target.value })} /></label>
                  <label className="copilot-field">{t("copilot.form.effective")}<input type="date" value={row.effective_on} disabled={preview} onChange={(e) => patch({ effective_on: e.target.value })} /></label>
                  <button type="button" className="secondary" disabled={preview} onClick={() => editForm(index, { costs: form.costs.filter((r) => r.key !== row.key) })}>{t("copilot.form.remove")}</button>
                </div>;
              })}
              <button type="button" className="secondary" disabled={preview || form.costs.length >= MAX_COSTS || editable.length === 0}
                onClick={() => editForm(index, { costs: [...form.costs, { key: key(), cost_id: "", amount: "", effective_on: today }] })}>{t("copilot.form.addCost")}</button>

              <h3>{t("copilot.form.support")}</h3>
              {form.support.length === 0 && <p className="service-muted">{t("copilot.form.noSupport")}</p>}
              {form.support.map((row, n) => {
                const patch = (p: Partial<typeof row>) => editForm(index, { support: form.support.map((r) => r.key === row.key ? { ...r, ...p } : r) });
                return <div key={row.key} className="copilot-row" role="group" aria-label={t("copilot.form.supportRow", { n: n + 1 })}>
                  <label className="copilot-field">{t("copilot.form.source")}<select value={row.source_id} disabled={preview} onChange={(e) => patch({ source_id: e.target.value })}>
                    <option value="">{t("copilot.form.newSource")}</option>
                    {sources.map((s) => <option key={s.id} value={s.id}>{t("copilot.form.replaceSource", { amount: money(s.amount), date: date(s.available_on) })}</option>)}
                  </select></label>
                  <label className="copilot-field">{t("copilot.form.amount")}<input inputMode="decimal" value={row.amount} disabled={preview} onChange={(e) => patch({ amount: e.target.value })} /></label>
                  <label className="copilot-field">{t("copilot.form.availableOn")}<input type="date" value={row.available_on} disabled={preview} onChange={(e) => patch({ available_on: e.target.value })} /></label>
                  <button type="button" className="secondary" disabled={preview} onClick={() => editForm(index, { support: form.support.filter((r) => r.key !== row.key) })}>{t("copilot.form.remove")}</button>
                </div>;
              })}
              <button type="button" className="secondary" disabled={preview || form.support.length >= MAX_SUPPORT}
                onClick={() => editForm(index, { support: [...form.support, { key: key(), source_id: "", amount: "", available_on: today }] })}>{t("copilot.form.addSupport")}</button>

              <h3>{t("copilot.form.loanTitle")}</h3>
              <label className="wallet-confirm"><input type="checkbox" checked={form.allowLoan} disabled={preview} onChange={(e) => editForm(index, { allowLoan: e.target.checked })} />{t("copilot.form.allowLoan")}</label>
              <p className="service-muted">{t("copilot.form.loanHint")}</p>
              <div className="copilot-loan">
                {([["principal", "copilot.form.principal", "decimal"], ["rate", "copilot.form.rate", "decimal"], ["fees", "copilot.form.fees", "decimal"], ["months", "copilot.form.months", "numeric"],
                  ["available_on", "copilot.form.loanAvailable", "date"], ["first_due_date", "copilot.form.firstDue", "date"]] as const).map(([field, label, mode]) =>
                  <label key={field} className="copilot-field">{t(label)}<input type={mode === "date" ? "date" : "text"} inputMode={mode === "date" ? undefined : mode} value={form.loan[field]}
                    disabled={preview || !form.allowLoan} onChange={(e) => editForm(index, { loan: { ...form.loan, [field]: e.target.value } })} /></label>)}
              </div>
              {problems.length > 0 && <ul className="error copilot-problems" role="alert">{problems.map((p, i) => <li key={i}>{t(`copilot.err.f.${p.code}` as MessageKey, { n: p.n ?? "" })}</li>)}</ul>}
              {forms.length > 1 && <button type="button" className="secondary" disabled={preview} onClick={() => { setForms(forms.filter((f) => f.key !== form.key)); setFormErrors([]); }}>{t("copilot.form.removeScenario")}</button>}
            </fieldset>;
          })}
        </div>
        <div className="service-actions">
          <button type="button" className="secondary" disabled={preview || forms.length >= MAX_SCENARIOS} onClick={() => setForms([...forms, newForm()])}>{t("copilot.form.addScenario")}</button>
          <button type="button" className="primary" disabled={preview || busy || !state} onClick={() => void compare()}>{t("copilot.form.compare")}</button>
        </div>
        <p className="service-muted">{t("copilot.build.noMoney")}</p>
      </ServiceSection>

      <ServiceSection id="copilot-results" title={t("copilot.results.title")} text={t("copilot.results.text")}>
        {!run ? <p>{t("copilot.results.none")}</p> : <>
          {run.stale && <div className="service-alert copilot-stale" role="status">{t("copilot.results.stale")}
            <button type="button" className="secondary" disabled={preview || busy} onClick={() => void rerun()}>{t("copilot.results.rerun")}</button></div>}
          <div className="table-scroll"><table className="service-table copilot-table">
            <caption className="service-muted">{t("copilot.results.caption")}</caption>
            <thead><tr><th scope="col">{t("copilot.results.metric")}</th>{columns.map((c, i) => <th key={i} scope="col">{i === 0 ? t("copilot.results.baseline") : c.name}</th>)}</tr></thead>
            <tbody>{metricRows.map((row) => <tr key={row.k}><th scope="row">{row.label}</th>{columns.map((c, i) => <td key={i}>
              {cell(c, row)}{i > 0 && row.delta && <><br />{deltaView(row.delta, c.delta?.[row.delta])}</>}
            </td>)}</tr>)}</tbody>
          </table></div>
          <p className="service-muted">{t("copilot.results.legend")}</p>
          <div className="copilot-cards">
            {columns.map((s, i) => <article key={i} className="copilot-card" aria-labelledby={`result-${i}`}>
              <h3 id={`result-${i}`}>{i === 0 ? t("copilot.results.baseline") : s.name}</h3>
              {s.conditional ? <><p className="service-muted">{t("copilot.results.conditional")}</p>
                <ul className="copilot-conditions">{s.conditions.map((c) => <li key={c}>{chip("PENDING", t("copilot.results.condition"))} {conditionText(c)}</li>)}</ul></>
                : <p className="service-muted">{t("copilot.results.unconditional")}</p>}
              <h4>{t("copilot.results.confirmed")}</h4>
              <p className="service-muted">{t("copilot.results.confirmedText")}</p>
              <dl className="comparison-facts">
                <div><dt>{t("copilot.m.gap")}</dt><dd>{money(s.confirmed.maximum_reserve_gap)}</dd></div>
                <div><dt>{t("copilot.m.min")}</dt><dd>{money(s.confirmed.minimum_balance)}</dd></div>
                <div><dt>{t("copilot.m.negative")}</dt><dd>{date(s.confirmed.first_negative_date)}</dd></div>
                <div><dt>{t("copilot.m.semester")}</dt><dd>{money(s.confirmed.semester_funding_gap)}</dd></div>
              </dl>
              {s.loan && <><h4>{t("copilot.loan.title")}</h4><dl className="comparison-facts">
                <div><dt>{t("copilot.loan.net")}</dt><dd>{money(s.loan.net_proceeds)}</dd></div>
                <div><dt>{t("copilot.loan.interest")}</dt><dd>{money(s.loan.total_interest)}</dd></div>
                <div><dt>{t("copilot.loan.fees")}</dt><dd>{money(s.loan.fees)}</dd></div>
                <div><dt>{t("copilot.loan.max")}</dt><dd>{money(s.loan.maximum_installment)}</dd></div>
                <div><dt>{t("copilot.loan.count")}</dt><dd>{s.loan.repayments.length}</dd></div>
                <div><dt>{t("copilot.loan.afford")}</dt><dd>{s.loan.affordability ? chip(s.loan.affordability.status, t(`copilot.afford.${s.loan.affordability.status}` as MessageKey)) : "—"}</dd></div>
              </dl>
              {!!s.loan.affordability?.missing_inputs?.length && <p className="service-muted">{t("copilot.loan.missing", { months: [...new Set(s.loan.affordability.missing_inputs.map((m) => m.slice(0, 7)))].join(", ") })}</p>}
              {!!s.loan.affordability?.shortfall_months?.length && <p className="service-muted">{t("copilot.loan.shortfall", { months: s.loan.affordability.shortfall_months.join(", ") })}</p>}</>}
              {!!s.issues?.length && <><h4>{t("copilot.results.issues")}</h4><ul>{s.issues.map((issue, n) => <li key={n}>{issueText(issue)}</li>)}</ul></>}
              {!!s.monthly?.length && <><h4>{t("copilot.chart.title")}</h4>
                <ul className="copilot-bars" aria-label={t("copilot.chart.label")}>{s.monthly.map((m) => <li key={m.month}>
                  <span className="copilot-bar-month">{m.month}</span>
                  <span className="copilot-bar" aria-hidden="true"><span className={Number(m.minimum_balance) < 0 ? "copilot-bar-negative" : ""} style={{ width: `${scale(m.minimum_balance)}%` }} /></span>
                  <span className="copilot-bar-value">{money(m.minimum_balance)}</span>
                </li>)}</ul></>}
              {i > 0 && <div className="service-actions">
                <button type="button" className="secondary" disabled={preview || busy || run.applied_index !== null} onClick={() => void previewApply(i - 1)}>{t("copilot.apply.previewButton")}</button>
              </div>}
            </article>)}
          </div>
          <div className="service-actions">
            <button type="button" className="link-button" onClick={() => { void explain(run.id); document.getElementById("copilot-why")?.scrollIntoView?.(); }} disabled={preview}>{t("copilot.why.explainRun")}</button>
          </div>
        </>}
      </ServiceSection>

      <ServiceSection id="copilot-apply" title={t("copilot.apply.title")} text={t("copilot.apply.text")} tier={<TierBadge tier="T1" />}>
        {!run && <p>{t("copilot.apply.none")}</p>}
        {run && run.applied_index !== null && !applied && <p className="service-notice">{t("copilot.apply.already", { name: run.scenarios[run.applied_index]?.name ?? "" })}</p>}
        {run && !plan && !applied && run.applied_index === null && <p className="service-muted">{t("copilot.apply.pick")}</p>}
        {plan && run && <div className="copilot-plan">
          <h3>{t("copilot.apply.planFor", { name: run.scenarios[plan.scenario_index]?.name ?? "" })}</h3>
          <div className="table-scroll"><table className="service-table">
            <thead><tr><th scope="col">{t("copilot.apply.change")}</th><th scope="col">{t("copilot.apply.before")}</th><th scope="col">{t("copilot.apply.after")}</th></tr></thead>
            <tbody>{plan.diff.map((entry, i) => { const v = diffView(entry); return <tr key={i}><th scope="row">{v.what}</th><td>{v.before}</td><td>{v.after}</td></tr>; })}</tbody>
          </table></div>
          {plan.diff.length === 0 && <p className="service-muted">{t("copilot.apply.noChanges")}</p>}
          {plan.blockers.length > 0 && <div className="service-alert" role="status">
            <h4>{t("copilot.apply.blocked")}</h4>
            <ul>{plan.blockers.map((b) => <li key={b.cost_id}>{t("copilot.apply.blocker", { cost: costName(b.cost_id), before: costAmount(b.before), amount: money(b.proposed.amount) })}</li>)}</ul>
            <p>{t("copilot.apply.blockedText")} <a href="#copilot-review">{t("copilot.apply.reviewLink")}</a></p>
          </div>}
          {plan.confirmation && <div className="service-policy">
            <h4><TierBadge tier="T1" /> {t("copilot.confirm.title")}</h4>
            <ul className="copilot-checklist">
              {plan.diff.map((entry, i) => <li key={i}>{diffView(entry).confirm}</li>)}
              <li><strong>{t("copilot.confirm.noMoney")}</strong></li>
            </ul>
            <p className="service-muted">{t("copilot.confirm.expires", { minutes: Math.round(plan.expires_in_seconds / 60) })}</p>
            <label className="wallet-confirm"><input type="checkbox" checked={planCheck} disabled={preview} onChange={(e) => setPlanCheck(e.target.checked)} />{t("copilot.confirm.check")}</label>
            <div className="service-actions">
              <button type="button" className="primary" disabled={preview || busy || !planCheck} onClick={() => void apply()}>{t("copilot.confirm.button")}</button>
              <button type="button" className="secondary" disabled={busy} onClick={() => { setPlan(null); setPlanCheck(false); }}>{t("copilot.confirm.cancel")}</button>
            </div>
          </div>}
        </div>}
        {applied && <div className="copilot-applied" role="status">
          <h3>{chip("APPLIED", t("copilot.applied.status"))} {t("copilot.applied.title")}</h3>
          <p className="service-muted">{t("copilot.applied.versions", { before: String(applied.before?.state_version ?? "—"), after: String(applied.after?.state_version ?? "—"),
            budgetBefore: String(applied.before?.budget_version ?? "—"), budgetAfter: String(applied.after?.budget_version ?? "—") })}</p>
          {applied.diff.length > 0 && <ul>{applied.diff.map((entry, i) => <li key={i}>{diffView(entry).confirm}</li>)}</ul>}
          {applied.support_requests.length > 0 && <p>{t("copilot.applied.support", { count: applied.support_requests.length })} <a href="?family=1">{t("copilot.applied.familyLink")}</a></p>}
          {applied.loan && <p>{t("copilot.applied.loan", { id: applied.loan.application.id.slice(0, 8) })} <a href="?loans=1">{t("copilot.applied.loansLink")}</a></p>}
          <p className="service-muted">{t("copilot.applied.noMoney")}</p>
        </div>}
      </ServiceSection>

      <ServiceSection id="copilot-why" title={t("copilot.why.title")} text={t("copilot.why.text")} tier={<TierBadge tier="T0" />}>
        <form className="wallet-form-row copilot-trace" onSubmit={(e) => { e.preventDefault(); void explain(traceInput); }}>
          <label className="copilot-field">{t("copilot.why.trace")}<input value={traceInput} disabled={preview} onChange={(e) => setTraceInput(e.target.value)} /></label>
          <button type="submit" className="secondary" disabled={preview}>{t("copilot.why.lookup")}</button>
        </form>
        <p className="service-muted">{t("copilot.why.hint")}</p>
        {traceError && <p className="error" role="alert">{traceError}</p>}
        {explanation && <>
          <p className="service-muted">{t("copilot.why.recorded", { id: explanation.trace_id, date: when(explanation.created_at) })}</p>
          <div className="copilot-layers">{LAYERS.map((name) => layerView(name, explanation.layers[name]))}</div>
        </>}
      </ServiceSection>

      <ServiceSection id="copilot-review" title={t("copilot.review.title")} text={t("copilot.review.text")} tier={<TierBadge tier="T1" />}>
        {snapshot.errors.reviews && !signedOut && <p className="error">{snapshot.errors.reviews}</p>}
        {snapshot.reviews.length === 0 ? <p>{t("copilot.review.none")}</p> : <div className="copilot-cards">
          {snapshot.reviews.map((item) => {
            const blockers = Array.isArray(item.details.blockers) ? item.details.blockers as { cost_id: string; proposed?: { amount: string } }[] : [];
            const next = typeof item.details.next_action === "string" ? item.details.next_action : "";
            return <article key={item.id} className="copilot-card" aria-labelledby={`review-${item.id}`}>
              <div className="service-title-row">
                <h3 id={`review-${item.id}`}>{REVIEW_KINDS.includes(item.kind) ? t(`copilot.review.kind.${item.kind}` as MessageKey) : humanize(item.kind)}</h3>
                {chip(item.status, t(`copilot.review.status.${item.status}` as MessageKey))}
              </div>
              <p className="service-muted">{t("copilot.review.updated", { date: when(item.updated_at), version: item.version })}</p>
              {item.kind === "protected_cost" && <p>{t("copilot.review.protectedText")}</p>}
              {blockers.length > 0 && <ul>{blockers.map((b) => <li key={b.cost_id}>{t("copilot.review.blocker", { cost: costName(b.cost_id), amount: money(b.proposed?.amount) })}</li>)}</ul>}
              {next && <p className="service-notice">{t("copilot.why.next", { action: next })}</p>}
              <details className="copilot-details" onToggle={(e) => { if ((e.target as HTMLDetailsElement).open && !histories[item.id]) void loadHistory(item); }} open={!!histories[item.id] && preview}>
                <summary>{t("copilot.review.history")}</summary>
                {!histories[item.id] ? <p className="service-muted">{t("common.loading")}</p> : histories[item.id].length === 0 ? <p className="service-muted">{t("copilot.review.noHistory")}</p>
                  : <ul>{histories[item.id].map((h) => <li key={h.id}>{when(h.created_at)} · {humanize(h.action)}{h.before?.status && h.after?.status ? ` · ${h.before.status} → ${h.after.status}` : ""} — {h.reason}</li>)}</ul>}
              </details>
              {item.status !== "RESOLVED" && <div className="copilot-recheck">
                <label className="copilot-field">{t("copilot.review.reason")}<input value={reasons[item.id] ?? ""} maxLength={500} disabled={preview}
                  onChange={(e) => setReasons({ ...reasons, [item.id]: e.target.value })} /></label>
                <button type="button" className="secondary" disabled={preview || busy} onClick={() => void recheck(item)}>{t("copilot.review.recheck")}</button>
              </div>}
            </article>;
          })}
        </div>}
      </ServiceSection>

      <ServiceSection id="copilot-notifications" title={t("copilot.notif.title")} text={t("copilot.notif.text", { count: unread })}>
        {snapshot.errors.notifications && !signedOut && <p className="error">{snapshot.errors.notifications}</p>}
        {snapshot.notifications.length === 0 ? <p>{t("copilot.notif.none")}</p> : <ul className="service-list copilot-notifications">
          {snapshot.notifications.map((n) => <li key={n.id} className={n.read_at ? "" : "copilot-unread"}>
            <div className="service-title-row">
              <strong>{humanize(n.payload?.kind ?? "")} · {humanize(n.transition.toLowerCase())}</strong>
              {n.read_at ? chip("RESOLVED", t("copilot.notif.read")) : chip("PENDING", t("copilot.notif.unread"))}
            </div>
            <span className="service-muted">{when(n.created_at)}</span>
            {!n.read_at && <div className="service-actions"><button type="button" className="secondary" disabled={preview || busy} onClick={() => void markRead(n)}>{t("copilot.notif.markRead")}</button></div>}
          </li>)}
        </ul>}
      </ServiceSection>
    </ServiceShell>
  );
}
