import { useEffect, useState, type RefObject } from "react";

export function useStripHeight(frame: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const strip = document.querySelector(".sim-strip");
    if (!strip) return;
    const sync = () => frame.current?.style.setProperty("--strip-height", `${strip.getBoundingClientRect().height}px`);
    const observer = new ResizeObserver(sync); observer.observe(strip); sync();
    return () => observer.disconnect();
  }, [frame]);
}

export function useSmallScreen() {
  const [small, setSmall] = useState(() => window.innerWidth < 1100);
  useEffect(() => {
    const media = matchMedia("(max-width: 1099px)");
    const resized = () => setSmall(media.matches);
    media.addEventListener("change", resized);
    return () => media.removeEventListener("change", resized);
  }, []);
  return small;
}

function trapFocus(event: KeyboardEvent, dock: HTMLElement) {
  const nodes = [...dock.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex="0"]')]
    .filter(node => !node.closest("[hidden]") && !node.hasAttribute("disabled") && node.getClientRects().length > 0);
  const first = nodes[0], last = nodes.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
}

export function useDockKeyboard(dock: RefObject<HTMLElement | null>, state: { targetKey: string; modal: boolean; menu: boolean }, close: () => void) {
  useEffect(() => {
    if (state.targetKey === "null") return;
    dock.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [dock, state.targetKey, state.modal]);
  useEffect(() => {
    if (state.targetKey === "null") return;
    const keydown = (event: KeyboardEvent) => {
      if (document.querySelector("dialog[open]") || state.menu) return;
      // An open panel sheet handles its own Escape and closes before the tool does.
      if (event.key === "Escape" && dock.current?.querySelector(".panel-sheet")) return;
      if (event.key === "Escape") { event.preventDefault(); close(); }
      if (event.key === "Tab" && state.modal && dock.current) trapFocus(event, dock.current);
    };
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  }, [dock, state.targetKey, state.modal, state.menu, close]);
}
