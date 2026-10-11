// Pure rules behind the connected journey, kept free of React so they can be unit tested.
import type { BackendState, Cost, Draft, Template } from "./contracts";

export const templateId = (template: Template) => `${template.key}@${template.version}`;
// Upload kind from the MIME type, or the extension when the browser sends none. Never guess
// "text": Django validates PDFs and images, but stores text uploads without checking them.
export function uploadKind(file: { name: string; type: string }): "pdf" | "image" | "text" | null {
  const extension = file.name.toLowerCase().split(".").pop() ?? "";
  if (file.type === "application/pdf" || (!file.type && extension === "pdf")) return "pdf";
  if (file.type.startsWith("image/") || (!file.type && ["png", "jpg", "jpeg"].includes(extension))) return "image";
  if (file.type === "text/plain" || (!file.type && extension === "txt")) return "text";
  return null;
}
export function versionsMatch(
  result: { state_version: number; budget_version: number; analysis_version?: number; semester?: string; semester_id?: string } | null,
  state: BackendState | null,
) {
  return (
    !!result &&
    !!state &&
    (!result.semester || result.semester === state.semester_id) &&
    (!result.semester_id || result.semester_id === state.semester_id) &&
    result.state_version === state.state_version &&
    result.budget_version === state.budget_version &&
    (state.analysis_version == null || result.analysis_version === state.analysis_version)
  );
}
// Costs an import changed: values merged in (source_refs) or a conflicting alternative it offered.
export function importTouched(cost: Cost, importId: string) {
  return !!cost.source_refs?.includes(importId) || !!cost.alternatives?.some((item) => item.source === importId);
}
// The worker proposes changes on top of the draft saved when it ran. Apply only the import's
// costs and the profile fields it filled to the latest saved draft, so later revisions are kept.
export function rebaseOnSaved(reviewed: Draft, saved: Draft, importId: string): Draft {
  const touched = new Map(reviewed.costs.filter((cost) => importTouched(cost, importId)).map((cost) => [cost.cost_id, cost]));
  const profile = { ...saved.profile };
  for (const [field, value] of Object.entries(reviewed.profile))
    if (profile[field] == null && value != null) profile[field] = value;
  return structuredClone({ ...saved, profile, costs: saved.costs.map((cost) => touched.get(cost.cost_id) ?? cost) });
}
