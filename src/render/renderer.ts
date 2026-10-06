// Renderer wrapper: WebGL setup from Elemental Brawl (sRGB output, no tone mapping, PCF shadows),
// the post pipeline, resolution scale and dynamic resolution scaling.
import * as THREE from 'three';
import { PostFX } from './post';
import { PRESETS, type PresetId, type QualityProfile } from './quality';
import { TUNING } from '../config/tuning';

export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  post: PostFX | null = null;
  quality: QualityProfile = PRESETS.high;
  preset: PresetId = 'high';
  /** User resolution scale (settings), 0.5..1. */
  resolutionScale = 1;
  /** Automatic scale applied on top when frames run long. */
  dynamicScale = 1;
  dynamicEnabled = true;
  private frameAvg = 1000 / 60;
  private lastChange = 0;
  private w = 1;
  private h = 1;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', stencil: false });
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.toneMapping = THREE.NoToneMapping;
    this.gl.shadowMap.type = THREE.PCFShadowMap;
    this.gl.info.autoReset = false;
    window.addEventListener('resize', () => this.resize());
  }

  applyPreset(id: PresetId): void {
    this.preset = id;
    this.quality = PRESETS[id];
    const q = this.quality;
    this.gl.shadowMap.enabled = q.shadows;
    this.post?.dispose();
    this.post = new PostFX(this.gl, this.gl.capabilities.isWebGL2 ? q.msaa : 0, q.bloomStrength, q.bloom);
    this.resize();
  }

  /** Applies a preset with the user's per-setting overrides (Settings screen). */
  applySettings(st: { preset: PresetId; shadows: boolean; bloom: boolean; outlines: boolean; dynamicResolution: boolean; resolutionScale: number; particles: number }): void {
    const base = PRESETS[st.preset];
    const q: QualityProfile = {
      ...base,
      shadows: base.shadows && st.shadows,
      bloom: st.bloom,
      outlines: st.outlines,
      particleScale: base.particleScale * st.particles,
      maxParticles: Math.round(base.maxParticles * Math.max(0.25, st.particles)),
    };
    const shadowChanged = q.shadows !== this.gl.shadowMap.enabled;
    this.preset = st.preset;
    this.quality = q;
    this.resolutionScale = st.resolutionScale;
    this.dynamicEnabled = st.dynamicResolution;
    if (!st.dynamicResolution) this.dynamicScale = 1;
    this.gl.shadowMap.enabled = q.shadows;
    this.post?.dispose();
    this.post = new PostFX(this.gl, this.gl.capabilities.isWebGL2 ? q.msaa : 0, q.bloomStrength, q.bloom);
    this.shadowChanged = shadowChanged;
    this.resize();
  }

  /** Set when shadows were toggled (scenes must recompile their materials). */
  shadowChanged = false;

  get pixelRatio(): number {
    return Math.min(window.devicePixelRatio || 1, this.quality.pixelRatioCap) * this.resolutionScale * this.dynamicScale;
  }

  resize(): void {
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.gl.setPixelRatio(this.pixelRatio);
    this.gl.setSize(this.w, this.h, false);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    this.post?.setSize(this.w, this.h, this.pixelRatio);
  }

  get aspect(): number {
    return this.w / Math.max(1, this.h);
  }

  /** Feeds a frame time; steps the dynamic scale down when frames run long, back up when they recover. */
  trackFrame(ms: number, nowSec: number): void {
    const D = TUNING.render.dynamicResolution;
    this.frameAvg += (ms - this.frameAvg) * D.smoothing;
    if (!this.dynamicEnabled || nowSec - this.lastChange < D.cooldown) return;
    let next = this.dynamicScale;
    if (this.frameAvg > D.targetMs * D.downThreshold) next = Math.max(D.minScale, this.dynamicScale - D.step);
    else if (this.frameAvg < D.targetMs * D.upThreshold) next = Math.min(1, this.dynamicScale + D.step);
    if (next !== this.dynamicScale) {
      this.dynamicScale = next;
      this.lastChange = nowSec;
      this.resize();
    }
  }

  render(scene: THREE.Scene, camera: THREE.Camera, viewScene: THREE.Scene | null = null, viewCamera: THREE.Camera | null = null): void {
    this.gl.info.reset();
    if (this.post) this.post.render(scene, camera, viewScene, viewCamera);
    else {
      this.gl.render(scene, camera);
      if (viewScene && viewCamera) {
        this.gl.autoClear = false;
        this.gl.clearDepth();
        this.gl.render(viewScene, viewCamera);
        this.gl.autoClear = true;
      }
    }
  }

  get drawCalls(): number {
    return this.gl.info.render.calls;
  }
}
