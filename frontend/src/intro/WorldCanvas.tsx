import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { World } from "./cinema/world";
import { prefersReducedMotion, supportsWebGL2 } from "./motion";

export type WorldState = { world: World | null; failed: boolean };
export const WorldContext = createContext<WorldState>({ world: null, failed: true });
export const useWorld = () => useContext(WorldContext);

/**
 * The one full-screen WebGL canvas behind the intro: opening and feature helix share it, so
 * the camera moves through them in a single shot. three.js is fetched on demand; without
 * WebGL 2 a static glyph stands in. `active` starts the opening reveal once the loader is gone.
 */
export function WorldCanvas({ active, onChange }: { active: boolean; onChange(state: WorldState): void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const worldRef = useRef<World | null>(null);
  const activeRef = useRef(active);
  const onChangeRef = useRef(onChange);
  const [fallback, setFallback] = useState(() => !supportsWebGL2());
  const [ready, setReady] = useState(false);
  activeRef.current = active;
  onChangeRef.current = onChange;

  useEffect(() => {
    if (fallback) { onChangeRef.current({ world: null, failed: true }); return; }
    let cancelled = false;
    // Shader compilation blocks the main thread briefly; wait for an idle moment so the
    // loader and the headline animation stay smooth.
    const idle = () => new Promise<void>((resolve) => {
      if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(() => resolve(), { timeout: 1200 });
      else setTimeout(resolve, 300);
    });
    Promise.all([import("./cinema/world"), idle()]).then(async ([{ createWorld }]) => {
      if (cancelled) return;
      const world = await createWorld(canvasRef.current!, hostRef.current!, { reducedMotion: prefersReducedMotion() });
      if (cancelled) { world.dispose(); return; }
      worldRef.current = world;
      setReady(true);
      onChangeRef.current({ world, failed: false });
      if (activeRef.current) world.start();
    }).catch(() => { if (!cancelled) setFallback(true); });
    return () => {
      cancelled = true;
      worldRef.current?.dispose();
      worldRef.current = null;
      onChangeRef.current({ world: null, failed: false });
    };
  }, [fallback]);

  useEffect(() => { if (active) worldRef.current?.start(); }, [active, ready]);

  return (
    <div ref={hostRef} className={`intro-world${ready ? " is-ready" : ""}`} aria-hidden="true">
      {fallback ? <span className="intro-hero-fallback">S/</span> : <canvas ref={canvasRef} />}
    </div>
  );
}
