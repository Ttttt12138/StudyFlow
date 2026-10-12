import { percentToFraction } from "../loans/logic";
import type { DeltaKey, DiffEntry, ReadinessState, ScenarioInput } from "./types";

export const MONEY_PATTERN = /^\d{1,16}(\.\d{1,2})?$/;
export const MAX_SCENARIOS = 3;
export const MAX_COSTS = 20;
export const MAX_SUPPORT = 10;

export type CostRow = { key: string; cost_id: string; amount: string; effective_on: string };
export type SupportRow = { key: string; source_id: string; amount: string; available_on: string };
export type LoanForm = { principal: string; rate: string; fees: string; months: string; first_due_date: string; available_on: string };
export type ScenarioForm = { key: string; name: string; costs: CostRow[]; support: SupportRow[]; allowLoan: boolean; loan: LoanForm };
export type FormError = { code: string; n?: number };

export const emptyLoan = (): LoanForm => ({ principal: "", rate: "", fees: "", months: "", first_due_date: "", available_on: "" });

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** "4000" → "4000.00" by string padding, so the decimal string Django receives is exactly what was typed. */
export function toMoney(text: string): string | null {
  const value = text.trim();
  if (!MONEY_PATTERN.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return `${whole.replace(/^0+(?=\d)/, "")}.${fraction.padEnd(2, "0")}`;
}

/** Loan terms are all-or-nothing: Django needs every term plus the receipt date, or no loan at all. */
export function loanState(loan: LoanForm): "empty" | "partial" | "complete" {
  const filled = Object.values(loan).filter((v) => v.trim() !== "").length;
  return filled === 0 ? "empty" : filled === Object.keys(loan).length ? "complete" : "partial";
}

/** Client-side mirror of copilot/contracts.Scenario; returns the exact JSON scenario or the problems found. */
export function buildScenario(form: ScenarioForm): { scenario: ScenarioInput | null; errors: FormError[] } {
  const errors: FormError[] = [];
  const name = form.name.trim();
  if (!name || name.length > 100) errors.push({ code: "name" });
  if (form.costs.length > MAX_COSTS) errors.push({ code: "tooManyCosts" });
  if (form.support.length > MAX_SUPPORT) errors.push({ code: "tooManySupport" });
  const costs = form.costs.map((row, i) => {
    const amount = toMoney(row.amount);
    if (!row.cost_id) errors.push({ code: "costMissing", n: i + 1 });
    if (amount === null) errors.push({ code: "costAmount", n: i + 1 });
    if (!isIsoDate(row.effective_on)) errors.push({ code: "costDate", n: i + 1 });
    return { cost_id: row.cost_id, amount: amount ?? "", effective_on: row.effective_on };
  });
  if (new Set(costs.map((c) => c.cost_id)).size !== costs.length) errors.push({ code: "costDuplicate" });
  const family_support = form.support.map((row, i) => {
    const amount = toMoney(row.amount);
    if (amount === null || Number(amount) <= 0) errors.push({ code: "supportAmount", n: i + 1 });
    if (!isIsoDate(row.available_on)) errors.push({ code: "supportDate", n: i + 1 });
    return { ...(row.source_id ? { source_id: row.source_id } : {}), amount: amount ?? "", available_on: row.available_on };
  });
  const sources = form.support.map((r) => r.source_id).filter(Boolean);
  if (new Set(sources).size !== sources.length) errors.push({ code: "supportDuplicate" });

  const scenario: ScenarioInput = { name, ...(costs.length ? { costs } : {}), ...(family_support.length ? { family_support } : {}), allow_new_loan: form.allowLoan };
  const state = loanState(form.loan);
  if (state === "partial") errors.push({ code: "loanPartial" });
  if (state === "complete") {
    const l = form.loan;
    const principal = toMoney(l.principal), fees = toMoney(l.fees), annual_rate = percentToFraction(l.rate);
    const months = /^\d{1,2}$/.test(l.months.trim()) ? Number(l.months) : NaN;
    if (!form.allowLoan) errors.push({ code: "loanNotAllowed" });
    if (principal === null || Number(principal) <= 0) errors.push({ code: "loanPrincipal" });
    if (annual_rate === null) errors.push({ code: "loanRate" });
    if (fees === null || (principal !== null && Number(fees) >= Number(principal))) errors.push({ code: "loanFees" });
    if (!(months >= 1 && months <= 60)) errors.push({ code: "loanMonths" });
    if (!isIsoDate(l.first_due_date) || !isIsoDate(l.available_on) || l.first_due_date <= l.available_on) errors.push({ code: "loanDates" });
    scenario.loan = { currency: "THB", principal: principal ?? "", annual_rate: annual_rate ?? "", fees: fees ?? "", months, first_due_date: l.first_due_date };
    scenario.loan_available_on = l.available_on;
  }
  return { scenario: errors.length ? null : scenario, errors };
}

export function buildWhatIf(state: ReadinessState, forms: ScenarioForm[]) {
  const built = forms.slice(0, MAX_SCENARIOS).map(buildScenario);
  const errors = built.flatMap((b, index) => b.errors.map((e) => ({ ...e, scenario: index })));
  if (forms.length === 0) errors.push({ code: "noScenario", scenario: 0 });
  const body = errors.length ? null : {
    semester_id: state.semester_id, state_version: state.state_version, budget_version: state.budget_version,
    analysis_version: state.analysis_version, scenarios: built.map((b) => b.scenario!),
  };
  return { body, errors };
}

/** Lower is better for gaps, spending and borrowing; higher is better for the minimum balance. */
export function deltaTone(key: DeltaKey, delta: string | undefined): "better" | "worse" | "same" {
  const value = Number(delta);
  if (!delta || !Number.isFinite(value) || value === 0) return "same";
  return (key === "minimum_balance" ? value > 0 : value < 0) ? "better" : "worse";
}

export function signed(delta: string): string {
  return Number(delta) > 0 && !delta.startsWith("+") ? `+${delta}` : delta;
}

export const KNOWN_CONDITIONS = ["CONTRACT_CHANGE_REQUIRES_REVIEW", "HYPOTHETICAL_FUNDING_NOT_SETTLED"] as const;
/** "CONTRACT_CHANGE_REQUIRES_REVIEW:housing" → the message key plus the cost it names; unknown codes are shown raw. */
export function conditionLabel(condition: string): { key: string | null; cost?: string; raw: string } {
  const [code, ...rest] = condition.split(":");
  if (!(KNOWN_CONDITIONS as readonly string[]).includes(code)) return { key: null, raw: condition };
  return { key: `copilot.cond.${code}`, ...(rest.length ? { cost: rest.join(":") } : {}), raw: condition };
}

const TONES: Record<string, string> = {
  EXECUTED: "ok", CACHED: "ok", OBSERVED: "ok", ALLOWED: "ok", AFFORDABLE: "ok", RESOLVED: "completed", APPLIED: "completed",
  MOCK: "pending", RETRY: "pending", REVIEW_REQUIRED: "pending", INSUFFICIENT_DATA: "pending", OPEN: "pending", WAITING_INFORMATION: "pending", PENDING: "pending",
  IN_PROGRESS: "running", FAILED: "failed", BLOCKED: "denied", UNAFFORDABLE: "failed", REJECTED: "rejected",
};
export const tone = (status: string | null | undefined) => (status && TONES[status]) || "neutral";

/** A cost diff's after-value keeps the original amount; the dated change is the override that was added. */
export function costChange(entry: DiffEntry) {
  const before = (entry.before ?? {}) as { amount?: string | null; lower?: string | null; upper?: string | null };
  const after = (entry.after ?? {}) as { planned_overrides?: { amount: string; effective_on: string }[] };
  const override = after.planned_overrides?.[after.planned_overrides.length - 1];
  return { cost_id: String(entry.id ?? ""), before: before.amount ?? null, lower: before.lower ?? null, upper: before.upper ?? null,
    amount: override?.amount ?? null, effective_on: override?.effective_on ?? null };
}

/** Bar widths for the monthly minimum-balance chart, scaled to the largest absolute balance across all columns. */
export function barScale(values: string[]): (value: string) => number {
  const max = Math.max(0, ...values.map((v) => Math.abs(Number(v)) || 0));
  return (value) => max === 0 ? 0 : Math.round((Math.abs(Number(value)) || 0) / max * 100);
}

export function defaultDate(asOf: string | undefined, today = new Date().toISOString().slice(0, 10)): string {
  return asOf && asOf > today ? asOf : today;
}

/** Unread first, then newest first. */
export function sortNotifications<T extends { read_at: string | null; created_at: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => Number(!!a.read_at) - Number(!!b.read_at) || b.created_at.localeCompare(a.created_at));
}

export function issueText(issue: unknown): string {
  if (typeof issue === "string") return issue;
  if (issue && typeof issue === "object") {
    const o = issue as Record<string, unknown>;
    for (const k of ["message", "detail", "code", "label"]) if (typeof o[k] === "string") return o[k] as string;
  }
  return JSON.stringify(issue);
}

/** Inputs Django saved for a run (contract dump) can be posted again verbatim to re-run a stale comparison. */
export function rerunScenarios(saved: (ScenarioInput | undefined)[]): ScenarioInput[] {
  return saved.filter((s): s is ScenarioInput => !!s);
}
