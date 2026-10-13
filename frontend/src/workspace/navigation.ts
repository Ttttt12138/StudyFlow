import { previewStages, type PreviewStage } from "../plan/preview";
export const studentTools = ["wallet", "payments", "agent", "trust", "loans", "insights", "family", "copilot"] as const;
export type StudentTool = typeof studentTools[number];
export type ToolKind = StudentTool | "plan" | "compare" | "funding" | "life" | "bills" | "spending" | "family-links" | "card";
export type ToolTarget = { kind: ToolKind; sessionId?: string; pendingId?: string; cardId?: string; section?: string; month?: string };
export type WorkspaceRoute = { preview: boolean; stage: PreviewStage; tool: ToolTarget | null };
const kinds: readonly string[] = [...studentTools, "plan", "compare", "funding", "life", "bills", "spending", "family-links", "card"];

/** Tabs of the single money tool (wallet/MoneyHub.tsx) a link may open. */
const WALLET_SECTIONS = ["convert", "quote", "pay", "history"];

function acceptsSection(kind: ToolKind, section: string) {
  if (kind === "wallet") return WALLET_SECTIONS.includes(section);
  if (kind === "bills") return section === "expense";
  if (kind === "loans") return /^[a-f0-9-]{36}$/.test(section);
  return kind === "life" && /^(task|bill|enrollment|loan):[a-f0-9-]{36}(:\d+)?$/.test(section);
}

/** Price lookup, funding and the to-dos of a confirmed plan: open from the first visit. */
export const planningTools: readonly ToolKind[] = ["plan", "compare", "funding", "life", "loans", "family"];
/** Money movement and records: these only appear once the plan is ENROLLED. */
export const enrolledTools: readonly ToolKind[] = ["bills", "spending", "wallet", "payments", "insights", "trust"];
/** Retired tools whose job lives elsewhere now: the comparison assistant is the main conversation,
 *  spending insights are the monthly spending panel. */
const MERGED: Partial<Record<string, ToolKind>> = { copilot: "agent", insights: "spending" };

/** Whether a tool may open. `enrolled` is null while the plan is still loading. */
export function toolAvailable(kind: ToolKind, enrolled: boolean | null) {
  return !enrolledTools.includes(kind) || enrolled === true;
}

export function readWorkspaceRoute(href: string): WorkspaceRoute {
  const query = new URL(href, "http://localhost").searchParams;
  const legacy = studentTools.find(kind => query.has(kind));
  const asked = legacy ?? query.get("tool");
  const kind = asked && (MERGED[asked] ?? asked);
  const tool: ToolTarget | null = kind && kinds.includes(kind) ? { kind: kind as ToolKind } : null;
  if (tool?.kind === "agent") {
    if (query.get("session")) tool.sessionId = query.get("session")!;
    if (query.get("pending")) tool.pendingId = query.get("pending")!;
  }
  if (tool?.kind === "card" && query.get("card")) tool.cardId = query.get("card")!;
  const section = query.get("section");
  if (tool && section && acceptsSection(tool.kind, section)) tool.section = section;
  // Bills are listed with the other to-dos; the bills tool itself is only the expense form now.
  if (tool?.kind === "bills" && !tool.section) tool.kind = "life";
  if (tool?.kind === "spending" && /^\d{4}-(0[1-9]|1[0-2])$/.test(query.get("month") ?? "")) tool.month = query.get("month")!;
  const preview = query.get("plan") === "preview" || query.get("journey") === "preview" || !!legacy && query.get(legacy) === "preview";
  // A recorded preview of a money tool (old ?wallet=preview links, /intro) shows the enrolled stage it belongs to.
  const stage = preview && !query.get("stage") && tool && (enrolledTools.includes(tool.kind) || tool.kind === "agent") ? "school" : previewStage(query.get("stage"));
  return { preview, stage, tool };
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
    if (route.tool.section && acceptsSection(route.tool.kind, route.tool.section)) query.set("section", route.tool.section);
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
