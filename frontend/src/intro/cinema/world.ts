import { HalfFloatType, PerspectiveCamera, Raycaster, Scene, Vector2, Vector3, WebGLRenderTarget, WebGLRenderer, type ShaderMaterial } from "three";
import type { CardContent } from "../wall/cards";
import { createBackdrop, createEnvironment } from "./environment";
import { createBokeh, createMonogram, createRibbons } from "./objects";
import { createPost } from "./post";
import { createGlobe } from "./globe";
import { SLAB_RADIUS, SLAB_STEP_ANGLE, SLAB_STEP_DROP, createSlabs } from "./slabs";
import { createStreaks } from "./streaks";
import { createVault } from "./vault";

export type FeatureHandlers = { onSelect(index: number): void; onHover(index: number | null): void };
export type SectionName = "features" | "safety" | "start";
export type World = {
  /** Starts the opening reveal (after the loader). */
  start(): void;
  /** Registers (or clears) a page section whose scroll position drives part of the camera path. */
  setSection(name: SectionName, section: HTMLElement | null): void;
  setFeatureHandlers(handlers: FeatureHandlers | null): void;
  setCards(cards: CardContent[]): void;
  dispose(): void;
};

const FEATURE_COUNT = 7;
// The strands' axis; the helix of slabs wraps around it below the monogram.
const AXIS = new Vector3(0, 0, -0.9);
const HELIX_TOP = -10;
const HELIX_BOTTOM = HELIX_TOP - (FEATURE_COUNT - 1) * SLAB_STEP_DROP;
const SAFETY_STEPS = 3;
// Below the helix the strands end in the safety vault; further down hangs the globe.
const VAULT = new Vector3(0, HELIX_BOTTOM - 9, AXIS.z);
const GLOBE = new Vector3(0, VAULT.y - 14, AXIS.z);
const TEAL = new Vector3(0.003, 0.016, 0.014);
const GOLD = new Vector3(0.016, 0.012, 0.004);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const easeOut = (t: number) => 1 - (1 - clamp01(t)) ** 3;
const easeInOut = (t: number) => { const x = clamp01(t); return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2; };
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * The whole cinematic intro as one scene seen by one camera. At the top the camera holds on
 * the glass monogram between the two chrome strands; scrolling dives it down the strands into
 * the helix of feature slabs and flies past them one per step, then descends to the hexagonal
 * safety vault (three steps) and finally to the globe. Scroll positions are read from the
 * page, so the DOM stays the source of truth.
 */
