import { useOpsPresentation } from "./presenters";
import type { OpsItem, OpsWorkbench } from "./types";
import { itemKey } from "./workbench";

export function OperationsQueue({ items, onOpen, disabled = false }: { items: OpsItem[]; onOpen: (item: OpsItem) => void; disabled?: boolean }) {
  const p = useOpsPresentation();
  if (!items.length) return <div className="ops-empty"><strong>{p.t("ops.w.empty")}</strong><p>{p.t("ops.w.emptyHint")}</p></div>;
  return <div className="ops-table-wrap"><table className="ops-table">
    <thead><tr>{["type", "student", "subject", "status", "time", "action"].map(key => <th key={key} scope="col">{p.t(key === "student" ? "ops.filter" : `ops.w.${key}` as Parameters<typeof p.t>[0])}</th>)}</tr></thead>
    <tbody>{items.map(item => <tr key={itemKey(item)} data-kind={item.kind}>
      <td data-label={p.t("ops.w.type")}><span className={`ops-type type-${item.kind}`}>{p.typeName(item)}</span></td>
      <td data-label={p.t("ops.filter")}>{item.record.owner_username}</td>
      <td data-label={p.t("ops.w.subject")} className="ops-subject">{p.subject(item)}
        {item.kind === "approval" && !item.record.can_decide && <small>{p.t("ops.w.blocked")}</small>}</td>
      <td data-label={p.t("ops.w.status")}><span className={`ops-status${item.attention ? " is-attention" : ""}`}>{p.status(item)}</span>
        {item.attention === "expiring" && <small>{p.t("ops.w.expiring")}</small>}</td>
      <td data-label={p.t("ops.w.time")} className="ops-time">{p.when(item.queued_at)}</td>
      <td><button className="ops-view" disabled={disabled} onClick={() => onOpen(item)}>{p.t("ops.w.view")}</button></td>
    </tr>)}</tbody>
  </table></div>;
}

export function OperationsPagination({ pagination, disabled, onPage }: { pagination: OpsWorkbench["pagination"]; disabled: boolean; onPage: (page: number) => void }) {
  const { t } = useOpsPresentation();
  return <div className="ops-pagination">
    <span aria-live="polite">{t("ops.w.page", pagination)}</span><div>
      <button className="secondary" disabled={disabled || pagination.page <= 1} onClick={() => onPage(pagination.page - 1)}>{t("ops.w.previous")}</button>
      <button className="secondary" disabled={disabled || pagination.page >= pagination.pages} onClick={() => onPage(pagination.page + 1)}>{t("ops.w.next")}</button>
    </div>
  </div>;
}
