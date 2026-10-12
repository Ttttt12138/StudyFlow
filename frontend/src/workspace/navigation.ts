import { previewStages, type PreviewStage } from "../plan/preview";
export const studentTools = ["wallet", "payments", "agent", "trust", "loans", "insights", "family", "copilot"] as const;
export type StudentTool = typeof studentTools[number];
export type ToolKind = StudentTool | "plan" | "bills" | "spending" | "family-links" | "card";
export type ToolTarget = { kind: ToolKind; sessionId?: string; pendingId?: string; cardId?: string; section?: string; month?: string };
export type WorkspaceRoute = { preview: boolean; stage: PreviewStage; tool: ToolTarget | null };
const kinds: readonly string[] = [...studentTools, "plan", "bills", "spending", "family-links", "card"];

export function readWorkspaceRoute(href: string): WorkspaceRoute {
  const query = new URL(href, "http://localhost").searchParams;
  const legacy = studentTools.find(kind => query.has(kind));
  const kind = legacy ?? query.get("tool");
  const tool: ToolTarget | null = kind && kinds.includes(kind) ? { kind: kind as ToolKind } : null;
  if (tool?.kind === "agent") {
    if (query.get("session")) tool.sessionId = query.get("session")!;
    if (query.get("pending")) tool.pendingId = query.get("pending")!;
  }
  if (tool?.kind === "card" && query.get("card")) tool.cardId = query.get("card")!;
  const section = query.get("section");
  if (tool && section && ((tool.kind === "wallet" && ["convert", "quote"].includes(section)) || (tool.kind === "bills" && section === "expense"))) tool.section = section;
  if (tool?.kind === "spending" && /^\d{4}-(0[1-9]|1[0-2])$/.test(query.get("month") ?? "")) tool.month = query.get("month")!;
  return { preview: query.get("plan") === "preview" || query.get("journey") === "preview" || !!legacy && query.get(legacy) === "preview",
    stage: previewStage(query.get("stage")), tool };
}

export function workspaceUrl(route: WorkspaceRoute) {
  const query = new URLSearchParams();
  if (route.preview) query.set("plan", "preview");
  if (route.stage !== "plan") query.set("stage", route.stage);
  if (route.tool) {
    query.set("tool", route.tool.kind);
    if (route.tool.sessionId) query.set("session", route.tool.sessionId);
    if (route.tool.pendingId) query.set("pending", route.tool.pendingId);
    if (route.tool.cardId) query.set("card", route.tool.cardId);
    if (route.tool.section && ((route.tool.kind === "wallet" && ["convert", "quote"].includes(route.tool.section)) || (route.tool.kind === "bills" && route.tool.section === "expense"))) query.set("section", route.tool.section);
    if (route.tool.kind === "spending" && route.tool.month) query.set("month", route.tool.month);
  }
  return query.size ? `/?${query}` : "/";
}

export function appendTool(stack: ToolTarget[], target: ToolTarget) {
  return JSON.stringify(stack.at(-1)) === JSON.stringify(target) ? stack : [...stack, target];
}

/** ?stage=prepare|school picks a recorded preview stage; anything else is the consultation stage. */
export function previewStage(value: string | null): PreviewStage {
  return previewStages.find(stage => stage === value) ?? "plan";
}
