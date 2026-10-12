import {
  BackSide, BoxGeometry, Color, DoubleSide, Mesh, MeshBasicMaterial, PMREMGenerator, PlaneGeometry, Scene, ShaderMaterial,
  SphereGeometry, type Texture, type WebGLRenderer,
} from "three";

/**
 * Procedural studio environment for reflections: a dark room with long strip lights overhead
 * and at the sides, a teal fill from the upper left and a warm kicker from below. Chrome and
 * glass pick up crisp highlight lines from the strips. Nothing is downloaded.
 */
export function createEnvironment(renderer: WebGLRenderer): Texture {
  const room = new Scene();
  room.background = new Color(0x020506);
  const strip = (w: number, h: number, color: string, intensity: number, x: number, y: number, z: number, rx = 0, ry = 0) => {
    const mesh = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ color: new Color(color).multiplyScalar(intensity), side: DoubleSide }));
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, 0);
    room.add(mesh);
  };
  strip(14, 0.35, "#ffffff", 9, 0, 6, -1, Math.PI / 2);
  strip(14, 0.2, "#ffffff", 6, 0, 6, 2.2, Math.PI / 2);
  strip(0.3, 9, "#dffcff", 5, -7, 1, 0, 0, Math.PI / 2);
  strip(0.25, 9, "#ffffff", 4, 7, 0.5, -2, 0, -Math.PI / 2);
  strip(6, 6, "#1fbf9a", 0.6, -5, 4, -6, 0, Math.PI / 5);
  strip(5, 2, "#f2b45a", 1.6, 4, -5, 3, -Math.PI / 2.6);
  strip(10, 4, "#0c3d44", 1.2, 0, 0, -9);
  // Key strips in front of the subject so the glass edges catch bright lines towards the camera.
  strip(9, 0.28, "#ffffff", 7, 0, 3.5, 8, -Math.PI / 3);
  strip(0.22, 7, "#e8fffa", 5, -4, 0, 7, 0, Math.PI / 4);
  const walls = new Mesh(new BoxGeometry(20, 16, 20), new MeshBasicMaterial({ color: 0x030809, side: BackSide }));
  room.add(walls);
  const pmrem = new PMREMGenerator(renderer);
  const texture = pmrem.fromScene(room, 0.035).texture;
  pmrem.dispose();
  room.traverse((object) => {
    if (object instanceof Mesh) { object.geometry.dispose(); (object.material as MeshBasicMaterial).dispose(); }
  });
  return texture;
}

/**
 * Opaque fog backdrop: a deep teal glow behind the upper left fading to near black, with a
 * faint warm haze low on the right. Being opaque, it is what the glass refracts.
 */
export function createBackdrop(): Mesh<SphereGeometry, ShaderMaterial> {
  const material = new ShaderMaterial({
    side: BackSide, depthWrite: false,
    uniforms: { uTime: { value: 0 }, uScroll: { value: 0 }, uDim: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uScroll, uDim;
      varying vec3 vDir;
      float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
      void main() {
        vec3 d = normalize(vDir);
        vec3 base = vec3(0.0015, 0.0045, 0.0055);
        float teal = pow(max(dot(d, normalize(vec3(-0.55, 0.62, -0.56))), 0.0), 4.0);
        float top = pow(max(dot(d, normalize(vec3(0.6, 0.75, -0.3))), 0.0), 6.0);
        float warm = pow(max(dot(d, normalize(vec3(0.5, -0.55, -0.65))), 0.0), 5.0);
        vec3 color = base + vec3(0.008, 0.06, 0.058) * teal + vec3(0.008, 0.02, 0.026) * top + vec3(0.03, 0.02, 0.006) * warm * (0.6 + uScroll);
        // Slow-moving haze bands keep the fog from looking like a flat gradient.
        float band = sin(d.y * 9.0 + d.x * 4.0 + uTime * 0.12) * 0.5 + 0.5;
        color *= 0.86 + 0.14 * band;
        color *= 1.0 - uDim;
        color += (hash(d * 400.0 + uTime) - 0.5) * 0.004;
        gl_FragColor = vec4(color, 1.0);
      }`,
  });
  const mesh = new Mesh(new SphereGeometry(40, 48, 32), material);
  mesh.renderOrder = -10;
  return mesh;
}
