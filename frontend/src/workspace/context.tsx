import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../i18n";
import type { ToolKind, ToolTarget } from "./navigation";
import type { PreviewStage } from "../plan/preview";

/** What the planner tells the workspace shell: the plan's stage decides which tools exist. */
export type PlanState = { status: "DRAFT" | "CONFIRMED" | "ENROLLED" | null; gap: boolean };

export const WorkspaceContext = createContext<{
  target: ToolTarget | null; host: HTMLElement | null; open: (target: ToolTarget) => void;
  /** Top-bar slot the reminder bell renders into. */
  bellHost?: HTMLElement | null;
  close: () => void; setStage: (stage: PreviewStage) => void; account?: string;
  reportPlan?: (state: PlanState) => void;
} | null>(null);
export const ToolContext = createContext({ embedded: false, active: true });
export const useWorkspace = () => useContext(WorkspaceContext);
export const useToolActive = () => useContext(ToolContext).active;
export const useEmbedded = () => useContext(ToolContext).embedded;

export function ToolSlot({ kind, children }: { kind: ToolKind; children: ReactNode }) {
  const workspace = useWorkspace();
  const active = workspace?.target?.kind === kind;
  const [visited, setVisited] = useState(active);
  useEffect(() => { if (active) setVisited(true); }, [active]);
  if (!workspace?.host || (!active && !visited)) return null;
  return createPortal(<ToolContext.Provider value={{ embedded: true, active }}>
    <div className="tool-content" data-tool={kind} hidden={!active} inert={!active}>{children}</div>
  </ToolContext.Provider>, workspace.host);
}

export function useToolRefresh(refresh: () => unknown | Promise<unknown>) {
  const active = useToolActive();
  const callback = useRef(refresh);
  callback.current = refresh;
  const first = useRef(true);
  const [stale, setStale] = useState(false);
  const run = async () => {
    try {
      const result = await callback.current() as { errors?: Record<string, string> } | undefined;
      setStale(!!result?.errors && Object.keys(result.errors).length > 0);
    } catch { setStale(true); }
  };
  const runner = useRef(run); runner.current = run;
  useEffect(() => {
    if (!active) return;
    if (!first.current) void runner.current();
    first.current = false;
    let timer: ReturnType<typeof setTimeout>;
    const changed = () => { clearTimeout(timer); timer = setTimeout(() => void runner.current(), 150); };
    window.addEventListener("studyflow:write", changed);
    return () => { clearTimeout(timer); window.removeEventListener("studyflow:write", changed); };
  }, [active]);
  const { t } = useI18n();
  return stale ? <p role="alert" className="workspace-stale">{t("ws.stale")} <button type="button" onClick={() => void run()}>{t("common.refresh")}</button></p> : null;
}

export function useClearWhenHidden(clear: () => void) {
  const active = useToolActive();
  const callback = useRef(clear); callback.current = clear;
  useEffect(() => { if (!active) callback.current(); }, [active]);
}
