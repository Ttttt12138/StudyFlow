import { previewStages, type PreviewStage } from "../plan/preview";
/** Tools an old `?<tool>=1|preview` link may name directly. */
export const studentTools = ["wallet", "payments", "agent"] as const;
export type StudentTool = typeof studentTools[number];
export type ToolKind = StudentTool | "plan" | "compare" | "funding" | "life" | "card";
export type ToolTarget = { kind: ToolKind; sessionId?: string; pendingId?: string; cardId?: string; section?: string };
export type WorkspaceRoute = { preview: boolean; stage: PreviewStage; tool: ToolTarget | null };
const kinds: readonly string[] = [...studentTools, "plan", "compare", "funding", "life", "card"];

/** Tabs of the single money tool (wallet/MoneyHub.tsx) a link may open. */
const WALLET_SECTIONS = ["convert", "quote", "pay", "history"];

function acceptsSection(kind: ToolKind, section: string) {
  if (kind === "wallet") return WALLET_SECTIONS.includes(section);
  return kind === "life" && /^(task|bill|loan):[a-f0-9-]{36}(:\d+)?$/.test(section);
}

/** Price lookup, comparison and the loan panel: open from the first visit. */
export const planningTools: readonly ToolKind[] = ["plan", "compare", "funding", "card"];
/** The plan tools (to-dos and bills, the wallet): they open once the loan application is submitted (plan CONFIRMED). */
export const planTools: readonly ToolKind[] = ["life", "wallet", "payments"];
/** Retired tools whose job lives elsewhere now (null: the tool is gone, the link opens the conversation). */
const MERGED: Partial<Record<string, ToolKind | null>> = {
  copilot: "agent", insights: "life", spending: "life", bills: "life", loans: "funding",
  trust: null, family: null, "family-links": null,
};
/** Old `?<tool>=…` links of retired tools still pick preview mode and their stage. */
const LEGACY_LINKS = [...studentTools, "loans", "insights", "trust", "family", "copilot"];
/** Old links that only made sense once the plan was under way: their preview shows the submitted application. */
const LATE_LINKS = ["wallet", "payments", "insights", "trust", "bills", "spending"];

/** Whether a tool may open. `confirmed` is null while the plan is still loading. */
export function toolAvailable(kind: ToolKind, confirmed: boolean | null) {
  return !planTools.includes(kind) || confirmed === true;
}

export function readWorkspaceRoute(href: string): WorkspaceRoute {
  const query = new URL(href, "http://localhost").searchParams;
  const legacy = LEGACY_LINKS.find(kind => query.has(kind));
  const asked = legacy ?? query.get("tool");
  const kind = asked && (asked in MERGED ? MERGED[asked] : asked);
  const tool: ToolTarget | null = kind && kinds.includes(kind) ? { kind: kind as ToolKind } : null;
  if (tool?.kind === "agent") {
    if (query.get("session")) tool.sessionId = query.get("session")!;
    if (query.get("pending")) tool.pendingId = query.get("pending")!;
  }
  if (tool?.kind === "card" && query.get("card")) tool.cardId = query.get("card")!;
  const section = query.get("section");
  if (tool && section && acceptsSection(tool.kind, section)) tool.section = section;
  const preview = query.get("plan") === "preview" || query.get("journey") === "preview" || !!legacy && query.get(legacy) === "preview";
  // A recorded preview of a plan tool (old ?wallet=preview, ?insights=preview links) shows the stage it belongs to.
  const late = !!asked && (LATE_LINKS.includes(asked) || (planTools as readonly string[]).includes(asked));
  const stage = preview && !query.get("stage") && (late || tool?.kind === "agent") ? "prepare" : previewStage(query.get("stage"));
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
  }
  return query.size ? `/?${query}` : "/";
}

export function appendTool(stack: ToolTarget[], target: ToolTarget) {
  return JSON.stringify(stack.at(-1)) === JSON.stringify(target) ? stack : [...stack, target];
}

/** ?stage=prepare picks the recorded "application submitted" stage (old ?stage=school links too); anything else is
 *  the consultation stage. */
export function previewStage(value: string | null): PreviewStage {
  if (value === "school") return "prepare";
  return previewStages.find(stage => stage === value) ?? "plan";
}