export async function createWorld(canvas: HTMLCanvasElement, host: HTMLElement, opts: { reducedMotion: boolean }): Promise<World> {
  const narrow = window.innerWidth < 760;
  const cores = navigator.hardwareConcurrency ?? 4;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, narrow ? 1.25 : 1.5);

  const renderer = new WebGLRenderer({ canvas, antialias: false, stencil: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(pixelRatio);

  const scene = new Scene();
  const environment = createEnvironment(renderer);
  scene.environment = environment;
  const backdrop = createBackdrop();
  scene.add(backdrop);
  const camera = new PerspectiveCamera(32, 1, 0.1, 100);

  const monogram = createMonogram(narrow ? 2.0 : 2.35);
  monogram.position.set(0, 0.3, 0);
  scene.add(monogram);
  const strands = createRibbons(narrow ? 700 : 1500, { top: 5.5, length: 5.5 - (VAULT.y + 1.5), radius: 0.55, flare: 0.9, z: AXIS.z });
  strands.forEach(({ tube, sleeve }) => scene.add(tube, sleeve));
  const bokehSpan = 6 - (GLOBE.y - 6);
  const bokeh = createBokeh(narrow ? 3600 : cores >= 8 ? 11000 : 7200, 6, bokehSpan);
  bokeh.material.uniforms.uPixelRatio.value = pixelRatio;
  scene.add(bokeh);
  const streaks = createStreaks(narrow ? 600 : 1400);
  scene.add(streaks.mesh);
  const slabs = createSlabs(renderer, scene, FEATURE_COUNT, AXIS, HELIX_TOP);
  const vault = createVault(narrow);
  vault.mesh.position.copy(VAULT);
  scene.add(vault.mesh);
  const globe = createGlobe();
  globe.group.position.copy(GLOBE);
  scene.add(globe.group);

  // The glass refracts a render of everything except itself.
  const behindGlass = new WebGLRenderTarget(1, 1, { type: HalfFloatType });
  const glass = monogram.material as ShaderMaterial;
  glass.uniforms.uScene.value = behindGlass.texture;
  const post = createPost(renderer, scene, camera, narrow);
  const { fluid } = post;

  // ---- layout ----
  let width = 1, height = 1;
  const layout = () => {
    width = Math.max(1, host.clientWidth);
    height = Math.max(1, host.clientHeight);
    renderer.setSize(width, height, false);
    post.setSize(width, height);
    camera.aspect = width / height;
    const buffer = renderer.getDrawingBufferSize(new Vector2());
    glass.uniforms.uResolution.value.copy(buffer);
    streaks.setResolution(buffer.x, buffer.y);
    // Phones already render at a low pixel ratio, so the refraction source stays full size there.
    const scale = narrow ? 1 : 0.6;
    behindGlass.setSize(Math.round(buffer.x * scale), Math.round(buffer.y * scale));
  };
  layout();
  const resizeObserver = new ResizeObserver(layout);
  resizeObserver.observe(host);

  // ---- scroll: dive → flight (features) → descent → steps (safety) → descent → globe (start) ----
  const sections: Record<SectionName, HTMLElement | null> = { features: null, safety: null, start: null };
  let handlers: FeatureHandlers | null = null;
  let dive = 0, flight = 0, toVault = 0, step = 0, toGlobe = 0, exit = 0;
  const bounds = (el: HTMLElement) => {
    const top = el.getBoundingClientRect().top + window.scrollY;
    return { top, span: Math.max(1, el.offsetHeight - window.innerHeight) };
  };
  const readScroll = () => {
    const y = window.scrollY, vh = window.innerHeight;
    const { features, safety, start } = sections;
    dive = flight = toVault = step = toGlobe = exit = 0;
    if (!features) {
      exit = clamp01((y / vh - 0.55) / 0.5);
    } else {
      const f = bounds(features);
      dive = clamp01(y / Math.max(1, f.top));
      flight = clamp01((y - f.top) / f.span) * (FEATURE_COUNT - 1);
      if (!safety) {
        exit = clamp01((y - f.top - f.span) / (vh * 0.6));
      } else {
        // Each descent runs while one sticky stage scrolls away and the next arrives.
        const s = bounds(safety);
        toVault = clamp01((y - f.top - f.span) / Math.max(1, s.top - f.top - f.span));
        step = clamp01((y - s.top) / s.span) * (SAFETY_STEPS - 1);
        if (start) {
          const g = bounds(start);
          toGlobe = clamp01((y - s.top - s.span) / Math.max(1, g.top - s.top - s.span));
        } else {
          exit = clamp01((y - s.top - s.span) / (vh * 0.6));
        }
      }
    }
    host.style.opacity = String(1 - exit);
  };
  window.addEventListener("scroll", readScroll, { passive: true });
  window.addEventListener("resize", readScroll);
  readScroll();

  // ---- pointer: fluid, streaks, slab hover and click ----
  const pointer = new Vector2(), smooth = new Vector2();
  let lastSplat: { x: number; y: number } | null = null;
  const splats: [number, number, number, number, Vector3][] = [];
  const ray = new Vector3(), hit = new Vector3(), lastHit = new Vector3(), throwVelocity = new Vector3(), jitter = new Vector3();
  const lastThrow = new Vector3(), origin = new Vector3(), forward = new Vector3(), lookAt = new Vector3();
  const raycaster = new Raycaster();
  let lastHitTime = -1, turn = 1, hovered: number | null = null;
  const inFlight = () => sections.features !== null && dive >= 0.98 && toVault < 0.02 && exit < 1;
  const atVault = () => toVault > 0.6 && toGlobe < 0.4;
  let vaultPointer: Vector3 | null = null;
  const vaultHit = new Vector3();

  // Streaks start on a plane facing the camera, a little short of what it looks at.
  const projectPointer = () => {
    ray.set(pointer.x, pointer.y, 0.5).unproject(camera).sub(camera.position).normalize();
    forward.subVectors(lookAt, camera.position);
    const depth = forward.length() * 0.85;
    forward.normalize();
    return hit.copy(camera.position).addScaledVector(ray, depth / Math.max(0.2, ray.dot(forward)));
  };
  const onPointerMove = (event: PointerEvent) => {
    const x = event.clientX / window.innerWidth, y = 1 - event.clientY / window.innerHeight;
    pointer.set(x * 2 - 1, y * 2 - 1);
    projectPointer();
    const now = performance.now() / 1000;
    if (lastHitTime > 0 && now - lastHitTime < 0.1) {
      throwVelocity.subVectors(hit, lastHit).divideScalar(Math.max(0.008, now - lastHitTime)).multiplyScalar(0.7);
      const speed = throwVelocity.length();
      if (speed > 0.15) {
        throwVelocity.clampLength(0, 7);
        // The streaks of one stroke share a bend, taken from which way the stroke is turning,
        // and are spread across the stroke so they read as a band of parallel arcs.
        const cross = lastThrow.x * throwVelocity.y - lastThrow.y * throwVelocity.x;
        if (Math.abs(cross) > 0.05) turn = Math.sign(cross);
        lastThrow.copy(throwVelocity);
        const across = new Vector3(-throwVelocity.y, throwVelocity.x, 0).normalize();
        const count = Math.min(8, 1 + Math.floor(speed * 1.3));
        for (let i = 0; i < count; i++) {
          const angle = (Math.random() - 0.5) * 0.5;
          jitter.set(
            throwVelocity.x * Math.cos(angle) - throwVelocity.y * Math.sin(angle),
            throwVelocity.x * Math.sin(angle) + throwVelocity.y * Math.cos(angle),
            throwVelocity.z + (Math.random() - 0.5) * 0.3,
          ).multiplyScalar(0.65 + Math.random() * 0.4);
          origin.lerpVectors(lastHit, hit, Math.random()).addScaledVector(across, (Math.random() - 0.5) * 0.5);
          streaks.spawn(origin, jitter, turn * (0.5 + Math.random() * 0.5), elapsed);
        }
      }
    }
    lastHit.copy(hit);
    lastHitTime = now;
    if (lastSplat) {
      const dx = (x - lastSplat.x) * 5600, dy = (y - lastSplat.y) * 5600;
      if (Math.abs(dx) + Math.abs(dy) > 1) splats.push([x, y, dx, dy, Math.random() < 0.18 ? GOLD : TEAL]);
    }
    lastSplat = { x, y };

    // The vault ripples where the pointer meets its plane.
    if (atVault()) {
      ray.set(pointer.x, pointer.y, 0.5).unproject(camera).sub(camera.position).normalize();
      vaultPointer = Math.abs(ray.z) > 1e-3 ? vaultHit.copy(camera.position).addScaledVector(ray, (VAULT.z - camera.position.z) / ray.z) : null;
    } else vaultPointer = null;
    const next = inFlight() ? (raycaster.setFromCamera(pointer, camera), slabs.pick(raycaster)) : null;
    if (next !== hovered) { hovered = next; handlers?.onHover(next); }
  };
  // The canvas sits under the page, so clicks are read on the window; real controls win.
  const onClick = (event: MouseEvent) => {
    if (!inFlight() || !handlers) return;
    if ((event.target as Element | null)?.closest("a, button, input, select, textarea, summary, label")) return;
    pointer.set((event.clientX / window.innerWidth) * 2 - 1, 1 - (event.clientY / window.innerHeight) * 2);
    raycaster.setFromCamera(pointer, camera);
    const index = slabs.pick(raycaster);
    if (index !== null) handlers.onSelect(index);
  };
  if (!opts.reducedMotion) {
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("click", onClick);
  }

  // ---- loop ----
  let frame = 0, running = false, last = performance.now(), elapsed = 0, started = -1, nextAmbient = 1;
  let diveEased = 0, flightEased = 0, slabReveal = 0, toVaultEased = 0, stepEased = 0, toGlobeEased = 0, vaultReveal = 0, globeReveal = 0;
  const tubeCounts = strands.map(({ tube }) => tube.geometry.index!.count);
  const openEye = new Vector3(), openLook = new Vector3(), helixEye = new Vector3(), helixLook = new Vector3();
  const vaultEye = new Vector3(), vaultLook = new Vector3(), globeEye = new Vector3(), globeLook = new Vector3();

  const update = (dt: number) => {
    elapsed += dt;
    const reveal = opts.reducedMotion ? 1 : started < 0 ? 0 : easeOut((elapsed - started) / 2.8);
    // Ease towards the scroll targets; snap when close so a leg can fully reach 0 or 1.
    const follow = 1 - Math.exp(-dt * 5);
    const ease = (from: number, to: number) => { const next = from + (to - from) * follow; return Math.abs(to - next) < 1e-4 ? to : next; };
    diveEased = ease(diveEased, dive);
    flightEased = ease(flightEased, flight);
    toVaultEased = ease(toVaultEased, toVault);
    stepEased = ease(stepEased, step);
    toGlobeEased = ease(toGlobeEased, toGlobe);
    smooth.lerp(pointer, 1 - Math.exp(-dt * 3));
    const k = easeInOut(diveEased);
    const wide = width / height > 1.1;

    // Opening pose: square on to the monogram.
    openEye.set(smooth.x * 0.35, 0.15 + smooth.y * 0.2, 8.6);
    openLook.set(0, 0.1, -0.6);
    // Helix pose: outside the helix beside the slab in focus, slightly above it.
    const distance = wide ? 6.9 : 8.2;
    const angle = flightEased * SLAB_STEP_ANGLE + smooth.x * 0.04;
    const reach = SLAB_RADIUS + distance;
    helixEye.set(
      AXIS.x + Math.sin(angle) * reach,
      HELIX_TOP - flightEased * SLAB_STEP_DROP + 0.35 + smooth.y * 0.18 + Math.sin(elapsed * 0.5) * 0.04,
      AXIS.z + Math.cos(angle) * reach);
    helixLook.copy(slabs.point(flightEased));
    // Vault pose: square on to the hex wall, drifting a little sideways with each safety step.
    const portrait = camera.aspect < 1;
    vaultEye.set(VAULT.x - 0.8 + stepEased * 0.8 + smooth.x * 0.3, VAULT.y - 0.6 + smooth.y * 0.2, VAULT.z + (portrait ? 17 : 13.5));
    // Look below the wall's centre so it sits in the upper half, leaving room for the copy.
    vaultLook.set(VAULT.x, VAULT.y - (portrait ? 2.6 : 1.7), VAULT.z);
    // Globe pose: straight on, slightly below the equator.
    globeEye.set(GLOBE.x + smooth.x * 0.4, GLOBE.y - 0.3 + smooth.y * 0.25, GLOBE.z + (portrait ? 19 : 12.5));
    globeLook.copy(GLOBE);

    const helixFov = wide ? 36 : 56, vaultFov = portrait ? 52 : 40, globeFov = portrait ? 52 : 38;
    const v = easeInOut(toVaultEased), g = easeInOut(toGlobeEased);
    // The legs are layered in order rather than chosen by branch, so every leg's weight goes
    // smoothly to zero and scrolling back up retraces the path (opening ← helix ← vault ← globe).
    camera.position.lerpVectors(openEye, helixEye, k);
    camera.position.x += Math.sin(k * Math.PI) * 2.2;
    lookAt.lerpVectors(openLook, helixLook, easeInOut(diveEased * 1.15 - 0.1));
    let fov = mix(portrait ? 46 : 32, helixFov, k);
    // Descent from the last slab: swing wide around the strands on the way down.
    camera.position.lerp(vaultEye, v);
    camera.position.x += Math.sin(v * Math.PI) * 3;
    lookAt.lerp(vaultLook, easeInOut(toVaultEased * 1.1 - 0.05));
    fov = mix(fov, vaultFov, v);
    camera.position.lerp(globeEye, g);
    lookAt.lerp(globeLook, g);
    fov = mix(fov, globeFov, g);
    const framing = k * (1 - v);
    const offsetX = (wide ? -width * 0.19 : 0) * framing, offsetY = (wide ? 0 : height * 0.06) * framing;
    // Dim the fog mid-flight so the transitions are no brighter than the chapters they join.
    backdrop.material.uniforms.uDim.value = 0.45 * Math.max(Math.sin(k * Math.PI), Math.sin(v * Math.PI), Math.sin(g * Math.PI));
    camera.lookAt(lookAt);
    camera.fov = fov;
    camera.setViewOffset(width, height, offsetX, offsetY, width, height);
    camera.updateProjectionMatrix();

    // Opening elements.
    monogram.visible = k < 0.92;
    monogram.position.y = 0.3 + Math.sin(elapsed * 0.6) * 0.05 + (1 - reveal) * -0.6;
    monogram.rotation.set(-smooth.y * 0.12, Math.sin(elapsed * 0.33) * 0.34 + smooth.x * 0.28 + (1 - reveal) * -0.9, 0);
    monogram.scale.setScalar(0.86 + 0.14 * reveal);
    glass.uniforms.uReveal.value = reveal;
    strands.forEach(({ tube, sleeve }, i) => {
      tube.geometry.setDrawRange(0, Math.floor((tubeCounts[i] * Math.min(1, reveal * 1.15 + k)) / 3) * 3);
      sleeve.material.uniforms.uTime.value = elapsed;
      sleeve.material.uniforms.uGrow.value = Math.min(1, reveal * 1.15 + k);
    });

    // Feature slabs fade in during the dive and stay.
    slabReveal = Math.max(slabReveal, clamp01((diveEased - 0.35) / 0.65));
    slabs.update(dt, elapsed, flightEased, hovered, slabReveal);
    vaultReveal = Math.max(vaultReveal, clamp01((toVaultEased - 0.3) / 0.7));
    vault.update(elapsed, stepEased, vaultReveal, vaultPointer);
    globeReveal = Math.max(globeReveal, clamp01((toGlobeEased - 0.35) / 0.65));
    globe.update(elapsed, globeReveal, pixelRatio);

    bokeh.material.uniforms.uTime.value = elapsed;
    bokeh.material.uniforms.uReveal.value = reveal;
    bokeh.material.uniforms.uFocus.value = g > 0 ? mix(13.5, 12.5, g) : v > 0 ? mix(distance, 13.5, v) : mix(8.6, distance, k);
    streaks.setTime(elapsed);
    backdrop.material.uniforms.uTime.value = elapsed;
    backdrop.material.uniforms.uScroll.value = k;
    backdrop.position.copy(camera.position);

    if (!opts.reducedMotion) {
      if (elapsed > nextAmbient) {
        nextAmbient = elapsed + 2 + Math.random() * 2;
        const a = Math.random() * Math.PI * 2;
        splats.push([0.5 + (Math.random() - 0.5) * 0.3, 0.5 + (Math.random() - 0.5) * 0.3, Math.cos(a) * 300, Math.sin(a) * 300, TEAL.clone().multiplyScalar(0.4)]);
      }
      for (const [x, y, dx, dy, color] of splats.splice(0)) fluid.splat(x, y, dx, dy, color, 0.0012);
    }
  };
  const draw = (dt: number) => {
    if (monogram.visible) {
      monogram.visible = false;
      renderer.setRenderTarget(behindGlass);
      renderer.clear();
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      monogram.visible = true;
    }
    post.render(dt, !opts.reducedMotion && dt > 0);
  };
  const tick = (now: number) => {
    frame = requestAnimationFrame(tick);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    draw(dt);
  };
  const visible = () => exit < 1 && !document.hidden;
  const setRunning = (next: boolean) => {
    if (opts.reducedMotion || next === running) return;
    running = next;
    if (running) { last = performance.now(); frame = requestAnimationFrame(tick); } else cancelAnimationFrame(frame);
  };
  const onVisibility = () => setRunning(visible());
  document.addEventListener("visibilitychange", onVisibility);
  const onScrollRun = () => setRunning(visible());
  window.addEventListener("scroll", onScrollRun, { passive: true });

  const renderStill = () => { update(0); draw(0); };
  if (opts.reducedMotion) renderStill(); else setRunning(true);

  return {
    start() {
      if (opts.reducedMotion) { renderStill(); return; }
      if (started < 0) started = elapsed;
    },
    setSection(name, section) {
      sections[name] = section;
      readScroll();
      onScrollRun();
    },
    setFeatureHandlers(next) { handlers = next; },
    setCards(cards) { slabs.setCards(cards); },
    dispose() {
      setRunning(false);
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("click", onClick);
      window.removeEventListener("scroll", readScroll);
      window.removeEventListener("resize", readScroll);
      window.removeEventListener("scroll", onScrollRun);
      document.removeEventListener("visibilitychange", onVisibility);
      resizeObserver.disconnect();
      behindGlass.dispose();
      slabs.dispose();
      vault.dispose();
      globe.dispose();
      post.dispose();
      environment.dispose();
      scene.traverse((object) => {
        const mesh = object as { geometry?: { dispose(): void }; material?: { dispose(): void } };
        mesh.geometry?.dispose();
        mesh.material?.dispose();
      });
      renderer.dispose();
    },
  };
}
