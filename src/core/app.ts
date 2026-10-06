// Application shell: renderer, UI root, boot splash, fixed-step loop, scenes and test hooks.
import { TUNING } from '../config/tuning';
import { flags, automated } from './flags';
import { RollingStat } from './stats';
import { installTestHooks, type TestStats } from './testHooks';
import { BootSplash } from '../ui/screens/splash';
import { h, setText } from '../ui/dom';
import { Renderer } from '../render/renderer';
import { input } from './input';
import { save } from './save';
import { native } from './native';
import type { GameScene } from '../scenes/gameScene';
import { StyleScene } from '../scenes/styleScene';
import { Battle } from '../modes/battle';
import { buildTraining } from '../world/maps/training';
import { RangeMode } from '../modes/range';
import { WEAPON_BY_ID } from '../config/content';

export type AppState = 'boot' | 'menu' | 'deploy' | 'playing' | 'paused' | 'dead' | 'end';

export class App {
  readonly canvas: HTMLCanvasElement;
  readonly ui: HTMLDivElement;
  readonly renderer: Renderer;
  state: AppState = 'boot';
  scene: GameScene | null = null;
  battle: Battle | null = null;
  private frameMs = new RollingStat(TUNING.test.statsWindow);
  private stepMs = new RollingStat(TUNING.test.statsWindow);
  private frames = 0;
  private matchTime = 0;
  private acc = 0;
  private last = performance.now();
  private overlay: HTMLDivElement;
  private debugEl: HTMLDivElement;
  private autoT = 0;

  constructor(root: HTMLElement) {
    this.canvas = h('canvas', { id: 'game' });
    root.appendChild(this.canvas);
    this.ui = h('div', { id: 'ui' });
    root.appendChild(this.ui);
    this.renderer = new Renderer(this.canvas);
    window.addEventListener('resize', () => this.scene?.resize(this.renderer.aspect));
    input.attach(this.canvas);
    this.overlay = h('div', { class: 'click-overlay hidden interactive' }, h('div', { class: 'panel brackets scan-in' }, h('div', { class: 'display', text: 'Click to deploy' }), h('div', { class: 'label', text: 'Mouse is captured while playing · Esc releases it' })));
    this.overlay.addEventListener('click', () => input.requestLock());
    this.ui.appendChild(this.overlay);
    this.debugEl = h('div', { class: 'debug-readout mono' });
    this.ui.appendChild(this.debugEl);
    input.onLockChange(() => this.updateOverlay());
    input.onKey((code, e) => {
      const fsCombo = e && e.metaKey && e.ctrlKey && code === 'KeyF';
      if (!native.isElectron && (code === 'F11' || fsCombo)) native.toggleFullscreen();
    });
    installTestHooks(this);
  }

  async boot(): Promise<void> {
    const splash = new BootSplash(this.ui);
    splash.progress(0.05, 'Loading profile');
    await save.load();
    input.bindings = save.settings.bindings;
    this.renderer.applyPreset(flags.preset ?? (automated ? 'low' : save.settings.preset));
    splash.progress(0.15, 'Initializing renderer');
    await new Promise((r) => setTimeout(r, TUNING.ui.bootSplashMin * 1000));
    if (flags.scene === 'style') {
      splash.progress(0.6, 'Building style test scene');
      await new Promise((r) => setTimeout(r, 0));
      this.scene = new StyleScene(this.renderer);
    } else {
      splash.progress(0.4, 'Building training ground');
      await new Promise((r) => setTimeout(r, 0));
      this.battle = await Battle.create(this.renderer, buildTraining(), this.ui);
      this.battle.setMode(new RangeMode());
      this.scene = this.battle;
    }
    splash.progress(1, 'Ready');
    await splash.hide();
    this.state = 'playing';
    input.gameplay = !flags.autoplay;
    this.updateOverlay();
    this.last = performance.now();
    requestAnimationFrame(this.tick);
  }

  private updateOverlay(): void {
    const show = this.state === 'playing' && !flags.autoplay && !input.locked && !!this.battle;
    this.overlay.classList.toggle('hidden', !show);
  }

