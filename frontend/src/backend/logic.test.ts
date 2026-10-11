import { describe, expect, it } from "vitest";
import type { BackendState, Cost, Draft } from "./contracts";
import { importTouched, rebaseOnSaved, templateId, uploadKind, versionsMatch } from "./logic";

const state = { semester_id: "s1", state_version: 3, budget_version: 5, analysis_version: 2 } as BackendState;

describe("versionsMatch", () => {
  const run = { state_version: 3, budget_version: 5, analysis_version: 2 };

  it("accepts a result computed from the current versions", () => {
    expect(versionsMatch(run, state)).toBe(true);
    expect(versionsMatch({ ...run, semester_id: "s1" }, state)).toBe(true);
  });

  it.each([
    ["state", { ...run, state_version: 2 }],
    ["budget", { ...run, budget_version: 4 }],
    ["analysis", { ...run, analysis_version: 1 }],
    ["semester", { ...run, semester_id: "other" }],
    ["legacy semester field", { ...run, semester: "other" }],
  ])("rejects a result from another %s", (_label, result) => {
    expect(versionsMatch(result, state)).toBe(false);
  });

  it("ignores the analysis version when the backend reports none", () => {
    expect(versionsMatch({ ...run, analysis_version: 9 }, { ...state, analysis_version: undefined })).toBe(true);
  });

  it("is never current without both sides", () => {
    expect(versionsMatch(null, state)).toBe(false);
    expect(versionsMatch(run, null)).toBe(false);
  });
});

const cost = (cost_id: string, extra: Partial<Cost> = {}): Cost => ({ cost_id, category: cost_id, amount: null, ...extra });

describe("importTouched", () => {
  it("recognises costs the import merged into or offered an alternative for", () => {
    expect(importTouched(cost("tuition", { source_refs: ["old", "imp"] }), "imp")).toBe(true);
    expect(importTouched(cost("tuition", { alternatives: [{ source: "imp", candidate: {} }] }), "imp")).toBe(true);
    expect(importTouched(cost("food", { source_refs: ["old"], conflict: true }), "imp")).toBe(false);
  });
});

describe("rebaseOnSaved", () => {
  const base: Draft = {
    profile: { school: "PSU", campus: null },
    costs: [cost("tuition", { amount: "40000.00" }), cost("food", { amount: null }), cost("housing", { amount: "9000.00" })],
  };
  // What the worker proposed from `base`: tuition merged, campus filled, everything else copied.
  const proposed: Draft = {
    profile: { school: "PSU", campus: "Phuket" },
    costs: [
      cost("tuition", { amount: "41000.00", source_refs: ["imp"] }),
      cost("food", { amount: null }),
      cost("housing", { amount: "9000.00" }),
    ],
  };

  it("equals the proposal when nothing was saved in between", () => {
    expect(rebaseOnSaved(proposed, base, "imp")).toEqual(proposed);
  });

  it("keeps revisions saved after the worker ran", () => {
    const saved: Draft = { ...base, costs: [base.costs[0], cost("food", { amount: "3000.00" }), base.costs[2]] };
    const result = rebaseOnSaved(proposed, saved, "imp");
    expect(result.costs.find((c) => c.cost_id === "food")?.amount).toBe("3000.00");
    expect(result.costs.find((c) => c.cost_id === "tuition")?.amount).toBe("41000.00");
  });

  it("fills only profile fields that are still empty", () => {
    const saved: Draft = { ...base, profile: { school: "PSU", campus: "Hat Yai" } };
    expect(rebaseOnSaved(proposed, saved, "imp").profile.campus).toBe("Hat Yai");
    expect(rebaseOnSaved(proposed, base, "imp").profile.campus).toBe("Phuket");
  });

  it("follows the saved list when costs were removed or added", () => {
    const saved: Draft = { ...base, costs: [base.costs[0], cost("visa", { amount: "1900.00" })] };
    const ids = rebaseOnSaved(proposed, saved, "imp").costs.map((c) => c.cost_id);
    expect(ids).toEqual(["tuition", "visa"]);
  });

  it("does not share objects with its inputs", () => {
    const result = rebaseOnSaved(proposed, base, "imp");
    result.costs[0].amount = "1.00";
    expect(proposed.costs[0].amount).toBe("41000.00");
  });
});

describe("uploadKind", () => {
  it.each([
    [{ name: "offer.pdf", type: "application/pdf" }, "pdf"],
    [{ name: "offer.PDF", type: "" }, "pdf"],
    [{ name: "scan.jpg", type: "image/jpeg" }, "image"],
    [{ name: "scan.png", type: "" }, "image"],
    [{ name: "notes.txt", type: "text/plain" }, "text"],
    [{ name: "notes.txt", type: "" }, "text"],
  ] as const)("classifies %o as %s", (file, kind) => {
    expect(uploadKind(file)).toBe(kind);
  });

  it.each([
    { name: "archive.zip", type: "" },
    { name: "noextension", type: "" },
    { name: "sheet.csv", type: "text/csv" },
    { name: "fake.txt", type: "application/octet-stream" },
  ])("refuses to guess for %o", (file) => {
    expect(uploadKind(file)).toBeNull();
  });
});

describe("templateId", () => {
  it("distinguishes versions of one template", () => {
    const template = { key: "psu", version: 2, profile: {}, costs: [], required_categories: [] };
    expect(templateId(template)).toBe("psu@2");
    expect(templateId({ ...template, version: 3 })).not.toBe(templateId(template));
  });
});
