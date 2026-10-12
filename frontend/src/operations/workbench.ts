import type { OpsFilters, OpsGroup, OpsItem, OpsNavigation } from "./types";

export const groups: OpsGroup[] = ["approvals", "transactions", "payees", "loans", "sponsors"];
export const itemGroups: Record<OpsItem["kind"], OpsGroup> = {
  approval: "approvals", payment: "transactions", order: "transactions", payee: "payees", loan: "loans", sponsor: "sponsors",
};
export const itemKey = (item: OpsItem) => `${item.kind}:${item.record.id}`;

export function navigationFromHash(hash: string): OpsNavigation {
  const section = hash.replace("#ops-", "");
  const kind = section === "adapter" ? "transactions" : section;
  if (groups.includes(kind as OpsGroup)) return { view: "tasks", kind: kind as OpsGroup, attention: "all" };
  return { view: ["history", "decisions"].includes(section) ? "history" : section === "tasks" ? "tasks" : "overview", kind: "all", attention: "all" };
}

export function workbenchPath(filters: OpsFilters) {
  const params = new URLSearchParams({ student: filters.student.trim(), kind: filters.kind, attention: filters.attention,
    page: String(filters.page), page_size: "20" });
  return `operations/workbench/?${params}`;
}