  /** Scripted pilot for automated runs until bot AI drives the player (M5): walks to the firing line and shoots targets. */
  private autopilot(dt: number): void {
    const b = this.battle;
    if (!b) return;
    this.autoT += dt;
    const p = b.player;
    const i = p.input;
    const t = this.autoT;
    i.sprint = false;
    i.fire = false;
    i.aim = false;
    if (p.pos.z > -66) {
      i.moveZ = 1;
      i.moveX = 0;
      i.sprint = t > 3;
      b.controller.setAim(0, 0);
    } else {
      i.moveZ = 0;
      const targets = b.soldiers.filter((s) => s.dummy && s.alive && !s.downed && s.pos.distanceTo(p.pos) < 120);
      targets.sort((a, c) => a.pos.distanceTo(p.pos) - c.pos.distanceTo(p.pos));
      const tg = targets[Math.floor(t / 4) % Math.max(1, targets.length)];
      if (tg) {
        const dx = tg.pos.x - p.pos.x, dz = tg.pos.z - p.pos.z;
        const dy = tg.pos.y + 1.1 - (p.pos.y + p.eye);
        const yaw = Math.atan2(-dx, -dz);
        const pitch = Math.atan2(dy, Math.hypot(dx, dz));
        b.controller.setAim(b.controller.yaw + (yaw - b.controller.yaw) * Math.min(1, dt * 8), b.controller.pitch + (pitch - b.controller.pitch) * Math.min(1, dt * 8));
        i.aim = t % 6 > 1.5;
        const burst = (t * 1.6) % 1 < 0.55;
        i.fire = burst;
        if (burst && Math.floor(t * 1.6) !== Math.floor((t - dt) * 1.6)) i.firePressed = true;
      }
      if (Math.floor(t / 13) !== Math.floor((t - dt) / 13)) i.grenade = true;
      // Periodically swap a random attachment through the menu (exercises live model changes).
      b.forceAttachMenu = t % 9 > 7.2;
      if (Math.floor(t / 9) !== Math.floor((t - dt) / 9)) {
        const w = p.arsenal.current;
        const info = WEAPON_BY_ID[w.id];
        const pick = <T,>(arr: readonly T[]) => arr[Math.floor(Math.random() * arr.length)];
        b.setAttachments({ sight: pick(info.sights), barrel: pick(info.barrels), underbarrel: pick(info.underbarrels), ammo: pick(info.ammos) });
      }
      if (Math.floor(t / 17) !== Math.floor((t - dt) / 17)) i.slot = (p.arsenal.slot + 1) % 3;
    }
    i.yaw = b.controller.yaw;
    i.pitch = b.controller.pitch;
  }

  private tick = (now: number): void => {
    requestAnimationFrame(this.tick);
    const frameMs = now - this.last;
    const dt = Math.min(TUNING.loop.maxFrameSeconds, frameMs / 1000);
    this.frameMs.push(frameMs);
    if (save.settings.dynamicResolution) this.renderer.trackFrame(frameMs, now / 1000);
    this.last = now;
    this.frames++;
    if (this.scene?.frame) this.scene.frame(dt);
    if (flags.autoplay) this.autopilot(dt);
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
    if (this.scene) this.scene.render(this.acc / step, dt);
    else this.renderer.gl.clear();
    if (this.battle && save.settings.showFps) setText(this.debugEl, Object.values(this.battle.debug).join('\n') + `\n${this.frameMs.percentile(0.5).toFixed(1)} ms  ${this.renderer.drawCalls} calls`);
    else if (this.battle && !automated) setText(this.debugEl, Object.values(this.battle.debug).join('\n'));
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
      soldiers: this.battle?.soldiers.length ?? 0,
      aliveSoldiers: this.battle?.soldiers.filter((s) => s.alive).length ?? 0,
      kills: 0,
      tickets: [0, 0],
      vehiclesUsed: 0,
      gadgetsUsed: 0,
      stormEvents: 0,
      notes: this.battle ? [JSON.stringify(this.battle.debug)] : [],
    };
  }

  resetTestStats(): void {
    this.frameMs.reset();
    this.stepMs.reset();
    this.frames = 0;
    this.matchTime = 0;
  }
}
