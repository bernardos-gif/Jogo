// Application shell: renderer, UI root, boot splash, fixed-step loop, scenes and test hooks.
import { TUNING } from '../config/tuning';
import { flags } from './flags';
import { RollingStat } from './stats';
import { installTestHooks, type TestStats } from './testHooks';
import { BootSplash } from '../ui/screens/splash';
import { h } from '../ui/dom';
import { Renderer } from '../render/renderer';
import type { GameScene } from '../scenes/gameScene';
import { StyleScene } from '../scenes/styleScene';

export type AppState = 'boot' | 'menu' | 'deploy' | 'playing' | 'paused' | 'dead' | 'end';

export class App {
  readonly canvas: HTMLCanvasElement;
  readonly ui: HTMLDivElement;
  readonly renderer: Renderer;
  state: AppState = 'boot';
  scene: GameScene | null = null;
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
    this.renderer = new Renderer(this.canvas);
    this.renderer.applyPreset(flags.preset ?? (flags.smoke || flags.soak ? 'low' : 'high'));
    window.addEventListener('resize', () => this.scene?.resize(this.renderer.aspect));
    installTestHooks(this);
  }

  async boot(): Promise<void> {
    const splash = new BootSplash(this.ui);
    splash.progress(0.1, 'Initializing renderer');
    await new Promise((r) => setTimeout(r, TUNING.ui.bootSplashMin * 1000));
    if (flags.scene === 'style') {
      splash.progress(0.6, 'Building style test scene');
      await new Promise((r) => setTimeout(r, 0));
      this.scene = new StyleScene(this.renderer);
    }
    splash.progress(1, 'Ready');
    await splash.hide();
    this.state = flags.autoplay || this.scene ? 'playing' : 'menu';
    this.last = performance.now();
    requestAnimationFrame(this.tick);
  }

  private tick = (now: number): void => {
    requestAnimationFrame(this.tick);
    const frameMs = now - this.last;
    const dt = Math.min(TUNING.loop.maxFrameSeconds, frameMs / 1000);
    this.frameMs.push(frameMs);
    this.renderer.trackFrame(frameMs, now / 1000);
    this.last = now;
    this.frames++;
    const step = 1 / TUNING.loop.hz;
    this.acc += dt;
    let steps = 0;
    while (this.acc >= step && steps < TUNING.loop.maxStepsPerFrame) {
      const t0 = performance.now();
      if (this.state === 'playing') this.matchTime += step;
      this.scene?.update(step);
      this.stepMs.push(performance.now() - t0);
      this.acc -= step;
      steps++;
    }
    if (steps >= TUNING.loop.maxStepsPerFrame) this.acc = 0;
    if (this.scene) this.scene.render(this.acc / step);
    else this.renderer.gl.clear();
  };

  testStats(): TestStats {
    return {
      state: this.state,
      matchTime: this.matchTime,
      frames: this.frames,
      frameMsMedian: this.frameMs.percentile(0.5),
      frameMsP95: this.frameMs.percentile(0.95),
      simStepMsMedian: this.stepMs.percentile(0.5),
      drawCalls: this.renderer.drawCalls,
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
