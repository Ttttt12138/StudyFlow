import {
  BloomEffect, ChromaticAberrationEffect, Effect, EffectComposer, EffectPass, NoiseEffect, RenderPass,
  ToneMappingEffect, ToneMappingMode, VignetteEffect, BlendFunction,
} from "postprocessing";
import { HalfFloatType, Uniform, Vector2, type Camera, type Scene, type Texture, type WebGLRenderer } from "three";
import { Fluid } from "../hero/fluid";

/** Screen-space pass that refracts the frame along the pointer fluid and adds its faint dye. */
class FluidEffect extends Effect {
  constructor(strength: number) {
    super("FluidEffect", /* glsl */ `
      uniform sampler2D uVelocity;
      uniform sampler2D uDye;
      uniform float uStrength;
      void mainUv(inout vec2 uv) { uv -= texture2D(uVelocity, uv).xy * uStrength; }
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        outputColor = vec4(inputColor.rgb + texture2D(uDye, uv).rgb * 0.12, inputColor.a);
      }`, {
      uniforms: new Map<string, Uniform>([["uVelocity", new Uniform(null)], ["uDye", new Uniform(null)], ["uStrength", new Uniform(strength)]]),
    });
  }
  bind(velocity: Texture, dye: Texture) {
    this.uniforms.get("uVelocity")!.value = velocity;
    this.uniforms.get("uDye")!.value = dye;
  }
}

/**
 * The shared cinematic finish for every chapter: pointer-fluid refraction, bloom, chromatic
 * aberration, AgX tone mapping, vignette and film grain. Chromatic aberration is a convolution
 * effect, which cannot share a pass with the fluid's UV distortion, hence two passes.
 */
export function createPost(renderer: WebGLRenderer, scene: Scene, camera: Camera, narrow: boolean) {
  const fluid = new Fluid(renderer, { simSize: narrow ? 96 : 128, dyeSize: narrow ? 256 : 512, iterations: narrow ? 10 : 16, dyeDissipation: 4.5 });
  const fluidEffect = new FluidEffect(0.00005);
  const composer = new EffectComposer(renderer, { frameBufferType: HalfFloatType, multisampling: narrow ? 2 : 4 });
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new EffectPass(camera, fluidEffect, new BloomEffect({ mipmapBlur: true, luminanceThreshold: 0.75, luminanceSmoothing: 0.25, intensity: 1.35, radius: 0.72 })));
  const noise = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: false });
  noise.blendMode.opacity.value = 0.22;
  composer.addPass(new EffectPass(camera,
    new ChromaticAberrationEffect({ offset: new Vector2(0.0009, 0.0006), radialModulation: true, modulationOffset: 0.35 }),
    new ToneMappingEffect({ mode: ToneMappingMode.AGX }),
    new VignetteEffect({ offset: 0.18, darkness: 0.78 }),
    noise,
  ));
  return {
    fluid,
    composer,
    /** Advances the fluid and renders the frame. */
    render(dt: number, stepFluid: boolean) {
      if (stepFluid) fluid.step(dt);
      fluidEffect.bind(fluid.velocityTexture, fluid.dyeTexture);
      composer.render(dt);
    },
    setSize(width: number, height: number) { composer.setSize(width, height, false); fluid.resize(width / height); },
    dispose() { fluid.dispose(); composer.dispose(); },
  };
}
