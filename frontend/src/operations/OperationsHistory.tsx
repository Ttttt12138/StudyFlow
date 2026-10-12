import { useOpsPresentation } from "./presenters";
import type { OpsApproval } from "./types";

export function OperationsHistory({ rows, status, onStatus }: { rows: OpsApproval[]; status: string; onStatus: (status: string) => void }) {
  const p = useOpsPresentation();
  const filtered = rows.filter(row => status === "all" || row.status === status);
  return <section className="ops-panel" id="ops-decisions"><div className="ops-panel-heading"><h2>{p.t("ops.w.recordsTitle")}</h2>
    <label className="ops-field">{p.t("ops.w.status")}<select aria-label={p.t("ops.w.status")} value={status} onChange={event => onStatus(event.target.value)}>
      <option value="all">{p.t("ops.w.allStatuses")}</option>{(["APPROVED", "USED", "REJECTED", "EXPIRED"] as const).map(value => <option key={value} value={value}>{p.t(`approval.${value}`)}</option>)}
    </select></label></div><p className="ops-caption">{p.t("ops.w.recentHint")}</p>
    {!filtered.length ? <div className="ops-empty">{p.t("ops.w.noHistory")}</div> : <div className="ops-table-wrap"><table className="ops-table">
      <thead><tr><th>{p.t("ops.filter")}</th><th>{p.t("ops.w.subject")}</th><th>{p.t("ops.w.status")}</th><th>{p.t("ops.decisions.by")}</th><th>{p.t("ops.w.recorded")}</th><th>{p.t("ops.w.note")}</th></tr></thead>
      <tbody>{filtered.map(row => <tr key={row.id}>
        <td data-label={p.t("ops.filter")}>{row.owner_username}</td><td data-label={p.t("ops.w.subject")}>{p.actionName(row.action)}<small>{p.money(row.amount, row.currency)}</small></td>
        <td data-label={p.t("ops.w.status")}><span className={`ops-status status-${row.status.toLowerCase()}`}>{p.t(`approval.${row.status}` as Parameters<typeof p.t>[0])}</span></td>
        <td data-label={p.t("ops.decisions.by")}>{row.decided_by_username ?? "—"}</td><td data-label={p.t("ops.w.recorded")}>{p.when(row.activity_at ?? row.decided_at ?? row.expires_at)}</td>
        <td data-label={p.t("ops.w.note")}>{row.decision_note || "—"}</td>
      </tr>)}</tbody>
    </table></div>}
  </section>;
}
