import { describe, expect, it } from "vitest";
import { readWorkspaceRoute, workspaceUrl, appendTool, toolAvailable, planningTools, enrolledTools } from "./navigation";

describe("workspace navigation", () => {
  it("restores the exact task or loan account from reminder links", () => {
    const id = "f94c78d8-b708-4735-9b7a-7d4420f82660";
    for (const tool of [{ kind: "life" as const, section: `task:${id}` }, { kind: "loans" as const, section: id }]) {
      const route = { preview: false, stage: "plan" as const, tool };
      expect(readWorkspaceRoute(`http://localhost${workspaceUrl(route)}`)).toEqual(route);
    }
  });
  it("opens price and funding tools before enrollment and money tools only after", () => {
    for (const kind of planningTools) expect(toolAvailable(kind, false)).toBe(true);
    for (const kind of ["plan", "compare", "funding", "card", "family-links"] as const) expect(toolAvailable(kind, null)).toBe(true);
    for (const kind of enrolledTools) {
      expect(toolAvailable(kind, false)).toBe(false);
      expect(toolAvailable(kind, null)).toBe(false);
      expect(toolAvailable(kind, true)).toBe(true);
    }
    expect(enrolledTools).toEqual(expect.arrayContaining(["wallet", "payments", "bills", "spending"]));
    expect(toolAvailable("loans", false)).toBe(true);
  });
  it("round trips the new compare and funding panels", () => {
    for (const kind of ["compare", "funding"] as const) {
      const route = { preview: false, stage: "plan" as const, tool: { kind } };
      expect(readWorkspaceRoute(`http://localhost${workspaceUrl(route)}`)).toEqual(route);
    }
  });
  it("restores legacy student links as tools without losing preview", () => {
    expect(readWorkspaceRoute("http://localhost/?wallet=preview")).toEqual({ preview: true, stage: "school", tool: { kind: "wallet" } });
    expect(readWorkspaceRoute("http://localhost/?wallet=1").stage).toBe("plan");
    expect(readWorkspaceRoute("http://localhost/?plan=preview&stage=school&tool=bills")).toEqual({ preview: true, stage: "school", tool: { kind: "life" } });
  });
  it("sends retired tools to where their job lives now", () => {
    expect(readWorkspaceRoute("http://localhost/?tool=bills&section=expense").tool).toEqual({ kind: "life", section: "record" });
    expect(readWorkspaceRoute("http://localhost/?tool=insights").tool).toEqual({ kind: "life" });
    expect(readWorkspaceRoute("http://localhost/?insights=preview")).toEqual({ preview: true, stage: "school", tool: { kind: "life" } });
    expect(readWorkspaceRoute("http://localhost/?tool=copilot").tool).toEqual({ kind: "agent" });
    expect(planningTools).not.toContain("copilot");
    expect(toolAvailable("life", false)).toBe(true);
  });
  it("round trips the preparing preview stage and ignores unknown stages", () => {
    const route = { preview: true, stage: "prepare" as const, tool: null };
    expect(workspaceUrl(route)).toBe("/?plan=preview&stage=prepare");
    expect(readWorkspaceRoute(`http://localhost${workspaceUrl(route)}`)).toEqual(route);
    expect(readWorkspaceRoute("http://localhost/?plan=preview&stage=moon").stage).toBe("plan");
  });
  it("round trips the exact finance proposal, never a new goal", () => {
    const route = { preview: false, stage: "plan" as const, tool: { kind: "agent" as const, sessionId: "s-12", pendingId: "p-8" } };
    expect(readWorkspaceRoute(`http://localhost${workspaceUrl(route)}`)).toEqual(route);
  });
  it("opens This month for old spending links and the expense form for record links", () => {
    expect(readWorkspaceRoute("http://localhost/?tool=spending&month=2026-10").tool).toEqual({ kind: "life" });
    const route = { preview: false, stage: "plan" as const, tool: { kind: "life" as const, section: "record" } };
    expect(readWorkspaceRoute(`http://localhost${workspaceUrl(route)}`)).toEqual(route);
  });
  it("ignores unknown tools and does not route public pages into the workspace", () => {
    expect(readWorkspaceRoute("http://localhost/?tool=not-a-tool").tool).toBeNull();
    expect(readWorkspaceRoute("http://localhost/?sponsor=1").tool).toBeNull();
  });
  it("retains a return stack without duplicate adjacent targets", () => {
    const wallet = { kind: "wallet" as const };
    expect(appendTool([wallet], wallet)).toEqual([wallet]);
    expect(appendTool([wallet], { kind: "agent", sessionId: "s-12" })).toHaveLength(2);
  });
});
