import { groups, itemGroups, itemKey } from "./workbench";
import type { OpsItem, OpsQueue, OpsWorkbench } from "./types";

function previewItems(queue: OpsQueue, now: number): OpsItem[] {
  const all: OpsItem[] = [];
  const add = (kind: OpsItem["kind"], record: OpsItem["record"]) => {
    const expiring = kind === "approval" && "expires_at" in record && Date.parse(record.expires_at) <= now + 3_600_000;
    const unknown = ["payment", "order"].includes(kind) && "status" in record && record.status.toLowerCase() === "unknown";
    const queued_at = "submitted_at" in record ? record.submitted_at : "created_at" in record ? record.created_at : null;
    all.push({ kind, record, queued_at: queued_at ?? new Date(now).toISOString(), attention: expiring ? "expiring" : unknown ? "unknown" : null } as OpsItem);
  };
  queue.approvals.filter(row => Date.parse(row.expires_at) > now).forEach(row => add("approval", row));
  queue.payments.forEach(row => add("payment", row));
  queue.remittance_orders.forEach(row => add("order", row));
  queue.beneficiaries.forEach(row => add("payee", row));
  queue.applications.forEach(row => add("loan", row));
  return all;
}

export function previewWorkbench(queue: OpsQueue, params: URLSearchParams): OpsWorkbench {
  const now = Date.now(), student = (params.get("student") ?? "").trim().toLowerCase();
  const matches = (row: { owner_username: string }) => row.owner_username.toLowerCase().includes(student);
  const all = previewItems(queue, now).filter(item => matches(item.record));
  const kind = params.get("kind") ?? "all", attention = params.get("attention") ?? "all";
  const priority = (item: OpsItem) => item.attention === "expiring" ? 0 : item.attention === "unknown" ? 1 : 2;
  const rows = all.filter(item => (kind === "all" || itemGroups[item.kind] === kind) && (attention === "all" || item.attention === attention))
    .sort((a, b) => priority(a) - priority(b) || a.queued_at.localeCompare(b.queued_at) || itemKey(a).localeCompare(itemKey(b)));
  const page_size = Math.max(1, Math.min(100, Number(params.get("page_size")) || 20));
  const pages = Math.max(1, Math.ceil(rows.length / page_size)), page = Math.max(1, Math.min(pages, Number(params.get("page")) || 1));
  return { operator: queue.operator, is_simulated: true, generated_at: new Date(now).toISOString(),
    summary: { total: all.length, expiring: all.filter(row => row.attention === "expiring").length,
      unknown: all.filter(row => row.attention === "unknown").length, unverified: all.filter(row => row.kind === "payee").length,
      by_kind: Object.fromEntries(groups.map(group => [group, all.filter(row => itemGroups[row.kind] === group).length])) as OpsWorkbench["summary"]["by_kind"] },
    items: rows.slice((page - 1) * page_size, page * page_size), pagination: { page, page_size, total: rows.length, pages },
    recent_decisions: queue.recent_decisions.filter(matches).slice(0, 20) };
}
