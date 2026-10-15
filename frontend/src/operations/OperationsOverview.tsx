import { useOpsPresentation } from "./presenters";
import { OperationsQueue } from "./OperationsQueue";
import { groups } from "./workbench";
import type { OpsItem, OpsNavigation, OpsWorkbench } from "./types";

type Navigate = (navigation: OpsNavigation, status?: string) => void;
export function OperationsOverview({ data, navigate, onOpen, disabled }: { data: OpsWorkbench; navigate: Navigate; onOpen: (item: OpsItem) => void; disabled: boolean }) {
  const { t } = useOpsPresentation();
  const tasks = (kind: OpsNavigation["kind"] = "all", attention: OpsNavigation["attention"] = "all") => navigate({ view: "tasks", kind, attention });
  return <>
    <div className="ops-metrics">{(["total", "expiring", "unknown", "unverified"] as const).map((key, index) => <button key={key} className={`ops-metric metric-${key}`}
      onClick={() => tasks(key === "unverified" ? "payees" : "all", key === "expiring" || key === "unknown" ? key : "all")}>
      <span><i aria-hidden="true">{String(index + 1).padStart(2, "0")}</i>{t(`ops.w.${key}`)}</span><strong>{data.summary[key]}</strong><small>{t(`ops.w.${key}Hint`)}</small>
    </button>)}</div>
    <div className="ops-charts">
      <section className="ops-panel"><h2>{t("ops.w.distribution")}</h2><p className="ops-caption">{t("ops.w.totalHint")}</p>
        <div className="ops-bars">{groups.map(group => <ChartBar key={group} label={t(`ops.w.${group}`)} value={data.summary.by_kind[group]}
          maximum={Math.max(1, ...groups.map(kind => data.summary.by_kind[kind] ?? 0))} onClick={() => tasks(group)} />)}</div>
      </section>
      <section className="ops-panel"><h2>{t("ops.w.recentChart")}</h2><p className="ops-caption">{t("ops.w.recentHint")}</p>
        {!data.recent_decisions.length ? <p className="ops-chart-empty">{t("ops.w.noHistory")}</p> : <div className="ops-bars">
          {(["APPROVED", "USED", "REJECTED", "EXPIRED"] as const).map(status => <ChartBar key={status} tone={status.toLowerCase()} label={t(`approval.${status}`)}
            value={data.recent_decisions.filter(row => row.status === status).length} maximum={data.recent_decisions.length}
            onClick={() => navigate({ view: "history", kind: "all", attention: "all" }, status)} />)}
        </div>}
      </section>
    </div>
    <section className="ops-panel ops-priority"><div className="ops-panel-heading"><h2>{t("ops.w.priority")}</h2><button className="ops-view" onClick={() => tasks()}>{t("ops.w.viewAll")}</button></div>
      <OperationsQueue items={data.items.slice(0, 5)} onOpen={onOpen} disabled={disabled}/>
    </section>
  </>;
}

function ChartBar({ label, value, maximum, onClick, tone = "default" }: { label: string; value: number; maximum: number; onClick: () => void; tone?: string }) {
  return <button className={`ops-bar bar-${tone}`} onClick={onClick} aria-label={`${label}: ${value}`}>
    <span>{label}</span><strong>{value}</strong><meter min={0} max={maximum} value={value} aria-label={label}>{value}</meter>
  </button>;
}
