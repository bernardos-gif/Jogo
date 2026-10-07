// Application shell: renderer, UI root, boot splash, fixed-step loop, scenes, menus (main menu over
// the live flyover, loadout, settings, controls, pause), live settings and test hooks.
import { TUNING } from '../config/tuning';
import { flags, automated } from './flags';
import { RollingStat } from './stats';
import { installTestHooks, type TestStats } from './testHooks';
import { BootSplash } from '../ui/screens/splash';
import { h, setText, toggle } from '../ui/dom';
import { Renderer } from '../render/renderer';
import { input } from './input';
import { save, type Settings } from './save';
import { native } from './native';
import type { GameScene } from '../scenes/gameScene';
import { StyleScene } from '../scenes/styleScene';
import { Battle } from '../modes/battle';
import { buildTraining } from '../world/maps/training';
import { RangeMode } from '../modes/range';
import { SectorMode } from '../modes/sector/sectorMode';
import { SkirmishMode } from '../modes/skirmish';
import { MatchFlow } from './flow';
import { damageSoldier } from '../weapons/damage';
import { buildBreakwater } from '../world/maps/breakwater';
import { WEAPON_BY_ID } from '../config/content';
import type { AttachmentSet } from '../art/weaponModels';
import { MainMenu, type MatchSetup } from '../ui/screens/mainMenu';
import { SettingsScreen } from '../ui/screens/settings';
import { ControlsScreen } from '../ui/screens/controls';
import { LoadoutScreen } from '../ui/screens/loadout';
import { PauseMenu } from '../ui/screens/pause';
import { Flyover } from '../scenes/flyover';
import { audio } from '../audio/engine';
import * as sounds from '../audio/sounds';

export type AppState = 'boot' | 'menu' | 'playing';

const GRAPHICS_KEYS: (keyof Settings)[] = ['preset', 'shadows', 'bloom', 'outlines', 'dynamicResolution', 'resolutionScale', 'particles'];

interface Menus {
  main: MainMenu;
  settings: SettingsScreen;
  controls: ControlsScreen;
  loadout: LoadoutScreen;
  pause: PauseMenu;
}

