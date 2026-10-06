// Post pipeline (STYLE_GUIDE.md section 5): half-float MSAA scene target, a viewmodel pass with
// cleared depth, UnrealBloom (threshold 1.0 so only glow materials bloom), one composite pass for
// vignette / full-screen flash / damage edge / chromatic glitch / downed desaturation, then output.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

const CompositeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    resolution: { value: new THREE.Vector2(1, 1) },
    vignette: { value: 0.35 },
    flash: { value: 0 },
    flashColor: { value: new THREE.Color(1, 1, 1) },
    damage: { value: 0 },
    damageColor: { value: new THREE.Color(0.55, 0.02, 0.06) },
    chroma: { value: 0 },
    desat: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 resolution;
    uniform float vignette;
    uniform float flash;
    uniform vec3 flashColor;
    uniform float damage;
    uniform vec3 damageColor;
    uniform float chroma;
    uniform float desat;
    varying vec2 vUv;
    void main() {
      vec2 c = vUv - 0.5;
      vec3 col;
      if (chroma > 0.001) {
        vec2 off = c * chroma / resolution * 2.0;
        col.r = texture2D(tDiffuse, vUv + off).r;
        col.g = texture2D(tDiffuse, vUv).g;
        col.b = texture2D(tDiffuse, vUv - off).b;
      } else {
        col = texture2D(tDiffuse, vUv).rgb;
      }
      float r = length(c * vec2(resolution.x / resolution.y, 1.0));
      col *= 1.0 - smoothstep(0.45, 1.15, r) * vignette;
      float edge = smoothstep(0.32, 0.95, r);
      col = mix(col, damageColor, clamp(edge * damage, 0.0, 0.85));
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, vec3(l) * vec3(0.95, 0.9, 0.92), desat);
      col += flashColor * flash;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export interface ScreenEffects {
  vignette: number;
  flash: number;
  flashColor: THREE.Color;
  damage: number;
  chroma: number;
  desat: number;
}

export class PostFX {
  readonly composer: EffectComposer;
  private worldPass: RenderPass;
  private viewPass: RenderPass;
  readonly bloom: UnrealBloomPass;
  private composite: ShaderPass;
  readonly fx: ScreenEffects = { vignette: 0.35, flash: 0, flashColor: new THREE.Color(1, 1, 1), damage: 0, chroma: 0, desat: 0 };

  constructor(
    private renderer: THREE.WebGLRenderer,
    samples: number,
    bloomStrength: number,
    bloomOn: boolean,
  ) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), { type: THREE.HalfFloatType, samples });
    this.composer = new EffectComposer(renderer, target);
    this.worldPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
    this.viewPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
    this.viewPass.clear = false;
    this.viewPass.clearDepth = true;
    this.viewPass.enabled = false;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), bloomStrength, 0.42, 1.0);
    this.bloom.enabled = bloomOn;
    this.composite = new ShaderPass(CompositeShader);
    this.composer.addPass(this.worldPass);
    this.composer.addPass(this.viewPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.composite);
    this.composer.addPass(new OutputPass());
  }

  setSize(w: number, h: number, pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
    (this.composite.uniforms.resolution.value as THREE.Vector2).set(w * pixelRatio, h * pixelRatio);
  }

  render(scene: THREE.Scene, camera: THREE.Camera, viewScene: THREE.Scene | null, viewCamera: THREE.Camera | null): void {
    this.worldPass.scene = scene;
    this.worldPass.camera = camera;
    this.viewPass.enabled = !!(viewScene && viewCamera);
    if (viewScene && viewCamera) {
      this.viewPass.scene = viewScene;
      this.viewPass.camera = viewCamera;
    }
    const u = this.composite.uniforms;
    u.vignette.value = this.fx.vignette;
    u.flash.value = this.fx.flash;
    (u.flashColor.value as THREE.Color).copy(this.fx.flashColor);
    u.damage.value = this.fx.damage;
    u.chroma.value = this.fx.chroma;
    u.desat.value = this.fx.desat;
    this.composer.render();
  }

  dispose(): void {
    this.composer.renderTarget1.dispose();
    this.composer.renderTarget2.dispose();
    this.bloom.dispose();
    void this.renderer;
  }
}
