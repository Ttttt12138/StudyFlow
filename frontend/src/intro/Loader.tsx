import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { prefersReducedMotion } from "./motion";

const FILL_MS = 1600;
const FRAME_MS = 66; // the glyph grid redraws at about 15 fps
const FLICKER = "0123456789$¥฿€£";

/**
 * Opening screen: a grid of slashes fills outward from the centre while the counter climbs,
 * with currency glyphs flickering along the edge of the filled area. It waits for the web
 * fonts (or a short timeout) before reaching 100, then wipes upwards and calls onDone.
 */
export function Loader({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const gridRef = useRef<HTMLPreElement>(null);
  const [progress, setProgress] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const finishRef = useRef<() => void>(() => {});
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    const reduced = prefersReducedMotion();
    let ready = false;
    let finished = false;
    let frame = 0;
    const timers: number[] = [];
    const markReady = () => { ready = true; };
    (document.fonts?.ready ?? Promise.resolve()).then(markReady, markReady);
    timers.push(window.setTimeout(markReady, 2500));

    const finish = () => {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(frame);
      setProgress(100);
      if (gridRef.current) gridRef.current.textContent = gridRef.current.textContent?.replace(/[^\s]/g, "/") ?? "";
      timers.push(window.setTimeout(() => setLeaving(true), reduced ? 0 : 260));
      timers.push(window.setTimeout(() => doneRef.current(), reduced ? 250 : 1000));
    };
    finishRef.current = finish;

    if (reduced) {
      const poll = window.setInterval(() => { if (ready) { window.clearInterval(poll); finish(); } }, 100);
      timers.push(poll);
      return () => { timers.forEach((id) => { window.clearTimeout(id); window.clearInterval(id); }); };
    }

    // Each cell fills when progress passes its threshold: distance from the centre plus noise.
    const cols = Math.max(14, Math.min(96, Math.floor(window.innerWidth / 20)));
    const rows = Math.max(10, Math.min(40, Math.floor(window.innerHeight / 28)));
    const thresholds = new Float32Array(cols * rows);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const dx = (x - cols / 2) / (cols / 2), dy = (y - rows / 2) / (rows / 2);
      thresholds[y * cols + x] = Math.min(1, Math.hypot(dx, dy) * 0.72 + Math.random() * 0.28);
    }

    const start = performance.now();
    let value = 0, last = 0;
    const draw = () => {
      const p = value / 100;
      let text = "";
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const th = thresholds[y * cols + x];
          text += th < p - 0.08 ? "/" : th < p ? FLICKER[(Math.random() * FLICKER.length) | 0] : " ";
        }
        text += "\n";
      }
      if (gridRef.current) gridRef.current.textContent = text;
    };
    const tick = (now: number) => {
      // Time-based (ease-out cubic) so throttled frames cannot slow the loader down.
      const elapsed = Math.min(1, Math.max(0, (now - start) / FILL_MS));
      value = Math.min(ready ? 100 : 86, (1 - (1 - elapsed) ** 3) * 100);
      if (now - last > FRAME_MS) { last = now; draw(); setProgress(Math.floor(value)); }
      if (value >= 100) finish();
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); timers.forEach((id) => window.clearTimeout(id)); };
  }, []);

  const done = progress >= 100;
  return (
    <div className={`intro-loader${leaving ? " is-leaving" : ""}`}>
      <pre ref={gridRef} className="intro-loader-grid" aria-hidden="true" />
      <p className="intro-visually-hidden" role="status">{t("intro.loading")}</p>
      <div className="intro-loader-meta" aria-hidden="true">
        <span className="intro-loader-label">{t("intro.loaderLabel")}</span>
        <span className={`intro-loader-count${done ? " is-done" : ""}`}>
          {done ? <span>{t("intro.loaderReady")}</span> : <>{String(progress).padStart(3, "0")}<small> / 100</small></>}
        </span>
      </div>
      <button type="button" className="intro-loader-skip" onClick={() => finishRef.current()}>{t("intro.skip")}</button>
    </div>
  );
}
