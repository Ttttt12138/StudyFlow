import { useCallback, useEffect, useRef, useState } from "react";
import { appendTool, readWorkspaceRoute, workspaceUrl, type ToolTarget, type WorkspaceRoute } from "./navigation";

export function useWorkspaceNavigation(preview: boolean) {
  const [route, setRoute] = useState<WorkspaceRoute>(() => ({ ...readWorkspaceRoute(window.location.href), preview }));
  const [stack, setStack] = useState<ToolTarget[]>(() => route.tool ? [route.tool] : []);
  const [menu, setMenu] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const current = useRef(route); current.current = route;
  const navigate = useCallback((next: WorkspaceRoute) => {
    current.current = next; setRoute(next); history.pushState(null, "", workspaceUrl(next));
  }, []);
  const open = (target: ToolTarget) => {
    if (!route.tool) opener.current = document.activeElement as HTMLElement;
    setStack(previous => appendTool(previous, target)); setMenu(false);
    navigate({ ...route, tool: target });
  };
  const close = useCallback(() => {
    navigate({ ...current.current, tool: null }); setStack([]); setExpanded(false); setMenu(false);
    requestAnimationFrame(() => {
      const target = opener.current?.isConnected ? opener.current : document.querySelector<HTMLElement>('[aria-controls="workspace-tools"]');
      target?.focus();
    });
  }, [navigate]);
  const back = () => {
    const previous = stack.slice(0, -1); setStack(previous);
    navigate({ ...route, tool: previous.at(-1) ?? null });
  };
  useEffect(() => {
    const popped = () => { const next = readWorkspaceRoute(window.location.href); setRoute(next); setStack(next.tool ? [next.tool] : []); setMenu(false); };
    window.addEventListener("popstate", popped);
    return () => window.removeEventListener("popstate", popped);
  }, []);
  return { route, stack, menu, setMenu, expanded, setExpanded, open, close, back,
    setStage: (stage: "plan" | "school") => { setStack([]); navigate({ ...route, stage, tool: null }); } };
}
