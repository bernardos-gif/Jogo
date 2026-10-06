// Application shell (M0): renderer, UI root, boot splash, fixed-step loop and test hooks.
import * as THREE from 'three';
import { TUNING } from '../config/tuning';
import { flags } from './flags';
import { RollingStat } from './stats';
import { installTestHooks, type TestStats } from './testHooks';
import { BootSplash } from '../ui/screens/splash';
import { h } from '../ui/dom';

export type AppState = 'boot' | 'menu' | 'deploy' | 'playing' | 'paused' | 'dead' | 'end';

export class App {
  readonly canvas: HTMLCanvasElement;
  readonly ui: HTMLDivElement;
  readonly renderer: THREE.WebGLRenderer;
  state: AppState = 'boot';
  private frameMs = new RollingStat(TUNING.test.statsWindow);
  private stepMs = new RollingStat(TUNING.test.statsWindow);
  private frames = 0;
  private matchTime = 0;
  private acc = 0;
  private last = performance.now();

  constructor(root: HTMLElement) {
    this.canvas = h('canvas', { id: 'game' });
    root.appendChild(this.canvas);
    this.ui = h('div', { id: 'ui' });
    root.appendChild(this.ui);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x05080d);
    window.addEventListener('resize', () => this.resize());
    this.resize();
    installTestHooks(this);
  }

  async boot(): Promise<void> {
    const splash = new BootSplash(this.ui);
    splash.progress(0.1, 'Initializing renderer');
    await new Promise((r) => setTimeout(r, TUNING.ui.bootSplashMin * 1000));
    splash.progress(1, 'Ready');
    await splash.hide();
    this.state = flags.autoplay ? 'playing' : 'menu';
    requestAnimationFrame(this.tick);
  }

  private tick = (now: number): void => {
    requestAnimationFrame(this.tick);
    const dt = Math.min(TUNING.loop.maxFrameSeconds, (now - this.last) / 1000);
    this.frameMs.push(now - this.last);
    this.last = now;
    this.frames++;
    const step = 1 / TUNING.loop.hz;
    this.acc += dt;
    let steps = 0;
    while (this.acc >= step && steps < TUNING.loop.maxStepsPerFrame) {
      const t0 = performance.now();
      if (this.state === 'playing') this.matchTime += step;
      this.stepMs.push(performance.now() - t0);
      this.acc -= step;
      steps++;
    }
    if (steps >= TUNING.loop.maxStepsPerFrame) this.acc = 0;
    this.renderer.render(new THREE.Scene(), new THREE.PerspectiveCamera());
  };

  private resize(): void {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
  }

  testStats(): TestStats {
    return {
      state: this.state,
      matchTime: this.matchTime,
      frames: this.frames,
      frameMsMedian: this.frameMs.percentile(0.5),
      frameMsP95: this.frameMs.percentile(0.95),
      simStepMsMedian: this.stepMs.percentile(0.5),
      drawCalls: this.renderer.info.render.calls,
      soldiers: 0,
      aliveSoldiers: 0,
      kills: 0,
      tickets: [0, 0],
      vehiclesUsed: 0,
      gadgetsUsed: 0,
      stormEvents: 0,
      notes: [],
    };
  }

  resetTestStats(): void {
    this.frameMs.reset();
    this.stepMs.reset();
    this.frames = 0;
    this.matchTime = 0;
  }
}
