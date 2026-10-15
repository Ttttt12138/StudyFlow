import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChartBar } from "@phosphor-icons/react/dist/csr/ChartBar";
import { ListChecks } from "@phosphor-icons/react/dist/csr/ListChecks";
import { ClockCounterClockwise } from "@phosphor-icons/react/dist/csr/ClockCounterClockwise";
import { SessionWalletClient, WalletApiError, type WalletClient } from "../wallet/client";
import { createOperationsPreview } from "./previewAdapter";
import { useOpsPresentation } from "./presenters";
import { useWorkbench } from "./useWorkbench";
import { groups, itemKey, navigationFromHash } from "./workbench";
import { OperationsOverview } from "./OperationsOverview";
import { OperationsQueue, OperationsPagination } from "./OperationsQueue";
import { OperationsHistory } from "./OperationsHistory";
import { OperationsDetail } from "./OperationsDetail";
import type { OpsCommand } from "./useOperationsCommands";
import type { OpsAttention, OpsGroup, OpsItem, OpsNavigation } from "./types";
import "../services/services.css";
import "./operations.css";

const icons = { overview: ChartBar, tasks: ListChecks, history: ClockCounterClockwise };
const signInUrl = `/auth?next=${encodeURIComponent(window.location.origin + "/ops")}`;

