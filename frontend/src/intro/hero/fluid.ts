import {
  HalfFloatType, LinearFilter, Mesh, OrthographicCamera, PlaneGeometry, RGBAFormat, Scene, ShaderMaterial,
  Vector2, Vector3, WebGLRenderTarget, type IUniform, type Texture, type WebGLRenderer,
} from "three";

/*
 * Small GPU fluid solver used to distort the hero: semi-Lagrangian advection, vorticity
 * confinement, Jacobi pressure solve and gradient subtraction, after Stam, "Stable Fluids"
 * (1999) and GPU Gems ch. 38. Velocity lives on a coarse grid; dye on a finer one.
 */

const vertex = /* glsl */ `
  uniform vec2 texelSize;
  varying vec2 vUv, vL, vR, vT, vB;
  void main() {
    vUv = uv;
    vL = uv - vec2(texelSize.x, 0.0);
    vR = uv + vec2(texelSize.x, 0.0);
    vT = uv + vec2(0.0, texelSize.y);
    vB = uv - vec2(0.0, texelSize.y);
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }`;

const header = /* glsl */ `precision highp float; varying vec2 vUv, vL, vR, vT, vB;`;

const shaders = {
  splat: `${header}
    uniform sampler2D uTarget; uniform float aspect, radius; uniform vec3 color; uniform vec2 point;
    void main() {
      vec2 p = vUv - point; p.x *= aspect;
      gl_FragColor = vec4(texture2D(uTarget, vUv).xyz + exp(-dot(p, p) / radius) * color, 1.0);
    }`,
  advect: `${header}
    uniform sampler2D uVelocity, uSource; uniform vec2 simTexel; uniform float dt, dissipation;
    void main() {
      vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * simTexel;
      gl_FragColor = vec4(texture2D(uSource, coord).xyz / (1.0 + dissipation * dt), 1.0);
    }`,
  curl: `${header}
    uniform sampler2D uVelocity;
    void main() {
      float l = texture2D(uVelocity, vL).y, r = texture2D(uVelocity, vR).y;
      float t = texture2D(uVelocity, vT).x, b = texture2D(uVelocity, vB).x;
      gl_FragColor = vec4(0.5 * (r - l - t + b), 0.0, 0.0, 1.0);
    }`,
  vorticity: `${header}
    uniform sampler2D uVelocity, uCurl; uniform float strength, dt;
    void main() {
      float l = texture2D(uCurl, vL).x, r = texture2D(uCurl, vR).x;
      float t = texture2D(uCurl, vT).x, b = texture2D(uCurl, vB).x, c = texture2D(uCurl, vUv).x;
      vec2 force = 0.5 * vec2(abs(t) - abs(b), abs(r) - abs(l));
      force = force / (length(force) + 1e-4) * strength * c;
      force.y *= -1.0;
      vec2 v = texture2D(uVelocity, vUv).xy + force * dt;
      gl_FragColor = vec4(clamp(v, -1000.0, 1000.0), 0.0, 1.0);
    }`,
  divergence: `${header}
    uniform sampler2D uVelocity;
    void main() {
      vec2 c = texture2D(uVelocity, vUv).xy;
      float l = vL.x < 0.0 ? -c.x : texture2D(uVelocity, vL).x;
      float r = vR.x > 1.0 ? -c.x : texture2D(uVelocity, vR).x;
      float t = vT.y > 1.0 ? -c.y : texture2D(uVelocity, vT).y;
      float b = vB.y < 0.0 ? -c.y : texture2D(uVelocity, vB).y;
      gl_FragColor = vec4(0.5 * (r - l + t - b), 0.0, 0.0, 1.0);
    }`,
  fade: `${header}
    uniform sampler2D uSource; uniform float value;
    void main() { gl_FragColor = vec4(texture2D(uSource, vUv).xyz * value, 1.0); }`,
  pressure: `${header}
    uniform sampler2D uPressure, uDivergence;
    void main() {
      float l = texture2D(uPressure, vL).x, r = texture2D(uPressure, vR).x;
      float t = texture2D(uPressure, vT).x, b = texture2D(uPressure, vB).x;
      gl_FragColor = vec4((l + r + t + b - texture2D(uDivergence, vUv).x) * 0.25, 0.0, 0.0, 1.0);
    }`,
  gradient: `${header}
    uniform sampler2D uPressure, uVelocity;
    void main() {
      float l = texture2D(uPressure, vL).x, r = texture2D(uPressure, vR).x;
      float t = texture2D(uPressure, vT).x, b = texture2D(uPressure, vB).x;
      gl_FragColor = vec4(texture2D(uVelocity, vUv).xy - vec2(r - l, t - b), 0.0, 1.0);
    }`,
};

type Pass = keyof typeof shaders;

function target(width: number, height: number) {
  return new WebGLRenderTarget(width, height, {
    type: HalfFloatType, format: RGBAFormat, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false,
  });
}

class PingPong {
  read: WebGLRenderTarget;
  write: WebGLRenderTarget;
  constructor(width: number, height: number) { this.read = target(width, height); this.write = target(width, height); }
  swap() { [this.read, this.write] = [this.write, this.read]; }
  dispose() { this.read.dispose(); this.write.dispose(); }
}

