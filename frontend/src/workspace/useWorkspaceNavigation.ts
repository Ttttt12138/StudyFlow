import { useCallback, useEffect, useRef, useState } from "react";
import { readWorkspaceRoute, workspaceUrl, type ToolTarget, type WorkspaceRoute } from "./navigation";

export function useWorkspaceNavigation(preview: boolean) {
  const [route, setRoute] = useState<WorkspaceRoute>(() => ({ ...readWorkspaceRoute(window.location.href), preview }));
  const [menu, setMenu] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const current = useRef(route); current.current = route;
  // Detail pages inside the open tool (PanelPage) register their own back; the header closes those first.
  const inner = useRef<{ id: number; back: () => void; label?: string }[]>([]);
  const [innerCount, setInnerCount] = useState(0);
  const [innerLabel, setInnerLabel] = useState<string | undefined>();
  const navigate = useCallback((next: WorkspaceRoute) => {
    current.current = next; setRoute(next);
    history.pushState(null, "", workspaceUrl(next));
  }, []);
  const open = (target: ToolTarget) => {
    const now = current.current;
    if (!now.tool) opener.current = document.activeElement as HTMLElement;
    setMenu(false);
    navigate({ ...now, tool: target });
  };
  const close = useCallback(() => {
    navigate({ ...current.current, tool: null }); setExpanded(false); setMenu(false);
    requestAnimationFrame(() => {
      const target = opener.current?.isConnected ? opener.current : document.querySelector<HTMLElement>(".plan-composer textarea:not(:disabled), .workspace-menu-button");
      target?.focus();
    });
  }, [navigate]);
  /**
   * The header's back goes one level up within the feature, never to whatever was viewed before: the open detail
   * page or sub-view first, then the tool's own parent (a price result opened from the comparison list). A tool
   * opened from the chat or another tool has no level above it; the header then only closes.
   */
  const parent = route.tool?.parent;
  const backTarget: "page" | ToolTarget | null = innerCount > 0 ? "page" : parent ? { kind: parent } : null;
  const back = () => {
    const page = inner.current.at(-1);
    if (page) { page.back(); return; }
    const up = current.current.tool?.parent;
    if (up) navigate({ ...current.current, tool: { kind: up } });
  };
  const registerBack = useCallback((back: () => void, label?: string) => {
    const id = Math.random();
    const changed = () => { setInnerCount(inner.current.length); setInnerLabel(inner.current.at(-1)?.label); };
    inner.current = [...inner.current, { id, back, label }]; changed();
    return () => { inner.current = inner.current.filter(item => item.id !== id); changed(); };
  }, []);
  useEffect(() => {
    const popped = (event: PopStateEvent) => {
      const next = readWorkspaceRoute(window.location.href);
      current.current = next; setRoute(next); setMenu(false);
    };
    window.addEventListener("popstate", popped);
    return () => window.removeEventListener("popstate", popped);
  }, []);
  return { route, menu, setMenu, expanded, setExpanded, open, close, back, backTarget, backPageLabel: innerLabel, registerBack,
    setStage: (stage: WorkspaceRoute["stage"]) => navigate({ ...current.current, stage, tool: null }) };
}
