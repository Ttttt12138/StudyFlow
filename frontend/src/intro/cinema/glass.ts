import { ShaderMaterial, Vector2, type Texture } from "three";

/**
 * Clear glass for the monogram. Instead of three's physical transmission (which kept tinting
 * the faces), the scene without the monogram is rendered to a texture first; flat faces show
 * it almost unchanged, while bevels refract it along their normals with a per-channel offset
 * (dispersion). Reflections come from an analytic studio — a few strip lights evaluated on
 * the reflection vector — so edges catch crisp silver lines.
 */
export function createGlassMaterial() {
  return new ShaderMaterial({
    uniforms: {
      uScene: { value: null as Texture | null },
      uResolution: { value: new Vector2(1, 1) },
      uRefract: { value: 0.07 },
      uDispersion: { value: 0.12 },
      uReveal: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldNormal;
      varying vec3 vViewNormal;
      varying vec3 vWorldPos;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorldPos = world.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        vViewNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uScene;
      uniform vec2 uResolution;
      uniform float uRefract, uDispersion, uReveal;
      varying vec3 vWorldNormal;
      varying vec3 vViewNormal;
      varying vec3 vWorldPos;

      float band(float x, float c, float w) { return smoothstep(w, 0.0, abs(x - c)); }

      vec3 studio(vec3 r) {
        float top = band(r.y, 0.84, 0.08) * smoothstep(0.95, 0.15, abs(r.x));
        float top2 = band(r.y, 0.58, 0.025) * smoothstep(1.0, 0.25, abs(r.x));
        float left = band(r.x, -0.86, 0.05) * smoothstep(0.85, 0.1, abs(r.y));
        float right = band(r.x, 0.9, 0.03) * smoothstep(0.7, 0.0, abs(r.y - 0.1));
        float rim = band(r.z, 0.86, 0.05) * smoothstep(0.6, 0.0, abs(r.y - 0.35));
        vec3 c = vec3(top * 3.0 + top2 * 2.0 + left * 1.6 + right * 1.4 + rim * 1.2);
        c += vec3(0.1, 0.65, 0.55) * pow(max(dot(r, normalize(vec3(-0.6, 0.6, -0.5))), 0.0), 6.0) * 0.7;
        c += vec3(1.0, 0.65, 0.25) * pow(max(dot(r, normalize(vec3(0.5, -0.7, 0.3))), 0.0), 8.0) * 0.6;
        return c;
      }

      void main() {
        vec3 n = normalize(vWorldNormal);
        vec3 v = normalize(cameraPosition - vWorldPos);
        if (!gl_FrontFacing) n = -n;
        float facing = clamp(dot(n, v), 0.0, 1.0);
        float fresnel = pow(1.0 - facing, 3.0);

        vec2 uv = gl_FragCoord.xy / uResolution;
        vec2 offset = -normalize(vViewNormal).xy * uRefract * (0.35 + 1.6 * fresnel);
        vec3 refracted = vec3(
          texture2D(uScene, uv + offset * (1.0 + uDispersion)).r,
          texture2D(uScene, uv + offset).g,
          texture2D(uScene, uv + offset * (1.0 - uDispersion)).b
        );
        // Nearly clear body: a hint of cool tint and a little absorption towards the edges.
        vec3 body = refracted * mix(vec3(0.86, 0.92, 0.91), vec3(0.62, 0.78, 0.76), fresnel);
        vec3 reflection = studio(reflect(-v, n)) * (0.03 + 0.97 * fresnel);
        vec3 color = body + reflection + vec3(0.55, 0.75, 0.72) * fresnel * 0.35;
        gl_FragColor = vec4(mix(refracted, color, uReveal), 1.0);
      }`,
  });
}
