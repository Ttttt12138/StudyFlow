import {
  AdditiveBlending, BufferAttribute, BufferGeometry, CatmullRomCurve3, Color, ExtrudeGeometry, Mesh,
  MeshPhysicalMaterial, Points, ShaderMaterial, ShapePath, TubeGeometry, Vector3,
} from "three";
import { createGlassMaterial } from "./glass";
import monogram from "./monogram.json";

/** The glass "S": the glyph outline extruded with a soft bevel, in clear dispersive glass. */
export function createMonogram(height: number) {
  const path = new ShapePath();
  for (const [type, ...p] of monogram.commands as [string, ...number[]][]) {
    if (type === "M") path.moveTo(p[0], p[1]);
    else if (type === "L") path.lineTo(p[0], p[1]);
    else if (type === "Q") path.quadraticCurveTo(p[0], p[1], p[2], p[3]);
    else if (type === "C") path.bezierCurveTo(p[0], p[1], p[2], p[3], p[4], p[5]);
  }
  const geometry = new ExtrudeGeometry(path.toShapes(true), {
    depth: 0.16, bevelEnabled: true, bevelThickness: 0.045, bevelSize: 0.012, bevelSegments: 8, curveSegments: 36,
  });
  geometry.center();
  geometry.computeVertexNormals();
  geometry.scale(height, height, height);
  return new Mesh(geometry, createGlassMaterial());
}

/**
 * Two chrome strands twisting around each other down the scene — the two currencies of a
 * transfer — plus an additive sleeve per strand carrying pulses of light along it.
 */
export function createRibbons(segments: number, shape: { top?: number; length?: number; radius?: number; flare?: number; z?: number } = {}) {
  const { top = 5.5, length = 22, radius: r0 = 0.55, flare = 1.6, z = -0.9 } = shape;
  const strands = [0, Math.PI].map((phase, index) => {
    const points: Vector3[] = [];
    for (let i = 0; i <= 160; i++) {
      const t = i / 160;
      const y = top - t * length;
      const radius = r0 + t * flare + Math.max(0, (y - 1.2) * 0.25);
      const angle = phase + y * 0.42;
      points.push(new Vector3(Math.sin(angle) * radius, y, Math.cos(angle) * radius + z));
    }
    const curve = new CatmullRomCurve3(points);
    const tube = new Mesh(
      new TubeGeometry(curve, segments, 0.034, 12, false),
      new MeshPhysicalMaterial({ color: 0xd9e4e2, metalness: 1, roughness: 0.14, clearcoat: 0.6, envMapIntensity: 1.5 }),
    );
    const sleeve = new Mesh(
      new TubeGeometry(curve, segments, 0.05, 8, false),
      new ShaderMaterial({
        transparent: true, depthWrite: false, blending: AdditiveBlending,
        uniforms: { uTime: { value: 0 }, uGrow: { value: 0 }, uColor: { value: new Color(index ? "#ffc76a" : "#5cf6d3").multiplyScalar(4) }, uPhase: { value: index * 0.37 } },
        vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
        fragmentShader: /* glsl */ `
          uniform float uTime, uGrow, uPhase;
          uniform vec3 uColor;
          varying vec2 vUv;
          void main() {
            if (vUv.x > uGrow) discard;
            float f = fract(vUv.x * 9.0 - uTime * 0.16 + uPhase);
            float pulse = smoothstep(0.0, 0.015, f) * smoothstep(0.11, 0.015, f);
            float head = smoothstep(uGrow - 0.03, uGrow, vUv.x) * step(uGrow, 0.999);
            float a = (pulse * 0.9 + head * 1.6) * (1.0 - smoothstep(0.55, 1.0, vUv.x));
            gl_FragColor = vec4(uColor * a, a);
          }`,
      }),
    );
    return { tube, sleeve };
  });
  return strands;
}

/**
 * Out-of-focus dust: each point's size follows its distance from the focal plane (circle of
 * confusion) and its brightness falls with area, so near and far motes read as soft bokeh discs.
 */
export function createBokeh(count: number, top = 6, span = 26) {
  const positions = new Float32Array(count * 3), seeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    // Clustered around the central column, like dust caught in a beam.
    const spread = (Math.random() + Math.random() + Math.random() - 1.5) * 5.5;
    positions.set([spread, top - Math.random() * span, -6 + Math.random() * 11], i * 3);
    seeds[i] = Math.random();
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("aSeed", new BufferAttribute(seeds, 1));
  const material = new ShaderMaterial({
    transparent: true, depthWrite: false, blending: AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uFocus: { value: 9 }, uPixelRatio: { value: 1 }, uReveal: { value: 0 }, uTop: { value: top }, uSpan: { value: span } },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      uniform float uTime, uFocus, uPixelRatio, uReveal, uTop, uSpan;
      varying float vAlpha;
      varying vec3 vColor;
      void main() {
        vec3 p = position;
        p.y = mod(position.y - (uTop - uSpan) + uTime * (0.04 + aSeed * 0.06), uSpan) + uTop - uSpan;
        p.x += sin(uTime * 0.2 + aSeed * 30.0) * 0.25;
        p.z += cos(uTime * 0.17 + aSeed * 20.0) * 0.25;
        vec4 view = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * view;
        float coc = abs(-view.z - uFocus);
        float size = (1.4 + aSeed * 2.2 + coc * coc * 0.8) * uPixelRatio * (11.0 / -view.z);
        gl_PointSize = clamp(size, 1.0, 46.0 * uPixelRatio);
        vAlpha = uReveal * clamp(3.4 / (1.0 + coc * coc * 1.1), 0.035, 1.0) * (0.3 + 0.7 * aSeed);
        vColor = mix(vec3(0.95, 0.8, 0.28), vec3(0.45, 1.0, 0.85), step(0.86, aSeed));
      }`,
    fragmentShader: /* glsl */ `
      varying float vAlpha;
      varying vec3 vColor;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float disc = 1.0 - smoothstep(0.82, 1.0, d);
        float rim = smoothstep(0.55, 0.95, d) * disc;
        float a = disc * (0.5 + 0.5 * rim) * vAlpha;
        gl_FragColor = vec4(vColor * a, a);
      }`,
  });
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  return points;
}
