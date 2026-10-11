import {
  AdditiveBlending, BufferAttribute, BufferGeometry, CatmullRomCurve3, Color, Group, LineBasicMaterial, LineSegments,
  Mesh, Points, ShaderMaterial, TubeGeometry, Vector3,
} from "three";

const RADIUS = 3.2;

function onSphere(lat: number, lon: number, radius = RADIUS) {
  const a = (lat * Math.PI) / 180, b = (lon * Math.PI) / 180;
  return new Vector3(radius * Math.cos(a) * Math.sin(b), radius * Math.sin(a), radius * Math.cos(a) * Math.cos(b));
}

/**
 * The closing chapter: a wireframe globe with two arcs of light carrying pulses from China to
 * Thailand — teal and gold, the two currencies of the strands — and glowing city points.
 */
export function createGlobe() {
  const group = new Group();

  // Meridians and parallels as one set of line segments.
  const lines: number[] = [];
  const push = (a: Vector3, b: Vector3) => lines.push(a.x, a.y, a.z, b.x, b.y, b.z);
  for (let m = 0; m < 18; m++) {
    for (let s = 0; s < 48; s++) push(onSphere(-90 + (s * 180) / 48, m * 20), onSphere(-90 + ((s + 1) * 180) / 48, m * 20));
  }
  for (let p = -60; p <= 60; p += 20) {
    for (let s = 0; s < 72; s++) push(onSphere(p, (s * 360) / 72), onSphere(p, ((s + 1) * 360) / 72));
  }
  const gridGeometry = new BufferGeometry();
  gridGeometry.setAttribute("position", new BufferAttribute(new Float32Array(lines), 3));
  const gridMaterial = new LineBasicMaterial({ color: new Color(0.25, 0.75, 0.68), transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending });
  group.add(new LineSegments(gridGeometry, gridMaterial));

  // Arcs lifted off the surface, with pulses running from origin to destination.
  const routes: [number, number, number, number, string][] = [
    [31.2, 121.5, 13.75, 100.5, "#5cf6d3"], // Shanghai → Bangkok
    [30.6, 104.1, 13.75, 100.5, "#ffc76a"], // Chengdu → Bangkok
  ];
  const arcMaterials = routes.map(([la, loa, lb, lob, color], index) => {
    const a = onSphere(la, loa), b = onSphere(lb, lob);
    const points = Array.from({ length: 48 }, (_, i) => {
      const t = i / 47;
      return a.clone().lerp(b, t).normalize().multiplyScalar(RADIUS * (1 + Math.sin(Math.PI * t) * 0.22));
    });
    const material = new ShaderMaterial({
      transparent: true, depthWrite: false, blending: AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uReveal: { value: 0 }, uColor: { value: new Color(color).multiplyScalar(4) }, uPhase: { value: index * 0.45 } },
      vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: /* glsl */ `
        uniform float uTime, uReveal, uPhase;
        uniform vec3 uColor;
        varying vec2 vUv;
        void main() {
          if (vUv.x > uReveal) discard;
          float f = fract(vUv.x * 3.0 - uTime * 0.35 + uPhase);
          float pulse = smoothstep(0.0, 0.02, f) * smoothstep(0.16, 0.02, f);
          float a = 0.12 + pulse * 1.4;
          gl_FragColor = vec4(uColor * a, a);
        }`,
    });
    group.add(new Mesh(new TubeGeometry(new CatmullRomCurve3(points), 96, 0.014, 6, false), material));
    return material;
  });

  const cities = [onSphere(31.2, 121.5, RADIUS * 1.01), onSphere(30.6, 104.1, RADIUS * 1.01), onSphere(13.75, 100.5, RADIUS * 1.01)];
  const cityGeometry = new BufferGeometry();
  cityGeometry.setAttribute("position", new BufferAttribute(new Float32Array(cities.flatMap((c) => [c.x, c.y, c.z])), 3));
  const cityMaterial = new ShaderMaterial({
    transparent: true, depthWrite: false, blending: AdditiveBlending,
    uniforms: { uReveal: { value: 0 }, uPixelRatio: { value: 1 } },
    vertexShader: /* glsl */ `
      uniform float uPixelRatio;
      void main() {
        vec4 view = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * view;
        gl_PointSize = 90.0 * uPixelRatio / -view.z;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uReveal;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = (smoothstep(1.0, 0.0, d) * 0.5 + smoothstep(0.3, 0.0, d)) * uReveal;
        gl_FragColor = vec4(vec3(0.85, 1.0, 0.95) * a * 2.0, a);
      }`,
  });
  group.add(new Points(cityGeometry, cityMaterial));

  // Turn the globe so Asia faces the camera, tipped forward to show the northern hemisphere.
  const baseYaw = (-112 * Math.PI) / 180;
  return {
    group,
    update(elapsed: number, reveal: number, pixelRatio: number) {
      group.rotation.set(0.42, baseYaw + Math.sin(elapsed * 0.12) * 0.25, 0);
      gridMaterial.opacity = 0.075 * reveal;
      arcMaterials.forEach((m) => { m.uniforms.uTime.value = elapsed; m.uniforms.uReveal.value = Math.min(1, reveal * 1.3); });
      cityMaterial.uniforms.uReveal.value = reveal;
      cityMaterial.uniforms.uPixelRatio.value = pixelRatio;
    },
    dispose() {
      group.traverse((object) => {
        const mesh = object as { geometry?: { dispose(): void }; material?: { dispose(): void } };
        mesh.geometry?.dispose();
        mesh.material?.dispose();
      });
    },
  };
}
