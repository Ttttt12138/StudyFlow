import { describe, expect, it } from "vitest";
import { barScale, buildScenario, buildWhatIf, conditionLabel, costChange, defaultDate, deltaTone, emptyLoan, isIsoDate, loanState, rerunScenarios,
  sortNotifications, toMoney, tone, type ScenarioForm } from "./logic";
import type { ReadinessState } from "./types";

const form = (patch: Partial<ScenarioForm> = {}): ScenarioForm => ({ key: "s", name: "Cheaper housing", costs: [], support: [], allowLoan: true, loan: emptyLoan(), ...patch });
const loan = { principal: "30000", rate: "5", fees: "600", months: "12", first_due_date: "2027-01-15", available_on: "2026-11-25" };
const state: ReadinessState = { semester_id: "sem", state_version: 8, budget_version: 5, analysis_version: 0, estimated_expenses: [] };
const codes = (f: ScenarioForm) => buildScenario(f).errors.map((e) => e.code);

describe("toMoney / isIsoDate", () => {
  it("normalizes decimal strings without floats", () => {
    expect(toMoney("4000")).toBe("4000.00");
    expect(toMoney("12.5")).toBe("12.50");
    expect(toMoney(" 0.10 ")).toBe("0.10");
    expect(toMoney("007")).toBe("7.00");
    expect(toMoney("1.234")).toBeNull();
    expect(toMoney("-5")).toBeNull();
    expect(toMoney("1e3")).toBeNull();
    expect(toMoney("")).toBeNull();
  });
  it("accepts only real calendar dates", () => {
    expect(isIsoDate("2026-11-30")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-1-5")).toBe(false);
  });
});

describe("buildScenario", () => {
  it("builds the exact Django scenario, omitting empty lists and a blank source_id", () => {
    const { scenario, errors } = buildScenario(form({
      costs: [{ key: "c", cost_id: "housing", amount: "4000", effective_on: "2026-11-01" }],
      support: [{ key: "a", source_id: "", amount: "20000", available_on: "2026-11-25" }, { key: "b", source_id: "f1", amount: "5000.5", available_on: "2026-12-01" }],
    }));
    expect(errors).toEqual([]);
    expect(scenario).toEqual({
      name: "Cheaper housing", costs: [{ cost_id: "housing", amount: "4000.00", effective_on: "2026-11-01" }],
      family_support: [{ amount: "20000.00", available_on: "2026-11-25" }, { source_id: "f1", amount: "5000.50", available_on: "2026-12-01" }], allow_new_loan: true,
    });
    expect(buildScenario(form({ allowLoan: false })).scenario).toEqual({ name: "Cheaper housing", allow_new_loan: false });
  });
  it("converts loan terms, rate percent to a fraction", () => {
    expect(buildScenario(form({ loan })).scenario).toEqual({ name: "Cheaper housing", allow_new_loan: true,
      loan: { currency: "THB", principal: "30000.00", annual_rate: "0.05", fees: "600.00", months: 12, first_due_date: "2027-01-15" }, loan_available_on: "2026-11-25" });
  });
  it("treats loan fields as all-or-nothing", () => {
    expect(loanState(emptyLoan())).toBe("empty");
    expect(loanState({ ...emptyLoan(), principal: "1" })).toBe("partial");
    expect(loanState(loan)).toBe("complete");
    expect(codes(form({ loan: { ...loan, months: " " } }))).toEqual(["loanPartial"]);
    expect(codes(form({ loan, allowLoan: false }))).toContain("loanNotAllowed");
  });
  it("rejects invalid loan terms", () => {
    expect(codes(form({ loan: { ...loan, fees: "30000" } }))).toEqual(["loanFees"]);
    expect(codes(form({ loan: { ...loan, months: "61" } }))).toEqual(["loanMonths"]);
    expect(codes(form({ loan: { ...loan, rate: "101" } }))).toEqual(["loanRate"]);
    expect(codes(form({ loan: { ...loan, first_due_date: "2026-11-25" } }))).toEqual(["loanDates"]);
    expect(codes(form({ loan: { ...loan, principal: "0" } }))).toContain("loanPrincipal");
  });
  it("reports field problems with their row number", () => {
    const result = buildScenario(form({ name: " ",
      costs: [{ key: "c", cost_id: "", amount: "x", effective_on: "2026-13-01" }, { key: "d", cost_id: "", amount: "1", effective_on: "2026-11-01" }],
      support: [{ key: "a", source_id: "f1", amount: "0", available_on: "" }, { key: "b", source_id: "f1", amount: "1", available_on: "2026-11-01" }] }));
    expect(result.scenario).toBeNull();
    expect(result.errors).toEqual([{ code: "name" }, { code: "costMissing", n: 1 }, { code: "costAmount", n: 1 }, { code: "costDate", n: 1 }, { code: "costMissing", n: 2 },
      { code: "costDuplicate" }, { code: "supportAmount", n: 1 }, { code: "supportDate", n: 1 }, { code: "supportDuplicate" }]);
  });
});

describe("buildWhatIf", () => {
  it("adds the version tuple and keeps at most three scenarios", () => {
    const { body, errors } = buildWhatIf(state, [form(), form({ name: "B" }), form({ name: "C" }), form({ name: "D" })]);
    expect(errors).toEqual([]);
    expect(body).toMatchObject({ semester_id: "sem", state_version: 8, budget_version: 5, analysis_version: 0 });
    expect(body!.scenarios.map((s) => s.name)).toEqual(["Cheaper housing", "B", "C"]);
  });
  it("tags errors with their scenario and returns no body", () => {
    const { body, errors } = buildWhatIf(state, [form(), form({ name: "" })]);
    expect(body).toBeNull();
    expect(errors).toEqual([{ code: "name", scenario: 1 }]);
    expect(buildWhatIf(state, []).errors).toEqual([{ code: "noScenario", scenario: 0 }]);
  });
});

describe("deltaTone", () => {
  it("treats lower gaps, spending and borrowing as better", () => {
    expect(deltaTone("maximum_reserve_gap", "-23000.00")).toBe("better");
    expect(deltaTone("remaining_expenses", "150.00")).toBe("worse");
    expect(deltaTone("loan_needed", "-1.00")).toBe("better");
  });
  it("treats a higher minimum balance as better", () => {
    expect(deltaTone("minimum_balance", "23000.00")).toBe("better");
    expect(deltaTone("minimum_balance", "-0.01")).toBe("worse");
  });
  it("is neutral for zero or missing", () => {
    expect(deltaTone("minimum_balance", "0.00")).toBe("same");
    expect(deltaTone("loan_needed", undefined)).toBe("same");
  });
});

describe("conditionLabel", () => {
  it("maps known conditions and keeps the cost", () => {
    expect(conditionLabel("CONTRACT_CHANGE_REQUIRES_REVIEW:housing")).toEqual({ key: "copilot.cond.CONTRACT_CHANGE_REQUIRES_REVIEW", cost: "housing", raw: "CONTRACT_CHANGE_REQUIRES_REVIEW:housing" });
    expect(conditionLabel("HYPOTHETICAL_FUNDING_NOT_SETTLED")).toEqual({ key: "copilot.cond.HYPOTHETICAL_FUNDING_NOT_SETTLED", raw: "HYPOTHETICAL_FUNDING_NOT_SETTLED" });
  });
  it("shows unknown conditions raw", () => {
    expect(conditionLabel("SOMETHING_NEW:x")).toEqual({ key: null, raw: "SOMETHING_NEW:x" });
  });
});

describe("helpers", () => {
  it("reads the dated override from a cost diff", () => {
    expect(costChange({ kind: "cost", id: "housing", before: { amount: "7000.00" },
      after: { amount: "7000.00", planned_overrides: [{ amount: "5000.00", effective_on: "2026-10-15" }, { amount: "4000.00", effective_on: "2026-11-01" }] } }))
      .toEqual({ cost_id: "housing", before: "7000.00", lower: null, upper: null, amount: "4000.00", effective_on: "2026-11-01" });
  });
  it("scales bars to the largest absolute balance", () => {
    const scale = barScale(["-26500.00", "13250.00", "0.00"]);
    expect([scale("-26500.00"), scale("13250.00"), scale("0.00")]).toEqual([100, 50, 0]);
    expect(barScale([])("5")).toBe(0);
  });
  it("sorts unread notifications first, newest first", () => {
    const rows = [{ id: "a", read_at: "x", created_at: "2026-11-03" }, { id: "b", read_at: null, created_at: "2026-11-01" }, { id: "c", read_at: null, created_at: "2026-11-02" }];
    expect(sortNotifications(rows).map((r) => r.id)).toEqual(["c", "b", "a"]);
  });
  it("defaults dates to the later of today and the plan date", () => {
    expect(defaultDate("2026-11-02", "2026-10-12")).toBe("2026-11-02");
    expect(defaultDate("2026-10-01", "2026-10-12")).toBe("2026-10-12");
    expect(defaultDate(undefined, "2026-10-12")).toBe("2026-10-12");
  });
  it("maps statuses to chip tones", () => {
    expect([tone("EXECUTED"), tone("BLOCKED"), tone("OPEN"), tone("NOT_CALLED"), tone(null)]).toEqual(["ok", "denied", "pending", "neutral", "neutral"]);
  });
  it("re-runs only saved scenario inputs", () => {
    expect(rerunScenarios([{ name: "A", allow_new_loan: true }, undefined])).toEqual([{ name: "A", allow_new_loan: true }]);
  });
});