export function OperationsApp({ preview, onExit }: { preview: boolean; onExit: () => void }) {
  const p = useOpsPresentation();
  const client = useMemo<WalletClient>(() => preview ? createOperationsPreview() : new SessionWalletClient(), [preview]);
  const [navigation, setNavigation] = useState(() => navigationFromHash(window.location.hash));
  const [student, setStudent] = useState("");
  const [page, setPage] = useState(1);
  const [historyStatus, setHistoryStatus] = useState("all");
  const [selected, setSelected] = useState<OpsItem | null>(null);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [savedRefreshFailed, setSavedRefreshFailed] = useState(false);
  const load = useWorkbench(client, { student, kind: navigation.kind, attention: navigation.attention, page });
  const { data } = load;
  const denied = load.error instanceof WalletApiError && [401, 403].includes(load.error.status);
  const refreshError = load.error && !denied ? p.t(savedRefreshFailed ? "ops.w.savedRefreshFailed" : "ops.w.readFailed") : "";
  const locked = load.loading || load.stale || busy;

  useEffect(() => {
    const sync = () => { setNavigation(navigationFromHash(window.location.hash)); setPage(1); setSelected(null); setHistoryStatus("all"); };
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  useEffect(() => { setSelected(current => current && data?.items.find(row => itemKey(row) === itemKey(current)) || null); }, [data]);
  useEffect(() => { setNotice(""); setError(""); }, [data?.operator.id]);

  function navigate(next: OpsNavigation, status = "all") {
    setNavigation(next); setPage(1); setSelected(null); setHistoryStatus(status);
    const hash = next.view === "tasks" && next.kind !== "all" ? next.kind : next.view;
    history.pushState(null, "", `${window.location.pathname}${window.location.search}#ops-${hash}`);
  }
  const retry = useCallback(async () => { const result = await load.refresh(); if (result) setSavedRefreshFailed(false); }, [load.refresh]);
  async function run(command: OpsCommand) {
    if (running.current || preview || locked) return;
    running.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const message = await command.act();
      setNotice(message);
      const fresh = await load.refresh();
      setSavedRefreshFailed(!fresh);
    } catch (reason) {
      setError(reason instanceof WalletApiError && reason.status === 409 ? p.t("ops.w.changed")
        : reason instanceof WalletApiError && reason.code === "SEPARATION_OF_DUTIES" ? p.t("ops.err.separation")
        : reason instanceof Error ? reason.message : p.t("ops.err.generic"));
      await load.refresh();
    } finally { running.current = false; setBusy(false); }
  }
  const open = (item: OpsItem) => { setSelected(item); setNotice(""); setError(""); };
  return <div className="app ops-app">
    <aside className="ops-sidebar">
      <a className="brand" href="/" onClick={event => { event.preventDefault(); onExit(); }}><span className="brand-icon">S</span>StudyFlow<span className="brand-dot">.</span></a>
      <span className="ops-side-label">{p.t("ops.side.label")}</span>
      <nav aria-label={p.t("ops.side.nav")}>{(["overview", "tasks", "history"] as const).map(view => {
        const Icon = icons[view];
        return <button key={view} aria-current={navigation.view === view ? "page" : undefined} onClick={() => navigate({ view, kind: "all", attention: "all" })}>
          <Icon size={19}/><span>{p.t(`ops.w.${view}`)}</span>{view === "tasks" && data && <span className="ops-count">{data.summary.total}</span>}
        </button>;
      })}</nav>
      <div className="ops-sidebar-bottom"><span className="ops-staff-label">{p.t("ops.eyebrow")}</span><button className="secondary" onClick={onExit}>{p.t("role.toStudent")}</button></div>
    </aside>
    <div className="workspace ops-workspace"><main>
      <div className="ops-heading"><div><span className="ops-eyebrow">{p.t("ops.title")}</span><h1 id="ops-page-title" tabIndex={-1}>{p.t(`ops.w.${navigation.view}`)}</h1><p>{p.t("ops.w.subtitle")}</p></div>
        <div className="ops-heading-meta">{data && <span>{p.t("ops.w.operator", { name: data.operator.username })}</span>}
          <button className="secondary" disabled={load.loading || busy} onClick={() => void retry()}>{p.t("common.refresh")}</button></div>
      </div>
      {preview && <p className="ops-preview">{p.t("ops.preview.title")} · {p.t("ops.preview.text")}</p>}
      <div className="ops-toolbar"><label className="ops-field">{p.t("ops.filter")}<input type="search" value={student} placeholder={p.t("ops.filterPlaceholder")}
        onChange={event => { setStudent(event.target.value); setPage(1); }}/></label>
        {data && <small>{p.t("ops.w.updated", { time: p.when(data.generated_at) })}</small>}
      </div>
      {!selected && notice && <p className="ops-notice" role="status">{notice}</p>}
      {!selected && error && <p className="ops-error" role="alert">{error}</p>}
      {!selected && refreshError && <div className="ops-error" role="alert">{refreshError} <button className="ops-view" disabled={load.loading} onClick={() => void retry()}>{p.t("ops.w.retry")}</button></div>}
      {denied && <section className="ops-panel ops-empty"><h2>{p.t("ops.denied.title")}</h2><p>{p.t(load.error instanceof WalletApiError && load.error.status === 401 ? "ops.denied.signedOut" : "ops.denied.student")}</p><a className="primary" href={signInUrl}>{p.t("ops.denied.signIn")}</a></section>}
      {load.loading && !data && <p role="status">{p.t("common.loading")}</p>}
      {data && <div className={`ops-content${load.loading ? " is-loading" : ""}`} aria-busy={load.loading}>
        {navigation.view === "overview" && <OperationsOverview data={data} navigate={navigate} onOpen={open} disabled={locked}/>}
        {navigation.view === "tasks" && <section className="ops-panel">
          <div className="ops-panel-heading"><h2>{p.t("ops.w.tasks")}</h2><div className="ops-filters">
            <label className="ops-field">{p.t("ops.w.type")}<select aria-label={p.t("ops.w.type")} value={navigation.kind} onChange={event => { setNavigation({ ...navigation, kind: event.target.value as OpsGroup | "all" }); setPage(1); }}>
              <option value="all">{p.t("ops.w.allTypes")}</option>{groups.map(group => <option key={group} value={group}>{p.t(`ops.w.${group}`)}</option>)}
            </select></label>
            <label className="ops-field">{p.t("ops.w.attention")}<select aria-label={p.t("ops.w.attention")} value={navigation.attention} onChange={event => { setNavigation({ ...navigation, attention: event.target.value as OpsAttention }); setPage(1); }}>
              <option value="all">{p.t("ops.w.allAttention")}</option><option value="expiring">{p.t("ops.w.expiring")}</option><option value="unknown">{p.t("ops.w.unknown")}</option>
            </select></label></div></div><p className="ops-caption">{p.t("ops.w.scope")}</p>
          <OperationsQueue items={data.items} onOpen={open} disabled={locked}/><OperationsPagination pagination={data.pagination} disabled={locked} onPage={setPage}/>
        </section>}
        {navigation.view === "history" && <OperationsHistory rows={data.recent_decisions} status={historyStatus} onStatus={setHistoryStatus}/>}
      </div>}
    </main></div>
    {selected && data && <OperationsDetail key={itemKey(selected)} item={selected} operatorId={data.operator.id} client={client} locked={locked || preview} busy={busy}
      notice={notice} error={error} refreshError={refreshError} onClose={() => setSelected(null)} onRun={run} onRetry={() => void retry()}/>}
  </div>;
}
