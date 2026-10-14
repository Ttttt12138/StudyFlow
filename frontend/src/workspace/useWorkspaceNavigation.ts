import { useCallback, useEffect, useRef, useState } from "react";
import { appendTool, readWorkspaceRoute, workspaceUrl, type ToolTarget, type WorkspaceRoute } from "./navigation";

/** The dock's return stack travels with each history entry, so the browser's back button and the header's agree. */
type Entry = { studyflowStack?: ToolTarget[] };
const stackOf = (state: unknown, route: WorkspaceRoute) =>
  (state as Entry | null)?.studyflowStack ?? (route.tool ? [route.tool] : []);

export function useWorkspaceNavigation(preview: boolean) {
  const [route, setRoute] = useState<WorkspaceRoute>(() => ({ ...readWorkspaceRoute(window.location.href), preview }));
  const [stack, setStack] = useState<ToolTarget[]>(() => stackOf(history.state, route));
  const [menu, setMenu] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const current = useRef({ route, stack }); current.current = { route, stack };
  // Detail pages inside the open tool (PanelPage) register their own back; the header closes those first.
  const inner = useRef<{ id: number; back: () => void }[]>([]);
  const [innerCount, setInnerCount] = useState(0);
  const navigate = useCallback((next: WorkspaceRoute, nextStack: ToolTarget[]) => {
    current.current = { route: next, stack: nextStack }; setRoute(next); setStack(nextStack);
    history.pushState({ studyflowStack: nextStack } satisfies Entry, "", workspaceUrl(next));
  }, []);
  useEffect(() => { history.replaceState({ ...(history.state ?? {}), studyflowStack: stack } satisfies Entry, ""); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  /** `root` (the sidebar) starts a fresh trail; a link inside a tool adds to it, so back returns to that tool. */
  const open = (target: ToolTarget, options: { root?: boolean } = {}) => {
    const { route: now, stack: trail } = current.current;
    if (!now.tool) opener.current = document.activeElement as HTMLElement;
    setMenu(false);
    navigate({ ...now, tool: target }, options.root ? [target] : appendTool(trail, target));
  };
  const close = useCallback(() => {
    navigate({ ...current.current.route, tool: null }, []); setExpanded(false); setMenu(false);
    requestAnimationFrame(() => {
      const target = opener.current?.isConnected ? opener.current : document.querySelector<HTMLElement>(".plan-composer textarea:not(:disabled), .workspace-menu-button");
      target?.focus();
    });
  }, [navigate]);
  /** Where the header's back goes: the open detail page first, then the tool this one was opened from. */
  const backTarget: "page" | ToolTarget | null = innerCount > 0 ? "page" : stack.length > 1 ? stack[stack.length - 2] : null;
  const back = () => {
    const page = inner.current.at(-1);
    if (page) { page.back(); return; }
    const { route: now, stack: trail } = current.current;
    if (trail.length < 2) return;
    const previous = trail.slice(0, -1);
    navigate({ ...now, tool: previous.at(-1)! }, previous);
  };
  const registerBack = useCallback((back: () => void) => {
    const id = Math.random();
    inner.current = [...inner.current, { id, back }]; setInnerCount(inner.current.length);
    return () => { inner.current = inner.current.filter(item => item.id !== id); setInnerCount(inner.current.length); };
  }, []);
  useEffect(() => {
    const popped = (event: PopStateEvent) => {
      const next = readWorkspaceRoute(window.location.href);
      setRoute(next); setStack(stackOf(event.state, next)); setMenu(false);
    };
    window.addEventListener("popstate", popped);
    return () => window.removeEventListener("popstate", popped);
  }, []);
  return { route, stack, menu, setMenu, expanded, setExpanded, open, close, back, backTarget, registerBack,
    setStage: (stage: WorkspaceRoute["stage"]) => navigate({ ...current.current.route, stage, tool: null }, []) };
}
