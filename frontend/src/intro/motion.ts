import { useEffect, useRef, useState } from "react";

const GLYPHS = "/\\<>_-=+*#0123456789$¥฿€£";

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/** Resolves text left to right out of random glyphs once `active` turns true. */
export function useScramble(text: string, active: boolean, duration = 700): string {
  const [shown, setShown] = useState(text);
  useEffect(() => {
    if (!active || prefersReducedMotion()) { setShown(text); return; }
    const chars = [...text];
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const settled = Math.floor(Math.min(1, Math.max(0, (now - start) / duration)) * chars.length);
      setShown(chars.map((ch, i) => i < settled || ch === " " ? ch : GLYPHS[(Math.random() * GLYPHS.length) | 0]).join(""));
      if (settled < chars.length) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [text, active, duration]);
  return shown;
}

/** True once the element has scrolled into view; stays true afterwards. */
export function useReveal<T extends Element>() {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); observer.disconnect(); }
    }, { threshold: 0.2 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, visible] as const;
}

let webgl2: boolean | undefined;
/** Whether a WebGL 2 context can be created; probed once. */
export function supportsWebGL2(): boolean {
  if (webgl2 === undefined) {
    try { webgl2 = !!document.createElement("canvas").getContext("webgl2"); } catch { webgl2 = false; }
  }
  return webgl2;
}
