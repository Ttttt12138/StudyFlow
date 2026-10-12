import { describe, expect, it } from "vitest";
import { confirmBody, coverageDefaults, coverageProblems, csvError, defaultSelection, nextPath, pollDelays, recalculationJob, riskKind, unkeptSimilar } from "./logic";
import type { CheckJob, PreviewRow } from "./types";

const row = (n: number, date: string, extra: Partial<PreviewRow> = {}): PreviewRow => ({
  locator: `row:${n}`, transaction_id: `t${n}`, account_id: "main", date, amount: "-100.00", currency: "THB", counterparty: "Cafe", description: "Food",
  status: "READY", duplicate: false, suspected_duplicate: false, classification: { category: "Food", basis: "food", confidence: 0.85 }, ...extra,
});
const rows = [
  row(2, "2026-07-05"), row(3, "2026-09-20"), row(4, "2026-08-01", { duplicate: true }),
  row(5, "2026-08-02", { suspected_duplicate: true, transaction_id: null }), row(6, "2026-08-03", { status: "ERROR" }),
  row(7, "2026-09-10", { account_id: "card" }), row(8, "2026-10-20", { account_id: "card" }),
];

describe("defaultSelection", () => {
  it("ticks ready rows that are neither duplicates nor suspected duplicates", () => {
    expect(defaultSelection(rows)).toEqual(["row:2", "row:3", "row:7", "row:8"]);
  });
  it("treats rows without a status as ready", () => {
    expect(defaultSelection([{ ...row(9, "2026-07-01"), status: undefined }])).toEqual(["row:9"]);
  });
});

describe("coverage", () => {
  it("defaults each account to the min/max date of its selected rows, capped at the demo clock", () => {
    expect(coverageDefaults(rows, ["row:2", "row:3", "row:7", "row:8"], "2026-10-11")).toEqual({
      main: { start: "2026-07-05", end: "2026-09-20" }, card: { start: "2026-09-10", end: "2026-10-11" },
    });
    expect(coverageDefaults(rows, ["row:3"], null)).toEqual({ main: { start: "2026-09-20", end: "2026-09-20" } });
  });
  it("builds the confirm body in row order with edits and only kept suspected rows", () => {
    const body = confirmBody(rows, ["row:5", "row:2", "row:3"], ["row:5", "row:3"], { main: { start: "2026-07-01", end: "2026-09-30", complete: true } }, "2026-10-11");
    expect(body).toEqual({
      selected_rows: ["row:2", "row:3", "row:5"], keep_similar_rows: ["row:5"],
      coverage: [{ account_id: "main", start: "2026-07-01", end: "2026-09-30", complete: true }],
    });
  });
  it("mirrors Django's coverage checks", () => {
    const selected = ["row:2", "row:3"];
    expect(coverageProblems(rows, [], selected, [{ account_id: "main", start: "2026-07-01", end: "2026-09-30", complete: false }], "2026-10-11")).toEqual({});
    expect(coverageProblems(rows, [], selected, [{ account_id: "main", start: "2026-07-01", end: "2026-09-30", complete: true }], "2026-10-11")).toEqual({ main: ["PARTIAL"] });
    expect(coverageProblems(rows, [{ code: "INVALID_CSV_ROW", locator: "row:9", message: "" }], selected, [{ account_id: "main", start: "2026-07-01", end: "2026-07-31", complete: true }], "2026-10-11"))
      .toEqual({ main: ["OUTSIDE", "ERROR_ROWS"] });
    expect(coverageProblems(rows, [], ["row:8"], [{ account_id: "card", start: "2026-10-30", end: "2026-10-20", complete: false }], "2026-10-11"))
      .toEqual({ card: ["ORDER", "FUTURE", "OUTSIDE"] });
  });
  it("lists selected suspected duplicates that would be refused without keep", () => {
    expect(unkeptSimilar(rows, ["row:5", "row:2"], [])).toEqual(["row:5"]);
    expect(unkeptSimilar(rows, ["row:5"], ["row:5"])).toEqual([]);
  });
});

describe("pollDelays", () => {
  it("doubles from 1 s, caps at 10 s and gives up after a minute", () => {
    const delays = pollDelays();
    expect(delays).toEqual([1000, 2000, 4000, 8000, 10000, 10000, 10000, 10000, 5000]);
    expect(delays.reduce((a, b) => a + b, 0)).toBe(60_000);
    expect(pollDelays(5000)).toEqual([1000, 2000, 2000]);
  });
});

describe("recalculationJob", () => {
  const job = (id: string, created_at: string, analysis_version: number, status = "QUEUED"): CheckJob =>
    ({ id, created_at, kind: "check", status, attempts: 0, error_code: "", payload: { analysis_version } });
  it("picks the newest check covering the confirmed analysis version", () => {
    const jobs = [job("old", "2026-10-11T01:00:00Z", 3, "DONE"), job("new", "2026-10-11T02:00:00Z", 4), job("newer", "2026-10-11T02:00:01Z", 5)];
    expect(recalculationJob(jobs, 4)?.id).toBe("newer");
    expect(recalculationJob(jobs.slice(0, 1), 4)).toBeNull();
  });
});

describe("labels", () => {
  it("maps risk kinds and unknown kinds", () => {
    expect(riskKind("cashflow_gap")).toBe("cashflow_gap");
    expect(riskKind("spending_increased")).toBe("spending_increased");
    expect(riskKind("liquidity")).toBe("liquidity");
    expect(riskKind("semester_gap")).toBe("semester_gap");
    expect(riskKind("brand_new")).toBe("unknown");
  });
  it("maps file-level CSV error codes and leaves others to Django's message", () => {
    expect(csvError("CSV_MISSING_COLUMNS")).toBe("CSV_MISSING_COLUMNS");
    expect(csvError("INVALID_UTF8")).toBe("INVALID_UTF8");
    expect(csvError("FILE_SIZE_LIMIT")).toBe("FILE_SIZE_LIMIT");
    expect(csvError("COVERAGE_DATE_MISMATCH")).toBeNull();
  });
  it("keeps next-page links on the API host", () => {
    expect(nextPath("http://127.0.0.1:5180/api/v2/readiness/transactions/?page=2", "http://127.0.0.1:5180")).toBe("readiness/transactions/?page=2");
    expect(nextPath("https://evil.example/api/v2/x/", "http://127.0.0.1:5180")).toBeNull();
    expect(nextPath(null, "http://127.0.0.1:5180")).toBeNull();
  });
});
