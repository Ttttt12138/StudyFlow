import {
  AdditiveBlending, DoubleSide, Float32BufferAttribute, InstancedBufferAttribute, InstancedBufferGeometry, Mesh,
  ShaderMaterial, Vector2, type Vector3,
} from "three";

const ROWS = 10;

/**
 * Light streaks thrown off by the pointer. Each streak is an instanced ribbon whose rows sample
 * the particle's path at successive moments, so it bends into an arc as it swirls; all motion
 * after spawning (drag, swirl, fade) is evaluated in the vertex shader, and the CPU only fills
 * a ring buffer of spawn records.
 */
export function createStreaks(capacity: number) {
  const geometry = new InstancedBufferGeometry();
  // x: -0.5..0.5 across the ribbon, y: 0 at the tail, 1 at the head.
  const vertices: number[] = [], index: number[] = [];
  for (let r = 0; r < ROWS; r++) {
    const y = r / (ROWS - 1);
    vertices.push(-0.5, y, 0, 0.5, y, 0);
    if (r) { const a = (r - 1) * 2; index.push(a, a + 1, a + 3, a, a + 3, a + 2); }
  }
  geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
  geometry.setIndex(index);
  const start = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  const velocity = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  const meta = new InstancedBufferAttribute(new Float32Array(capacity * 4).fill(-100), 4); // birth, life, spin, warm
  geometry.setAttribute("aStart", start);
  geometry.setAttribute("aVelocity", velocity);
  geometry.setAttribute("aMeta", meta);
  geometry.instanceCount = capacity;

  const material = new ShaderMaterial({
    // The ribbon is expanded in screen space, so its winding depends on the stroke direction.
    transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending, side: DoubleSide,
    uniforms: { uTime: { value: 0 }, uResolution: { value: new Vector2(1, 1) }, uWidth: { value: 2.4 }, uTrail: { value: 0.32 } },
    vertexShader: /* glsl */ `
      attribute vec3 aStart;
      attribute vec3 aVelocity;
      attribute vec4 aMeta;
      uniform float uTime, uWidth, uTrail;
      uniform vec2 uResolution;
      varying float vAlpha;
      varying float vAcross;
      varying vec3 vColor;

      vec3 positionAt(float age) {
        float drag = 1.4;
        float travel = (1.0 - exp(-drag * age)) / drag;
        float spin = aMeta.z * 3.2 * age;
        vec2 dir = mat2(cos(spin), -sin(spin), sin(spin), cos(spin)) * aVelocity.xy;
        return aStart + vec3(dir, aVelocity.z) * travel;
      }
      vec2 toScreen(vec3 p, out vec4 clip) {
        clip = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        return clip.xy / clip.w * uResolution * 0.5;
      }

      void main() {
        float age = uTime - aMeta.x;
        float life = age / aMeta.y;
        if (life < 0.0 || life > 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
        float t = max(age - (1.0 - position.y) * uTrail, 0.0);
        vec4 clip, ahead;
        vec2 here = toScreen(positionAt(t), clip);
        vec2 next = toScreen(positionAt(t + 0.012), ahead);
        vec2 dir = next - here;
        dir = length(dir) < 0.01 ? vec2(1.0, 0.0) : normalize(dir);
        // Taper towards the tail and as the streak dies.
        float width = uWidth * (0.25 + 0.75 * position.y) * (1.0 - life * 0.5);
        vec2 screen = here + vec2(-dir.y, dir.x) * position.x * width;
        gl_Position = vec4(screen / (uResolution * 0.5) * clip.w, clip.z, clip.w);
        vAlpha = pow(1.0 - life, 1.4) * smoothstep(0.0, 0.06, life) * position.y * position.y;
        vAcross = position.x;
        vColor = mix(vec3(0.7, 1.0, 0.94), vec3(1.0, 0.82, 0.45), aMeta.w) * 3.4;
      }`,
    fragmentShader: /* glsl */ `
      varying float vAlpha;
      varying float vAcross;
      varying vec3 vColor;
      void main() {
        float a = vAlpha * (1.0 - smoothstep(0.15, 0.5, abs(vAcross)));
        gl_FragColor = vec4(vColor * a, a);
      }`,
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;

  let cursor = 0;
  return {
    mesh,
    /** Spawns one streak at a world position with a world-space velocity; spin bends it (-1..1). */
    spawn(at: Vector3, vel: Vector3, spin: number, time: number) {
      const i = cursor;
      cursor = (cursor + 1) % capacity;
      start.setXYZ(i, at.x, at.y, at.z);
      velocity.setXYZ(i, vel.x, vel.y, vel.z);
      meta.setXYZW(i, time, 0.9 + Math.random() * 0.8, spin, Math.random() < 0.12 ? 1 : 0);
      start.needsUpdate = velocity.needsUpdate = meta.needsUpdate = true;
    },
    setTime(time: number) { material.uniforms.uTime.value = time; },
    setResolution(width: number, height: number) { material.uniforms.uResolution.value.set(width, height); },
  };
}
