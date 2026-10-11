import { CylinderGeometry, InstancedBufferAttribute, InstancedMesh, Matrix4, ShaderMaterial, Vector2, Vector3 } from "three";

/**
 * The safety chapter's wall: a lattice of hexagonal glass cells. Each of the three safety
 * points lights it differently — a gold radial pulse (simulated end to end), a violet scan
 * line (the assistant proposes, you decide), four amber rings (checks scale with risk) — and
 * the pointer presses a ripple into it. All animation runs in the vertex shader.
 */
export function createVault(narrow: boolean) {
  const cols = narrow ? 13 : 26, rows = narrow ? 20 : 12;
  const radius = 0.3;
  const dx = Math.sqrt(3) * radius, dy = 1.5 * radius;
  const geometry = new CylinderGeometry(radius * 0.92, radius * 0.92, 0.24, 6);
  geometry.rotateX(Math.PI / 2);
  const material = new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uStep: { value: 0 }, uReveal: { value: 0 },
      uPointer: { value: new Vector2(9, 9) }, uPointerOn: { value: 0 },
    },
    vertexShader: /* glsl */ `
      attribute vec2 aCell;
      attribute float aSeed;
      uniform float uTime, uStep, uReveal, uPointerOn;
      uniform vec2 uPointer;
      varying vec3 vWorldNormal;
      varying vec3 vWorldPos;
      varying vec3 vGlow;
      varying float vFront;
      void main() {
        float d = length(aCell * vec2(1.0, 0.6));
        float w0 = clamp(1.0 - abs(uStep), 0.0, 1.0);
        float w1 = clamp(1.0 - abs(uStep - 1.0), 0.0, 1.0);
        float w2 = clamp(1.0 - abs(uStep - 2.0), 0.0, 1.0);
        // 0: rings travelling out from the centre.
        float p0 = pow(0.5 + 0.5 * sin(d * 9.0 - uTime * 2.4), 10.0) * 1.05;
        // 1: a scan line sweeping across; cells it has passed keep a faint charge.
        float scan = fract(uTime * 0.16) * 2.8 - 1.4;
        float p1 = smoothstep(0.16, 0.0, abs(aCell.x - scan)) * 1.4 + step(aCell.x, scan) * smoothstep(0.9, 0.0, scan - aCell.x) * 0.035;
        // 2: four bands, brightest in the middle, like the four permission tiers.
        float tier = floor(clamp(d, 0.0, 0.999) * 4.0);
        // The pulse steps inwards one band at a time, each inner band brighter: stricter checks.
        float p2 = (0.02 + 0.1 * (3.0 - tier)) * (0.15 + 1.6 * pow(0.5 + 0.5 * sin(uTime * 2.2 + tier * 1.5), 6.0));
        float ripple = exp(-dot(aCell - uPointer, aCell - uPointer) * 22.0) * uPointerOn;
        float glow = p0 * w0 + p1 * w1 + p2 * w2 + ripple * 0.9;
        vec3 tint = vec3(1.0, 0.78, 0.36) * w0 + vec3(0.72, 0.56, 1.0) * w1 + vec3(1.0, 0.6, 0.38) * w2;

        float rise = clamp(uReveal * 1.7 - aSeed * 0.7, 0.0, 1.0);
        vec3 p = position;
        p.z += glow * 0.18 + ripple * 0.3 - (1.0 - rise) * 5.0;
        vec4 world = modelMatrix * instanceMatrix * vec4(p, 1.0);
        vWorldPos = world.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
        vFront = step(0.6, normal.z);
        vGlow = tint * glow * rise;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vWorldNormal;
      varying vec3 vWorldPos;
      varying vec3 vGlow;
      varying float vFront;
      float band(float x, float c, float w) { return smoothstep(w, 0.0, abs(x - c)); }
      vec3 studio(vec3 r) {
        float top = band(r.y, 0.84, 0.1) * smoothstep(0.95, 0.15, abs(r.x));
        float left = band(r.x, -0.86, 0.06) * smoothstep(0.85, 0.1, abs(r.y));
        float right = band(r.x, 0.9, 0.04) * smoothstep(0.7, 0.0, abs(r.y - 0.1));
        return vec3(top * 2.4 + left * 1.4 + right * 1.2) + vec3(0.1, 0.65, 0.55) * pow(max(dot(r, normalize(vec3(-0.6, 0.6, -0.5))), 0.0), 6.0) * 0.5;
      }
      void main() {
        vec3 n = normalize(vWorldNormal);
        vec3 v = normalize(cameraPosition - vWorldPos);
        float fresnel = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 3.0);
        vec3 glass = vec3(0.006, 0.014, 0.015) + studio(reflect(-v, n)) * (0.03 + 0.7 * fresnel);
        vec3 color = glass + vGlow * mix(0.25, 1.8, vFront);
        gl_FragColor = vec4(color, 1.0);
      }`,
  });

  const count = cols * rows;
  const mesh = new InstancedMesh(geometry, material, count);
  const cells = new Float32Array(count * 2), seeds = new Float32Array(count);
  const matrix = new Matrix4();
  const width = (cols - 0.5) * dx, height = (rows - 1) * dy;
  let i = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++, i++) {
      const x = c * dx + (r % 2 ? dx / 2 : 0) - width / 2, y = r * dy - height / 2;
      matrix.makeTranslation(x, y, 0);
      mesh.setMatrixAt(i, matrix);
      cells.set([x / (width / 2), y / (height / 2)], i * 2);
      seeds[i] = Math.random();
    }
  }
  geometry.setAttribute("aCell", new InstancedBufferAttribute(cells, 2));
  geometry.setAttribute("aSeed", new InstancedBufferAttribute(seeds, 1));
  mesh.frustumCulled = false;

  const local = new Vector3();
  return {
    mesh,
    size: { width, height },
    /** step: 0..2 across the three safety points; pointer: a world point on the wall, or null. */
    update(elapsed: number, step: number, reveal: number, pointer: Vector3 | null) {
      const u = material.uniforms;
      u.uTime.value = elapsed;
      u.uStep.value = step;
      u.uReveal.value = reveal;
      if (pointer) {
        local.copy(pointer);
        mesh.worldToLocal(local);
        u.uPointer.value.set(local.x / (width / 2), local.y / (height / 2));
      }
      u.uPointerOn.value += ((pointer ? 1 : 0) - u.uPointerOn.value) * 0.1;
    },
    dispose() { geometry.dispose(); material.dispose(); },
  };
}