export type FluidOptions = { simSize: number; dyeSize: number; iterations: number; dyeDissipation?: number };

export class Fluid {
  private scene = new Scene();
  private camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: Mesh<PlaneGeometry, ShaderMaterial>;
  private materials: Record<Pass, ShaderMaterial>;
  private velocity!: PingPong;
  private dye!: PingPong;
  private pressure!: PingPong;
  private divergenceTarget!: WebGLRenderTarget;
  private curlTarget!: WebGLRenderTarget;
  private simTexel = new Vector2();
  private dyeTexel = new Vector2();
  private aspect = 1;

  constructor(private renderer: WebGLRenderer, private options: FluidOptions) {
    const uniforms = (): Record<string, IUniform> => ({ texelSize: { value: new Vector2() } });
    this.materials = Object.fromEntries(Object.entries(shaders).map(([name, fragmentShader]) => [
      name, new ShaderMaterial({ vertexShader: vertex, fragmentShader, uniforms: uniforms(), depthTest: false, depthWrite: false }),
    ])) as Record<Pass, ShaderMaterial>;
    this.quad = new Mesh(new PlaneGeometry(2, 2), this.materials.fade);
    this.scene.add(this.quad);
  }

  get velocityTexture(): Texture { return this.velocity.read.texture; }
  get dyeTexture(): Texture { return this.dye.read.texture; }

  /** (Re)allocates the grids for a canvas with this aspect ratio; old contents are dropped. */
  resize(aspect: number) {
    this.disposeTargets();
    this.aspect = aspect;
    const size = (base: number) => aspect >= 1 ? [Math.round(base * aspect), base] : [base, Math.round(base / aspect)];
    const [sw, sh] = size(this.options.simSize), [dw, dh] = size(this.options.dyeSize);
    this.velocity = new PingPong(sw, sh);
    this.pressure = new PingPong(sw, sh);
    this.dye = new PingPong(dw, dh);
    this.divergenceTarget = target(sw, sh);
    this.curlTarget = target(sw, sh);
    this.simTexel.set(1 / sw, 1 / sh);
    this.dyeTexel.set(1 / dw, 1 / dh);
  }

  private run(pass: Pass, output: WebGLRenderTarget, values: Record<string, unknown>, texel = this.simTexel) {
    const material = this.materials[pass];
    material.uniforms.texelSize.value = texel;
    for (const [key, value] of Object.entries(values)) {
      if (material.uniforms[key]) material.uniforms[key].value = value;
      else material.uniforms[key] = { value };
    }
    this.quad.material = material;
    this.renderer.setRenderTarget(output);
    this.renderer.render(this.scene, this.camera);
  }

  /** Adds force (in grid cells per second) and dye at a point given in 0..1 canvas coordinates. */
  splat(x: number, y: number, dx: number, dy: number, color: Vector3, radius = 0.0025) {
    const point = new Vector2(x, y);
    this.run("splat", this.velocity.write, { uTarget: this.velocity.read.texture, aspect: this.aspect, point, color: new Vector3(dx, dy, 0), radius });
    this.velocity.swap();
    this.run("splat", this.dye.write, { uTarget: this.dye.read.texture, aspect: this.aspect, point, color, radius: radius * 1.6 }, this.dyeTexel);
    this.dye.swap();
  }

  step(dt: number) {
    const v = this.velocity;
    this.run("curl", this.curlTarget, { uVelocity: v.read.texture });
    this.run("vorticity", v.write, { uVelocity: v.read.texture, uCurl: this.curlTarget.texture, strength: 18, dt });
    v.swap();
    this.run("divergence", this.divergenceTarget, { uVelocity: v.read.texture });
    this.run("fade", this.pressure.write, { uSource: this.pressure.read.texture, value: 0.8 });
    this.pressure.swap();
    for (let i = 0; i < this.options.iterations; i++) {
      this.run("pressure", this.pressure.write, { uPressure: this.pressure.read.texture, uDivergence: this.divergenceTarget.texture });
      this.pressure.swap();
    }
    this.run("gradient", v.write, { uPressure: this.pressure.read.texture, uVelocity: v.read.texture });
    v.swap();
    this.run("advect", v.write, { uVelocity: v.read.texture, uSource: v.read.texture, simTexel: this.simTexel, dt, dissipation: 0.9 });
    v.swap();
    this.run("advect", this.dye.write, { uVelocity: v.read.texture, uSource: this.dye.read.texture, simTexel: this.simTexel, dt, dissipation: this.options.dyeDissipation ?? 1.6 }, this.dyeTexel);
    this.dye.swap();
    this.renderer.setRenderTarget(null);
  }

  private disposeTargets() {
    this.velocity?.dispose(); this.pressure?.dispose(); this.dye?.dispose();
    this.divergenceTarget?.dispose(); this.curlTarget?.dispose();
  }

  dispose() {
    this.disposeTargets();
    Object.values(this.materials).forEach((material) => material.dispose());
    this.quad.geometry.dispose();
  }
}