export class App {
  readonly canvas: HTMLCanvasElement;
  readonly ui: HTMLDivElement;
  readonly renderer: Renderer;
  state: AppState = 'boot';
  scene: GameScene | null = null;
  battle: Battle | null = null;
  flow: MatchFlow | null = null;
  paused = false;
  private menus: Menus | null = null;
  private flyover: Flyover | null = null;
  /** Where Back from a sub-screen returns to. */
  private backTo: (() => void) | null = null;
  /** Set when the game releases the mouse itself (so the lock loss is not a pause request). */
  private expectUnlock = false;
  private flowVisited = new Set<string>();
  private frameMs = new RollingStat(TUNING.test.statsWindow);
  private stepMs = new RollingStat(TUNING.test.statsWindow);
  private frames = 0;
  private matchTime = 0;
  private acc = 0;
  private last = performance.now();
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
    this.debugEl = h('div', { class: 'debug-readout mono hidden' });
    this.ui.appendChild(this.debugEl);
    input.onLockChange((locked) => {
      if (!locked && !this.expectUnlock && this.inLiveMatch()) this.pause();
      this.expectUnlock = false;
    });
    input.onKey((code, e) => {
      const fsCombo = e && e.metaKey && e.ctrlKey && code === 'KeyF';
      if (!native.isElectron && (code === 'F11' || fsCombo)) native.toggleFullscreen();
      if (code === 'Escape') this.onEscape();
    });
    installTestHooks(this);
  }

  /** In a match with the player on the field (not on a flow screen), not paused, not automated. */
  private inLiveMatch(): boolean {
    return this.state === 'playing' && !this.paused && !flags.autoplay && !!this.flow && (this.flow.state === 'playing' || this.flow.state === 'downed');
  }

  private onEscape(): void {
    const m = this.menus;
    if (!m || m.settings.open || m.controls.open || m.loadout.open) return;
    if (this.paused) this.resume();
    else if (this.inLiveMatch()) this.pause();
  }

  async boot(): Promise<void> {
    const splash = new BootSplash(this.ui);
    splash.progress(0.05, 'Loading profile');
    await save.load();
    input.bindings = save.settings.bindings;
    // Audio: silent in automated runs unless forced on; resumes on the first input in browsers.
    audio.enabled = flags.audio === 'on' || (!automated && flags.audio !== 'off');
    audio.init();
    audio.setVolumes(save.settings);
    const unlock = () => audio.resume();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    this.hookUiSounds();
    this.applyGraphics();
    this.applyInterface();
    splash.progress(0.15, 'Initializing renderer');
    await new Promise((r) => setTimeout(r, TUNING.ui.bootSplashMin * 1000));
    if (flags.scene === 'style') {
      splash.progress(0.6, 'Building style test scene');
      await new Promise((r) => setTimeout(r, 0));
      this.scene = new StyleScene(this.renderer);
    } else if (flags.scene === 'range') {
      splash.progress(0.4, 'Building training ground');
      await new Promise((r) => setTimeout(r, 0));
      this.battle = await Battle.create(this.renderer, buildTraining(), this.ui);
      this.battle.setMode(new RangeMode());
      this.scene = this.battle;
    } else {
      const t0 = performance.now();
      const map = buildBreakwater((f, l) => splash.progress(0.2 + f * 0.6, l));
      this.battle = await Battle.create(this.renderer, map, this.ui, (f, l) => splash.progress(f, l));
      const mode = new SectorMode({ managedPlayer: true });
      this.battle.setMode(mode);
      this.battle.applyQuality();
      splash.progress(0.95, 'Charting the tactical map');
      await new Promise((r) => setTimeout(r, 0));
      this.flow = new MatchFlow(this.battle, mode, this.ui, this.battle.captureTactical());
      this.flow.onGameplay = (on) => {
        input.gameplay = on && !flags.autoplay;
        if (on && !flags.autoplay) input.requestLock();
        else if (!on) {
          this.expectUnlock = input.locked;
          input.exitLock();
        }
      };
      this.battle.debug.load = `load ${((performance.now() - t0) / 1000).toFixed(1)} s`;
      this.scene = this.battle;
      const zones = map.zones ?? [];
      this.flyover = new Flyover(
        [...zones.map((z) => z.center), ...(map.hqs ?? []).map((q) => q.center)].sort((a, b) => Math.atan2(a.z, a.x) - Math.atan2(b.z, b.x)),
        (x, z) => map.terrain.heightAt(x, z),
      );
      this.buildMenus();
    }
    splash.progress(1, 'Ready');
    await splash.hide();
    this.last = performance.now();
    requestAnimationFrame(this.tick);
    if (!this.flow) {
      this.state = 'playing';
      input.gameplay = !flags.autoplay;
    } else if (flags.autoplay) this.startMatch({ mode: flags.mode ?? 'sector', teamSize: flags.bots ?? save.settings.teamSize, difficulty: save.settings.difficulty });
    else this.toMenu();
  }

  // ---- Menus -----------------------------------------------------------------------------------
  private buildMenus(): void {
    const ui = this.ui;
    const m: Menus = { main: new MainMenu(ui), settings: new SettingsScreen(ui), controls: new ControlsScreen(ui), loadout: new LoadoutScreen(ui), pause: new PauseMenu(ui) };
    this.menus = m;
    m.main.onStart = (s) => this.startMatch(s);
    m.main.onLoadout = () => this.openSub(m.loadout, () => this.toMenu());
    m.main.onSettings = () => this.openSub(m.settings, () => this.toMenu());
    m.main.onControls = () => this.openSub(m.controls, () => this.toMenu());
    m.pause.onResume = () => this.resume();
    m.pause.onSettings = () => this.openSub(m.settings, () => this.showPause());
    m.pause.onControls = () => this.openSub(m.controls, () => this.showPause());
    m.pause.onLeave = () => {
      this.paused = false;
      m.pause.hide();
      this.toMenu();
    };
    for (const s of [m.settings, m.controls, m.loadout]) s.onBack = () => this.closeSub();
    m.settings.onChange = (k) => this.onSettingChange(k);
  }

  private openSub(screen: { show(): void }, back: () => void): void {
    const m = this.menus!;
    m.main.hide();
    m.pause.hide();
    this.backTo = back;
    screen.show();
  }

  private closeSub(): void {
    const m = this.menus!;
    m.settings.hide();
    m.controls.hide();
    m.loadout.hide();
    const b = this.backTo;
    this.backTo = null;
    b?.();
  }

  private toMenu(): void {
    const b = this.battle;
    if (!b || !this.flow || !this.menus) return;
    this.state = 'menu';
    this.paused = false;
    b.matchLive = false;
    audio.duck(false);
    this.flow.stop();
    this.flow.onGameplay?.(false);
    input.gameplay = false;
    b.hud?.scoreboard.show(false);
    b.hud?.fullMap?.show(false);
    const fly = this.flyover;
    b.cameraOverride = fly ? (cam, dt) => fly.update(cam, dt) : null;
    this.menus.main.show();
  }

  private startMatch(setup: MatchSetup): void {
    const b = this.battle;
    if (!b || !this.flow) return;
    this.menus?.main.hide();
    b.ai.setDifficulty(setup.difficulty);
    const cur = b.mode instanceof SectorMode ? b.mode : null;
    const skirmish = setup.mode === 'skirmish';
    if (!cur || cur.id !== setup.mode || (!skirmish && cur.teamSize !== setup.teamSize)) {
      const mode = skirmish ? new SkirmishMode({ managedPlayer: true }) : new SectorMode({ teamSize: setup.teamSize, managedPlayer: true });
      b.setMode(mode);
      this.flow.setMode(mode);
    } else cur.restart();
    this.state = 'playing';
    b.matchLive = true;
    this.flow.start();
  }

  /** Hover and click blips for every button-like control in the interface. */
  private hookUiSounds(): void {
    const sel = 'button, .btn, .chip-btn, .w-seg button, .ms-item, .card, [data-sound]';
    let last: Element | null = null;
    this.ui.addEventListener('pointerover', (e) => {
      const el = (e.target as Element | null)?.closest?.(sel) ?? null;
      if (el && el !== last) sounds.ui('hover');
      last = el;
    });
    this.ui.addEventListener('click', (e) => {
      const el = (e.target as Element | null)?.closest?.(sel);
      if (!el) return;
      const back = /back|leave|close|cancel/i.test(el.textContent ?? '') || el.classList.contains('back');
      sounds.ui(back ? 'back' : 'click');
    });
  }

  private pause(): void {
    if (!this.menus) return;
    this.paused = true;
    input.gameplay = false;
    audio.duck(true);
    this.showPause();
  }

  private showPause(): void {
    this.menus?.pause.show();
  }

  private resume(): void {
    if (!this.menus) return;
    this.paused = false;
    audio.duck(false);
    this.menus.pause.hide();
    input.gameplay = !flags.autoplay;
    input.requestLock();
  }

  // ---- Settings --------------------------------------------------------------------------------
  private applyGraphics(): void {
    const st = save.settings;
    this.renderer.applySettings({ ...st, preset: flags.preset ?? (automated ? 'low' : st.preset) });
  }

  private applyInterface(): void {
    const st = save.settings;
    const root = document.documentElement;
    if (st.palette === 'default') delete root.dataset.palette;
    else root.dataset.palette = st.palette;
    if (st.hudMotion === 'auto') delete root.dataset.motion;
    else root.dataset.motion = st.hudMotion;
    root.style.setProperty('--hud-scale', String(st.hudScale));
    root.style.setProperty('--hud-opacity', String(st.hudOpacity));
    toggle(this.debugEl, 'hidden', !st.showFps);
  }

  private onSettingChange(key: keyof Settings): void {
    if (key.startsWith('vol')) audio.setVolumes(save.settings);
    else if (GRAPHICS_KEYS.includes(key)) {
      this.applyGraphics();
      this.battle?.applyQuality();
    } else if (key === 'difficulty') this.battle?.ai.setDifficulty(save.settings.difficulty);
    else {
      this.applyInterface();
      if (key === 'palette') this.battle?.hud?.refreshPalette();
    }
  }

  // ---- Range autopilot -------------------------------------------------------------------------
  /** Scripted pilot for automated runs of the firing range (bots drive the player on the battlefield). */
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

  // ---- Loop ------------------------------------------------------------------------------------
  private tick = (now: number): void => {
    requestAnimationFrame(this.tick);
    const frameMs = now - this.last;
    const dt = Math.min(TUNING.loop.maxFrameSeconds, frameMs / 1000);
    this.frameMs.push(frameMs);
    if (save.settings.dynamicResolution) this.renderer.trackFrame(frameMs, now / 1000);
    this.last = now;
    this.frames++;
    if (this.flow && this.state === 'playing' && !this.paused) {
      this.flow.frame(dt);
      this.flowVisited.add(this.flow.state);
    }
    if (this.scene?.frame && !this.paused) this.scene.frame(dt);
    if (flags.autoplay && flags.scene === 'range') this.autopilot(dt);
    const step = 1 / TUNING.loop.hz;
    this.acc += dt;
    let steps = 0;
    while (this.acc >= step && steps < TUNING.loop.maxStepsPerFrame) {
      const t0 = performance.now();
      if (!this.paused) {
        if (this.state === 'playing') this.matchTime += step;
        this.scene?.update(step);
      }
      this.stepMs.push(performance.now() - t0);
      this.acc -= step;
      steps++;
    }
    if (steps >= TUNING.loop.maxStepsPerFrame) this.acc = 0;
    if (this.scene) this.scene.render(this.acc / step, dt);
    else this.renderer.gl.clear();
    if (this.battle && save.settings.showFps) {
      const fps = 1000 / Math.max(1, this.frameMs.percentile(0.5));
      setText(this.debugEl, `${fps.toFixed(0)} fps  ${this.frameMs.percentile(0.5).toFixed(1)} ms  sim ${this.stepMs.percentile(0.5).toFixed(1)} ms\n${this.renderer.drawCalls} draw calls  scale ${(this.renderer.dynamicScale * 100).toFixed(0)}%\n${Object.values(this.battle.debug).join('  ')}`);
    }
  };

  // ---- Test hooks ------------------------------------------------------------------------------
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
      kills: this.battle ? this.battle.soldiers.reduce((n, s) => n + s.stats.kills, 0) : 0,
      tickets: this.battle?.mode instanceof SectorMode ? [Math.round(this.battle.mode.scores()[0]), Math.round(this.battle.mode.scores()[1])] : [0, 0],
      vehiclesUsed: this.battle ? this.battle.callIns.requests + this.battle.vehicles.entries : 0,
      gadgetsUsed: this.battle?.gadgets.uses ?? 0,
      stormEvents: this.battle?.world.storms ?? 0,
      flowVisited: [...this.flowVisited],
      notes: this.battle ? [JSON.stringify({ ...this.battle.debug, flow: this.flow?.state ?? '-' }), JSON.stringify(this.battle.ai.summary()), this.battle.mode instanceof SectorMode ? this.battle.mode.zones.map((z) => `${z.id}:${z.owner}:${z.control.toFixed(2)}${z.contested ? '!' : ''}`).join(' ') : '', this.battle.vehicles.list.map((v) => `${v.kind}${v.team}:${v.crewCount}:${Math.round(v.hp)}@${Math.round(v.pos.x)},${Math.round(v.pos.y)},${Math.round(v.pos.z)}${v.alive ? '' : 'X'}`).join(' '), this.battle.ai.crews.debugLine(this.battle.ai.brains), `audio ${audio.ctx?.state ?? 'off'} voices ${audio.activeVoices} peak ${audio.peakDb.toFixed(1)} dB rms ${audio.rmsDb.toFixed(1)} dB`] : [],
    };
  }

  testAction(name: string): boolean {
    const b = this.battle;
    if (!b) return false;
    const p = b.player;
    if (name === 'downPlayer' || name === 'killPlayer') {
      if (!p.alive) return false;
      const foe = b.soldiers.find((s) => s.team !== p.team && s.alive) ?? null;
      p.spawnProtectT = 0;
      p.armor = 0;
      damageSoldier(b, p, name === 'killPlayer' ? 400 : p.health + 1, { attacker: foe, weapon: foe?.primary ?? 'tern', part: 'body', explosive: name === 'killPlayer', from: foe?.pos.clone() ?? p.pos.clone(), armorMul: 1 });
      return true;
    }
    if (name === 'endRound' && b.mode instanceof SkirmishMode) {
      b.mode.timeLeft = 0;
      return true;
    }
    if (name === 'endRound' && b.mode instanceof SectorMode) {
      b.mode.tickets.tickets[1] = 0;
      return true;
    }
    if (name === 'callin') {
      if (!p.alive) return false;
      const at = b.dropPoint(p, p.pos.clone());
      return b.callIns.request(p, 'wisp', at.point, at.point.y);
    }
    if (name.startsWith('board')) {
      // Puts the player in the nearest friendly vehicle of a kind (board:wisp, board:condor ...).
      if (!p.active) return false;
      if (p.inVehicle) b.vehicles.exit(p, b, true);
      const kind = name.split(':')[1] ?? 'wisp';
      const v = b.vehicles.list.filter((x) => x.alive && x.kind === kind && x.team === p.team && x.seats[0] === null).sort((x, y) => x.pos.distanceTo(p.pos) - y.pos.distanceTo(p.pos))[0];
      if (!v) return false;
      return b.vehicles.enter(p, v, 0);
    }
    if (name === 'exitVehicle') return p.inVehicle && b.vehicles.exit(p, b, true);
    if (name.startsWith('ads:')) {
      // Hold aim-down-sights with a sight (screenshots of the reticles).
      const sight = name.slice(4) as AttachmentSet['sight'];
      const w = p.arsenal.current;
      if (!WEAPON_BY_ID[w.id].sights.includes(sight)) return false;
      b.setAttachments({ ...w.att, sight });
      b.forceAds = true;
      return true;
    }
    if (name === 'storm') return b.world.forceStorm();
    if (name === 'launch') return b.world.forceLaunch();
    if (name === 'blowFuel') {
      // Destroys the fuel farm so the launch detonates.
      for (const d of b.destructibles.items) if (d.tag === 'rocketFuel' && d.alive) b.destructibles.destroy(d);
      return true;
    }
    if (name === 'showcase') {
      if (!p.alive) return false;
      b.gadgets.showcase(p, b);
      return true;
    }
    // UI exercise for automated runs: open and close overlays and menu screens.
    const m = this.menus;
    if (name === 'scoreboard' && b.hud) {
      b.forceScoreboard = !b.forceScoreboard;
      return true;
    }
    if (name === 'fullmap' && b.hud?.fullMap) {
      b.hud.fullMap.toggle();
      return true;
    }
    if (name === 'pause' && m) {
      if (this.paused) this.resume();
      else this.pause();
      return true;
    }
    if (m && (name === 'settings' || name === 'controls' || name === 'loadout')) {
      const s = m[name];
      if (s.open) this.closeSub();
      else this.openSub(s, () => (this.paused ? this.showPause() : this.state === 'menu' ? m.main.show() : undefined));
      return true;
    }
    if (name === 'menu' && m) {
      if (this.state === 'menu') this.startMatch({ mode: b.mode instanceof SkirmishMode ? 'skirmish' : 'sector', teamSize: b.mode instanceof SectorMode ? b.mode.teamSize : save.settings.teamSize, difficulty: save.settings.difficulty });
      else this.toMenu();
      return true;
    }
    return false;
  }

  resetTestStats(): void {
    this.flowVisited.clear();
    this.frameMs.reset();
    this.stepMs.reset();
    this.frames = 0;
    this.matchTime = 0;
  }
}
