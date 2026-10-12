import type { CheckJob, Coverage, PreviewRow, RowIssue } from "./types";

/** Rows ticked when an import opens: valid rows that are neither exact nor suspected duplicates. */
export function defaultSelection(rows: PreviewRow[]): string[] {
  return rows.filter((row) => (row.status ?? "READY") === "READY" && !row.duplicate && !row.suspected_duplicate).map((row) => row.locator);
}

export type CoverageDraft = Record<string, Partial<Coverage>>;

/** Coverage per account in the selection: min/max date of its selected rows, never ending after the demo clock. */
export function coverageDefaults(rows: PreviewRow[], selected: Iterable<string>, today: string | null): Record<string, { start: string; end: string }> {
  const chosen = new Set(selected);
  const result: Record<string, { start: string; end: string }> = {};
  for (const row of rows) {
    if (!chosen.has(row.locator)) continue;
    const scope = result[row.account_id];
    if (!scope) result[row.account_id] = { start: row.date, end: row.date };
    else { if (row.date < scope.start) scope.start = row.date; if (row.date > scope.end) scope.end = row.date; }
  }
  if (today) for (const scope of Object.values(result)) if (scope.end > today) scope.end = today;
  return result;
}

/** The confirm body Django expects (consumption/serializers.ConfirmInput); edits in `draft` override the defaults. */
export function confirmBody(rows: PreviewRow[], selected: Iterable<string>, kept: Iterable<string>, draft: CoverageDraft, today: string | null) {
  const chosen = new Set(selected), keep = new Set(kept);
  const defaults = coverageDefaults(rows, chosen, today);
  const ordered = rows.filter((row) => chosen.has(row.locator));
  return {
    selected_rows: ordered.map((row) => row.locator),
    keep_similar_rows: ordered.filter((row) => row.suspected_duplicate && keep.has(row.locator)).map((row) => row.locator),
    coverage: Object.entries(defaults).map(([account_id, scope]): Coverage => ({
      account_id, start: draft[account_id]?.start || scope.start, end: draft[account_id]?.end || scope.end, complete: !!draft[account_id]?.complete,
    })),
  };
}

export type CoverageProblem = "ORDER" | "FUTURE" | "OUTSIDE" | "ERROR_ROWS" | "PARTIAL";

/** Client-side mirror of imports.confirm's checks, so the student sees why before sending. */
export function coverageProblems(rows: PreviewRow[], issues: RowIssue[], selected: Iterable<string>, coverage: Coverage[], today: string | null): Record<string, CoverageProblem[]> {
  const chosen = new Set(selected);
  const result: Record<string, CoverageProblem[]> = {};
  for (const scope of coverage) {
    const problems: CoverageProblem[] = [];
    const account = rows.filter((row) => row.account_id === scope.account_id);
    if (scope.end < scope.start) problems.push("ORDER");
    if (today && scope.end > today) problems.push("FUTURE");
    if (account.some((row) => chosen.has(row.locator) && (row.date < scope.start || row.date > scope.end))) problems.push("OUTSIDE");
    if (scope.complete && issues.length) problems.push("ERROR_ROWS");
    if (scope.complete && account.some((row) => !chosen.has(row.locator) && row.date >= scope.start && row.date <= scope.end)) problems.push("PARTIAL");
    if (problems.length) result[scope.account_id] = problems;
  }
  return result;
}

/** Suspected duplicates without a transaction id are refused (REVIEW_SIMILAR_TRANSACTION) unless kept on purpose. */
export function unkeptSimilar(rows: PreviewRow[], selected: Iterable<string>, kept: Iterable<string>): string[] {
  const chosen = new Set(selected), keep = new Set(kept);
  return rows.filter((row) => row.suspected_duplicate && !row.transaction_id && chosen.has(row.locator) && !keep.has(row.locator)).map((row) => row.locator);
}

/** Waits between check-status reads: doubling from 1 s, capped at 10 s, giving up after about a minute in total. */
export function pollDelays(limitMs = 60_000, firstMs = 1_000, maxMs = 10_000): number[] {
  const delays: number[] = [];
  let next = firstMs, total = 0;
  while (total < limitMs) {
    const delay = Math.min(next, maxMs, limitMs - total);
    delays.push(delay); total += delay; next = Math.min(next * 2, maxMs);
  }
  return delays;
}

/** The recalculation triggered by a confirm: the newest check job covering at least that analysis version. */
export function recalculationJob(jobs: CheckJob[], analysisVersion: number): CheckJob | null {
  return [...jobs].filter((job) => (job.payload?.analysis_version ?? -1) >= analysisVersion)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
}

export const isFinished = (job: CheckJob | null) => !!job && (job.status === "DONE" || job.status === "RETRY");

export const RISK_KINDS = ["repayment_liquidity", "cashflow_gap", "sponsor_delayed", "spending_increased", "overdue_obligations", "data_stale", "semester_gap", "liquidity", "missing_information"] as const;
export type RiskKind = (typeof RISK_KINDS)[number] | "unknown";
export function riskKind(kind: string): RiskKind {
  return (RISK_KINDS as readonly string[]).includes(kind) ? kind as RiskKind : "unknown";
}

// File-level upload errors (studyflow_ai.parsing / bank_data). Some are not in Django's catalogue,
// which would otherwise fall back to the bare code.
export const CSV_ERRORS = ["CSV_MISSING_COLUMNS", "CSV_DUPLICATE_COLUMNS", "CSV_EMPTY", "CSV_ROW_LIMIT", "CSV_FIELD_LIMIT", "INVALID_UTF8", "FILE_SIZE_LIMIT"] as const;
export type CsvError = (typeof CSV_ERRORS)[number];
export function csvError(code: string): CsvError | null {
  return (CSV_ERRORS as readonly string[]).includes(code) ? code as CsvError : null;
}

/** Next-page link from a DRF page, as a path under /api/v2/ (same-host only, like getAll). */
export function nextPath(next: string | null, origin: string): string | null {
  if (!next) return null;
  const url = new URL(next, origin);
  if (url.host !== new URL(origin).host || !url.pathname.startsWith("/api/v2/")) return null;
  return url.pathname.slice("/api/v2/".length) + url.search;
}

/** "food" → "Food", "study_materials" → "Study materials" for costs without a translated name. */
export const humanize = (id: string) => id ? id[0].toUpperCase() + id.slice(1).replace(/_/g, " ") : id;
