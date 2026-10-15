import { describe, expect, it } from "vitest";
import { readWorkspaceRoute, workspaceUrl, appendTool, toolAvailable, planningTools, planTools, previewStage } from "./navigation";

describe("workspace navigation", () => {
  it("restores the exact to-do or loan installment from reminder links", () => {
    const id = "f94c78d8-b708-4735-9b7a-7d4420f82660";
    for (const section of [`task:${id}`, `loan:${id}:3`]) {
      const route = { preview: false, stage: "plan" as const, tool: { kind: "life" as const, section } };
      expect(readWorkspaceRoute(`http://localhost${workspaceUrl(route)}`)).toEqual(route);
    }
  });
  it("opens price and loan tools before the application and the plan tools only after it", () => {
    for (const kind of planningTools) {
      expect(toolAvailable(kind, false)).toBe(true);
      expect(toolAvailable(kind, null)).toBe(true);
    }
    for (const kind of planTools) {
      expect(toolAvailable(kind, false)).toBe(false);
      expect(toolAvailable(kind, null)).toBe(false);
      expect(toolAvailable(kind, true)).toBe(true);
    }
    expect(planTools).toEqual(expect.arrayContaining(["life", "wallet", "payments"]));
  });
  it("round trips the compare and loan panels", () => {
    for (const kind of ["compare", "funding"] as const) {
      const route = { preview: false, stage: "plan" as const, tool: { kind } };
      expect(readWorkspaceRoute(`http://localhost${workspaceUrl(route)}`)).toEqual(route);
    }
  });
  it("restores legacy student links as tools without losing preview", () => {
    expect(readWorkspaceRoute("http://localhost/?wallet=preview")).toEqual({ preview: true, stage: "prepare", tool: { kind: "wallet" } });
    expect(readWorkspaceRoute("http://localhost/?wallet=1").stage).toBe("plan");
    expect(readWorkspaceRoute("http://localhost/?plan=preview&stage=school&tool=bills")).toEqual({ preview: true, stage: "prepare", tool: { kind: "life" } });
  });
  it("sends retired tools to where their job lives now", () => {
    expect(readWorkspaceRoute("http://localhost/?tool=bills&section=expense").tool).toEqual({ kind: "life" });
    expect(readWorkspaceRoute("http://localhost/?tool=insights").tool).toEqual({ kind: "life" });
    expect(readWorkspaceRoute("http://localhost/?tool=spending&month=2026-10").tool).toEqual({ kind: "life" });
    expect(readWorkspaceRoute("http://localhost/?insights=preview")).toEqual({ preview: true, stage: "prepare", tool: { kind: "life" } });
    expect(readWorkspaceRoute("http://localhost/?tool=copilot").tool).toEqual({ kind: "agent" });
    expect(readWorkspaceRoute("http://localhost/?loans=1").tool).toEqual({ kind: "funding" });
    expect(readWorkspaceRoute("http://localhost/?tool=loans&section=f94c78d8-b708-4735-9b7a-7d4420f82660").tool).toEqual({ kind: "funding" });
    for (const gone of ["trust", "family", "family-links"]) expect(readWorkspaceRoute(`http://localhost/?tool=${gone}`).tool).toBeNull();
    expect(readWorkspaceRoute("http://localhost/?trust=preview")).toEqual({ preview: true, stage: "prepare", tool: null });
  });
  it("round trips the application stage, maps the retired school stage to it and ignores unknown stages", () => {
    const route = { preview: true, stage: "prepare" as const, tool: null };
    expect(workspaceUrl(route)).toBe("/?plan=preview&stage=prepare");
    expect(readWorkspaceRoute(`http://localhost${workspaceUrl(route)}`)).toEqual(route);
    expect(readWorkspaceRoute("http://localhost/?plan=preview&stage=school")).toEqual(route);
    expect(previewStage("school")).toBe("prepare");
    expect(readWorkspaceRoute("http://localhost/?plan=preview&stage=moon").stage).toBe("plan");
  });
  it("round trips the exact finance proposal, never a new goal", () => {
    const route = { preview: false, stage: "plan" as const, tool: { kind: "agent" as const, sessionId: "s-12", pendingId: "p-8" } };
    expect(readWorkspaceRoute(`http://localhost${workspaceUrl(route)}`)).toEqual(route);
  });
  it("ignores unknown tools and retired public pages", () => {
    expect(readWorkspaceRoute("http://localhost/?tool=not-a-tool").tool).toBeNull();
    expect(readWorkspaceRoute("http://localhost/?sponsor=1").tool).toBeNull();
    expect(readWorkspaceRoute("http://localhost/?verify=1").tool).toBeNull();
  });
  it("retains a return stack without duplicate adjacent targets", () => {
    const wallet = { kind: "wallet" as const };
    expect(appendTool([wallet], wallet)).toEqual([wallet]);
    expect(appendTool([wallet], { kind: "agent", sessionId: "s-12" })).toHaveLength(2);
  });
});
