import { CanvasTexture, Mesh, ShaderMaterial, Vector3, type Raycaster, type Scene, type WebGLRenderer } from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { CARD_H, CARD_W, drawCard, loadScreen, type CardContent } from "../wall/cards";

// Slabs sit on a descending helix around the strands' axis, facing outwards.
export const SLAB_RADIUS = 4.2;
export const SLAB_STEP_ANGLE = (50 * Math.PI) / 180;
export const SLAB_STEP_DROP = 2.3;
const SLAB_W = 3.2;
const SLAB_H = SLAB_W * (CARD_H / CARD_W);

const slabVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vObjectNormal;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;
  void main() {
    vUv = uv;
    vObjectNormal = normal;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPos = world.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;

// A thick glass slab. The front face holds the app screen under the glass: frosted and dim
// when out of focus, sharp in focus, with blocky glitches while it changes state. Rounded
// edges and sides are glass, lit by the same analytic strip-light studio as the monogram.
const slabFragment = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uColor;
  uniform float uFocus, uHover, uGlitch, uTime, uReveal;
  varying vec2 vUv;
  varying vec3 vObjectNormal;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;

  float band(float x, float c, float w) { return smoothstep(w, 0.0, abs(x - c)); }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
  vec3 studio(vec3 r) {
    float top = band(r.y, 0.84, 0.08) * smoothstep(0.95, 0.15, abs(r.x));
    float top2 = band(r.y, 0.58, 0.025) * smoothstep(1.0, 0.25, abs(r.x));
    float left = band(r.x, -0.86, 0.05) * smoothstep(0.85, 0.1, abs(r.y));
    float right = band(r.x, 0.9, 0.03) * smoothstep(0.7, 0.0, abs(r.y - 0.1));
    vec3 c = vec3(top * 3.0 + top2 * 2.0 + left * 1.6 + right * 1.4);
    c += vec3(0.1, 0.65, 0.55) * pow(max(dot(r, normalize(vec3(-0.6, 0.6, -0.5))), 0.0), 6.0) * 0.7;
    return c;
  }

  void main() {
    vec3 n = normalize(vWorldNormal);
    vec3 v = normalize(cameraPosition - vWorldPos);
    float fresnel = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 3.0);
    vec3 reflection = studio(reflect(-v, n));
    float focus = max(uFocus, uHover * 0.6);
    float front = smoothstep(0.85, 0.98, vObjectNormal.z);

    // Screen under the glass: blocky horizontal tears while the focus changes.
    vec2 uv = vUv;
    vec2 cell = floor(vec2(uv.x * 6.0, uv.y * 28.0) + vec2(0.0, floor(uTime * 14.0)));
    float tear = step(1.0 - uGlitch * 0.35, hash(cell));
    uv.x += (hash(cell + 7.0) - 0.5) * 0.12 * tear;
    float frost = mix(4.5, 0.0, focus);
    vec3 screen = vec3(
      texture2D(uMap, uv + vec2(0.004 * uGlitch, 0.0), frost).r,
      texture2D(uMap, uv, frost).g,
      texture2D(uMap, uv - vec2(0.004 * uGlitch, 0.0), frost).b
    );
    screen = mix(screen * vec3(0.55, 0.68, 0.66), screen * 0.92, focus) * (0.28 + 0.72 * focus);
    vec3 face = screen + reflection * (0.03 + (0.35 + 0.4 * focus) * fresnel) + uColor * fresnel * 0.2;

    // Edges and sides: dark glass with bright strip highlights and a touch of the accent.
    vec3 edge = vec3(0.012, 0.03, 0.03) + reflection * 0.9 + uColor * (0.12 + 0.5 * focus) * (0.4 + fresnel);
    // The back is dark glass with only faint reflections, so slabs seen from behind stay quiet.
    float back = smoothstep(0.85, 0.98, -vObjectNormal.z);
    edge = mix(edge, vec3(0.008, 0.02, 0.02) + reflection * (0.08 + 0.4 * fresnel), back);
    vec3 color = mix(edge, face, front);
    gl_FragColor = vec4(color * uReveal, 1.0);
  }`;

/**
 * The seven feature slabs: thick glass with the app screen under it, on a helix whose axis
 * passes through `axis` (x, z) and whose first slab sits at height `top`.
 */
export function createSlabs(renderer: WebGLRenderer, scene: Scene, count: number, axis: Vector3, top: number) {
  const point = (t: number) => new Vector3(
    axis.x + Math.sin(t * SLAB_STEP_ANGLE) * SLAB_RADIUS, top - t * SLAB_STEP_DROP, axis.z + Math.cos(t * SLAB_STEP_ANGLE) * SLAB_RADIUS);
  const geometry = new RoundedBoxGeometry(SLAB_W, SLAB_H, 0.12, 5, 0.06);
  const slabs = Array.from({ length: count }, (_, i) => {
    const art = document.createElement("canvas");
    const texture = new CanvasTexture(art);
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const material = new ShaderMaterial({
      vertexShader: slabVertex, fragmentShader: slabFragment,
      uniforms: {
        uMap: { value: texture }, uColor: { value: new Vector3() }, uFocus: { value: 0 }, uHover: { value: 0 },
        uGlitch: { value: 0 }, uTime: { value: 0 }, uReveal: { value: 0 },
      },
    });
    const mesh = new Mesh(geometry, material);
    const home = point(i);
    mesh.position.copy(home);
    mesh.rotation.y = i * SLAB_STEP_ANGLE;
    mesh.userData.index = i;
    scene.add(mesh);
    return { mesh, material, texture, art, home, hover: 0, focus: 0, glitch: 0 };
  });
  let cardsVersion = 0;

  return {
    meshes: slabs.map((slab) => slab.mesh),
    /** Where the camera looks for slab `t` (fractional between slabs). */
    point,
    /** progress: slab index in focus (fractional); reveal: 0..1 fade-in of the whole helix. */
    update(dt: number, elapsed: number, progress: number, hovered: number | null, reveal: number) {
      for (const slab of slabs) {
        const i = slab.mesh.userData.index as number;
        const closeness = Math.max(0, 1 - Math.abs(progress - i) * 1.4);
        const before = slab.focus;
        slab.focus += (closeness - slab.focus) * (1 - Math.exp(-dt * 8));
        // Glitch while the focus is changing quickly, then settle.
        slab.glitch = Math.min(1, slab.glitch * Math.exp(-dt * 5) + Math.abs(slab.focus - before) * 6);
        slab.hover += ((hovered === i ? 1 : 0) - slab.hover) * (1 - Math.exp(-dt * 10));
        const u = slab.material.uniforms;
        u.uFocus.value = slab.focus;
        u.uHover.value = slab.hover;
        u.uGlitch.value = slab.glitch;
        u.uTime.value = elapsed;
        u.uReveal.value = Math.min(1, Math.max(0, reveal * 1.6 - i * 0.08));
        const lift = 0.3 * slab.hover;
        slab.mesh.position.set(
          axis.x + (slab.home.x - axis.x) * (1 + lift / SLAB_RADIUS), slab.home.y + Math.sin(elapsed * 0.6 + i) * 0.04,
          axis.z + (slab.home.z - axis.z) * (1 + lift / SLAB_RADIUS));
        slab.mesh.rotation.x = Math.sin(elapsed * 0.4 + i * 1.7) * 0.025;
      }
    },
    pick(raycaster: Raycaster): number | null {
      const hit = raycaster.intersectObjects(slabs.map((slab) => slab.mesh), false)[0];
      return hit ? (hit.object.userData.index as number) : null;
    },
    setCards(cards: CardContent[]) {
      const version = ++cardsVersion;
      cards.forEach((card, i) => {
        const slab = slabs[i];
        if (!slab) return;
        slab.material.uniforms.uColor.value.set(...hexToRgb(card.color));
        // Draw the title straight away, then again once the screen image has loaded.
        drawCard(slab.art, card, null);
        slab.texture.needsUpdate = true;
        loadScreen(card.id, card.lang).then((image) => {
          if (version !== cardsVersion || !image) return;
          drawCard(slab.art, card, image);
          slab.texture.needsUpdate = true;
        });
      });
    },
    dispose() {
      slabs.forEach((slab) => { slab.material.dispose(); slab.texture.dispose(); });
      geometry.dispose();
    },
  };
}

// Shader colours are written straight out, so hex values stay in sRGB (no colour management).
function hexToRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
}
