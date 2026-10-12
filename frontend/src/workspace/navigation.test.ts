import { describe, expect, it } from "vitest";
import { readWorkspaceRoute, workspaceUrl, appendTool } from "./navigation";

describe("workspace navigation", () => {
  it("restores legacy student links as tools without losing preview", () => {
    expect(readWorkspaceRoute("http://localhost/?wallet=preview")).toEqual({ preview: true, stage: "plan", tool: { kind: "wallet" } });
    expect(readWorkspaceRoute("http://localhost/?plan=preview&stage=school&tool=bills")).toEqual({ preview: true, stage: "school", tool: { kind: "bills" } });
  });
  it("round trips the exact finance proposal, never a new goal", () => {
    const route = { preview: false, stage: "plan" as const, tool: { kind: "agent" as const, sessionId: "s-12", pendingId: "p-8" } };
    expect(readWorkspaceRoute(`http://localhost${workspaceUrl(route)}`)).toEqual(route);
  });
  it("restores the requested spending month", () => {
    const route = { preview: false, stage: "plan" as const, tool: { kind: "spending" as const, month: "2026-10" } };
    expect(readWorkspaceRoute(`http://localhost${workspaceUrl(route)}`)).toEqual(route);
    expect(readWorkspaceRoute("http://localhost/?tool=spending&month=2026-99").tool).toEqual({ kind: "spending" });
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
