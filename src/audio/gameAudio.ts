// Battle audio: turns gameplay events into sounds, steps footsteps for soldiers near the listener,
// runs oscillator engine voices for nearby vehicles, keeps the wind, rain and storm beds and the
// launch rumble, follows the camera with indoor/outdoor reverb, and drives the adaptive score.
import * as THREE from 'three';
import { TUNING } from '../config/tuning';
import { WEAPON_BY_ID } from '../config/content';
import { clamp, smoothstep } from '../core/math';
import { audio } from './engine';
import { distanceModel, musicIntensity } from './synth';
import { Music } from './music';
import * as S from './sounds';
import type { EventBus } from '../core/events';
import type { Soldier } from '../player/soldier';
import type { VehicleSystem } from '../vehicles/system';
import type { Vehicle } from '../vehicles/vehicle';
import type { CollisionWorld } from '../physics/collision';
import type { WorldEvents } from '../world/events';
import type { Rocket } from '../world/rocket';
import type { Surface } from '../world/surface';

const A = TUNING.audio;

export interface AudioHost {
  readonly events: EventBus;
  readonly player: Soldier;
  readonly soldiers: readonly Soldier[];
  readonly vehicles: VehicleSystem;
  readonly collision: CollisionWorld;
  readonly world: WorldEvents;
  readonly rocket: Rocket | null;
  readonly time: number;
  /** Ground surface under a point (terrain or the object below). */
  surfaceUnder(p: THREE.Vector3): Surface;
  /** Lowest team score as a fraction of its maximum (1 when the mode has none). */
  scoreFraction(): number;
  /** True while a round is being played (not the menu flyover). */
  inMatch(): boolean;
}

interface Loop {
  src: AudioScheduledSourceNode[];
  gain: GainNode;
  filter: BiquadFilterNode;
  panner: PannerNode | null;
  lfo?: OscillatorNode;
  osc?: OscillatorNode[];
}

const _v = new THREE.Vector3();
const _f = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const DIRS = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)];

export class GameAudio {
  private off: (() => void)[] = [];
  private lastShot = new Map<number, number>();
  private stride = new Map<number, number>();
  private engines = new Map<number, Loop>();
  private beds: { wind: Loop; rain: Loop; storm: Loop; launch: Loop } | null = null;
  private music = new Music();
  private indoor = 0;
  private probeT = 0;
  private impactsThisFrame = 0;
  private pingT = 0;

  constructor(private host: AudioHost) {
    const e = host.events;
    const own = (s: Soldier) => s === host.player;
    this.off.push(
      e.on('shot', (ev) => {
        if (!audio.ctx) return;
        const s = ev.soldier;
        const last = this.lastShot.get(s.id) ?? -1;
        if (!own(s) && host.time - last < 0.045) return;
        this.lastShot.set(s.id, host.time);
        const w = WEAPON_BY_ID[ev.weapon];
        S.gunshot(w.category, ev.energy, ev.suppressed, ev.pos, own(s));
      }),
      e.on('mountShot', (ev) => {
        if (!audio.ctx) return;
        const last = this.lastShot.get(ev.soldier.id) ?? -1;
        if (ev.kind !== 'cannon' && host.time - last < 0.07) return;
        this.lastShot.set(ev.soldier.id, host.time);
        S.mountShot(ev.kind, ev.pos);
      }),
      e.on('impact', (ev) => {
        if (!audio.ctx || this.impactsThisFrame > 6) return;
        this.impactsThisFrame++;
        S.impact(ev.surface, ev.energy, ev.pos);
      }),
      e.on('whiz', (ev) => S.nearMiss(ev.pos, ev.crack)),
      e.on('explosion', (ev) => S.explosion(ev.pos, ev.radius, ev.kind)),
      e.on('reload', (ev) => S.reload(ev.soldier.pos, own(ev.soldier))),
      e.on('empty', (ev) => {
        if (own(ev.soldier)) S.dryFire();
      }),
      e.on('throw', (ev) => S.handling('throw', own(ev.soldier) ? null : ev.soldier.pos)),
      e.on('melee', (ev) => S.handling('melee', own(ev.soldier) ? null : ev.soldier.pos)),
      e.on('ui', (ev) => S.handling(ev.sound === 'mode' ? 'mode' : 'swap', null)),
      e.on('hit', (ev) => {
        if (ev.attacker !== host.player || ev.kind !== 'soldier') return;
        S.hitConfirm(ev.kill || ev.downed ? 'kill' : ev.part === 'head' ? 'head' : ev.armorBreak ? 'armor' : 'hit');
      }),
      e.on('damaged', (ev) => {
        if (ev.victim === host.player && ev.amount > 0) S.hurt(ev.amount);
      }),
      e.on('announce', (ev) => S.stinger(ev.tone)),
      e.on('capture', (ev) => S.stinger(ev.team === host.player.team ? 'good' : 'bad')),
      e.on('lightning', (ev) => S.thunder(ev.pos)),
      e.on('ping', (ev) => {
        if (ev.soldier.team !== host.player.team || host.time - this.pingT < 0.4) return;
        this.pingT = host.time;
        S.ui('ping');
      }),
      e.on('spawn', (ev) => {
        if (own(ev.soldier)) S.spawnWhoosh();
      }),
    );
  }

  /** Per rendered frame: listener, footsteps, engines, beds, music. */
  update(dt: number, camera: THREE.Camera): void {
    const ctx = audio.ctx;
    if (!ctx) return;
    this.impactsThisFrame = 0;
    const cam = camera.position;
    camera.getWorldDirection(_f);
    this.probeT -= dt;
    if (this.probeT <= 0) {
      this.probeT = 0.25;
      this.indoor = this.probeIndoor(cam);
    }
    audio.setListener(cam, _f, this.indoor);
    this.footsteps(dt, cam);
    this.updateEngines(cam);
    this.updateBeds(cam);
    const p = this.host.player;
    const combat = clamp(1 - (this.host.time - p.lastCombatT) / A.combatHold, 0, 1);
    this.music.setTarget(musicIntensity(this.host.scoreFraction(), combat, this.host.inMatch()));
    this.music.update(dt);
    audio.measure();
  }

  private probeIndoor(cam: THREE.Vector3): number {
    const c = this.host.collision;
    const roof = c.raycast(cam, _up, A.roofProbe, { worldOnly: true });
    if (!roof) return 0;
    let walls = 0;
    for (const d of DIRS) if (c.raycast(cam, d, A.wallProbe, { worldOnly: true })) walls++;
    return walls >= 2 ? 1 : 0.5;
  }

  private footsteps(dt: number, cam: THREE.Vector3): void {
    const R = TUNING.audio.hear.footstep;
    const F = A.footstepStride;
    for (const s of this.host.soldiers) {
      if (!s.alive || s.downed || s.inVehicle || (s.state !== 'ground' && s.state !== 'slide')) continue;
      if (s.pos.distanceToSquared(cam) > R * R) continue;
      const sp = Math.hypot(s.vel.x, s.vel.z);
      if (sp < 0.6 || s.state === 'slide') continue;
      const stride = s.sprinting || s.tacSprint ? F.sprint : s.stance !== 'stand' ? F.crouch : F.walk;
      const acc = (this.stride.get(s.id) ?? 0) + sp * dt;
      if (acc < stride) {
        this.stride.set(s.id, acc);
        continue;
      }
      this.stride.set(s.id, 0);
      const loud = s.sprinting || s.tacSprint ? 1.3 : s.stance !== 'stand' ? 0.4 : 0.8;
      S.footstep(this.host.surfaceUnder(s.pos), s.pos, s === this.host.player, loud);
    }
  }

  // ---- Vehicle engines -------------------------------------------------------------------------
  private updateEngines(cam: THREE.Vector3): void {
    const ctx = audio.ctx!;
    const R = TUNING.audio.hear.vehicle;
    const near: Vehicle[] = [];
    for (const v of this.host.vehicles.list) if (v.alive && v.pos.distanceToSquared(cam) < R * R) near.push(v);
    near.sort((a, b) => a.pos.distanceToSquared(cam) - b.pos.distanceToSquared(cam));
    near.length = Math.min(near.length, 8);
    const keep = new Set(near.map((v) => v.id));
    for (const [id, l] of this.engines) {
      if (keep.has(id)) continue;
      this.stopLoop(l);
      this.engines.delete(id);
    }
    for (const v of near) {
      let l = this.engines.get(v.id);
      if (!l) {
        l = this.engineLoop(v);
        this.engines.set(v.id, l);
      }
      const d = v.pos.distanceTo(cam);
      const dm = distanceModel(d);
      const speed = Math.hypot(v.vel.x, v.vel.z);
      const manned = v.crewCount > 0;
      const t = ctx.currentTime;
      let base: number, level: number;
      switch (v.kind) {
        case 'wisp':
          base = 62 + speed * 3.2;
          level = manned ? 0.22 : 0.06;
          break;
        case 'basalt':
          base = 34 + speed * 2.4;
          level = manned ? 0.32 : 0.1;
          break;
        case 'condor':
          base = 70 + speed * 1.6 + (v.forwardFlight ? 40 : 0);
          level = manned ? 0.34 : 0.08;
          break;
        default:
          base = 58 + speed * 1.2;
          level = manned ? 0.34 : 0.08;
      }
      l.osc![0].frequency.setTargetAtTime(base, t, 0.1);
      l.osc![1].frequency.setTargetAtTime(base * 1.49, t, 0.1);
      if (l.lfo) l.lfo.frequency.setTargetAtTime(manned ? (v.kind === 'midge' ? 14 : 9) : 3, t, 0.3);
      l.gain.gain.setTargetAtTime(level * dm.gain * 1.6, t, 0.1);
      l.filter.frequency.setTargetAtTime(Math.min(dm.cutoff, 400 + speed * 40 + (v.aircraft ? 1400 : 600)), t, 0.1);
      const pn = l.panner!;
      if (pn.positionX) {
        pn.positionX.setTargetAtTime(v.pos.x, t, 0.05);
        pn.positionY.setTargetAtTime(v.pos.y + 1, t, 0.05);
        pn.positionZ.setTargetAtTime(v.pos.z, t, 0.05);
      } else pn.setPosition(v.pos.x, v.pos.y + 1, v.pos.z);
    }
  }

  private engineLoop(v: Vehicle): Loop {
    const ctx = audio.ctx!;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 800;
    const panner = ctx.createPanner();
    panner.panningModel = 'equalpower';
    panner.distanceModel = 'linear';
    panner.rolloffFactor = 0;
    const mix = ctx.createGain();
    const o1 = ctx.createOscillator();
    o1.type = 'sawtooth';
    const o2 = ctx.createOscillator();
    o2.type = 'square';
    const o2g = ctx.createGain();
    o2g.gain.value = 0.4;
    o1.connect(mix);
    o2.connect(o2g).connect(mix);
    const nz = audio.noiseSource(v.aircraft ? 'pink' : 'brown', true);
    const nzf = ctx.createBiquadFilter();
    nzf.type = 'bandpass';
    nzf.frequency.value = v.aircraft ? 900 : 200;
    nzf.Q.value = 0.8;
    const nzg = ctx.createGain();
    nzg.gain.value = v.aircraft ? 1.4 : 0.8;
    nz.connect(nzf).connect(nzg).connect(mix);
    const src: AudioScheduledSourceNode[] = [o1, o2, nz];
    const l: Loop = { src, gain, filter, panner, osc: [o1, o2] };
    // Rotor chop / hover throb: amplitude modulation.
    if (v.kind !== 'basalt') {
      const am = ctx.createGain();
      am.gain.value = 0.6;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 9;
      const depth = ctx.createGain();
      depth.gain.value = v.kind === 'midge' ? 0.45 : 0.2;
      lfo.connect(depth).connect(am.gain);
      mix.connect(am).connect(filter);
      src.push(lfo);
      l.lfo = lfo;
    } else mix.connect(filter);
    filter.connect(gain).connect(panner).connect(audio.bus('sfx')!);
    for (const s of src) s.start();
    return l;
  }

  private stopLoop(l: Loop): void {
    const ctx = audio.ctx;
    if (!ctx) return;
    l.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
    for (const s of l.src) s.stop(ctx.currentTime + 0.4);
    setTimeout(() => {
      l.gain.disconnect();
      l.panner?.disconnect();
    }, 600);
  }

  // ---- Ambient beds ----------------------------------------------------------------------------
  private bed(kind: 'white' | 'pink' | 'brown', type: BiquadFilterType, freq: number, spatial: boolean): Loop {
    const ctx = audio.ctx!;
    const src = audio.noiseSource(kind, true);
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = 0.6;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    let panner: PannerNode | null = null;
    src.connect(filter).connect(gain);
    if (spatial) {
      panner = ctx.createPanner();
      panner.panningModel = 'equalpower';
      panner.distanceModel = 'linear';
      panner.rolloffFactor = 0;
      gain.connect(panner).connect(audio.bus('sfx')!);
    } else gain.connect(audio.bus('sfx')!);
    src.start(0, Math.random() * 2);
    return { src: [src], gain, filter, panner };
  }

  private updateBeds(cam: THREE.Vector3): void {
    const ctx = audio.ctx!;
    if (!this.beds) this.beds = { wind: this.bed('pink', 'bandpass', 400, false), rain: this.bed('white', 'highpass', 1800, false), storm: this.bed('brown', 'lowpass', 140, true), launch: this.bed('brown', 'lowpass', 90, true) };
    const b = this.beds;
    const w = this.host.world;
    const t = ctx.currentTime;
    const out = 1 - this.indoor * 0.7;
    const wind = w.wind.length();
    b.wind.gain.gain.setTargetAtTime((0.025 + wind * 0.01) * out, t, 0.5);
    b.wind.filter.frequency.setTargetAtTime(260 + wind * 30, t, 0.5);
    b.rain.gain.gain.setTargetAtTime(w.rain * 0.16 * out, t, 0.4);
    // Storm roar from the funnel's position.
    const sd = Math.hypot(cam.x - w.stormPos.x, cam.z - w.stormPos.z);
    const storm = w.stormIntensity * (1 - smoothstep(40, 700, sd));
    b.storm.gain.gain.setTargetAtTime(storm * 0.9, t, 0.4);
    this.place(b.storm.panner!, w.stormPos.x, w.stormPos.y + 20, w.stormPos.z, t);
    // Launch rumble.
    const rk = this.host.rocket;
    const burning = rk && (w.launchPhase === 'ignition' || w.launchPhase === 'ascent');
    if (rk && burning) {
      rk.exhaust(_v);
      const dm = distanceModel(_v.distanceTo(cam));
      b.launch.gain.gain.setTargetAtTime(Math.min(1, dm.gain * 9) * (w.launchPhase === 'ignition' ? 1 : 0.7), t, 0.3);
      this.place(b.launch.panner!, _v.x, _v.y, _v.z, t);
    } else b.launch.gain.gain.setTargetAtTime(0, t, 0.6);
  }

  private place(p: PannerNode, x: number, y: number, z: number, t: number): void {
    if (p.positionX) {
      p.positionX.setTargetAtTime(x, t, 0.1);
      p.positionY.setTargetAtTime(y, t, 0.1);
      p.positionZ.setTargetAtTime(z, t, 0.1);
    } else p.setPosition(x, y, z);
  }

  dispose(): void {
    for (const f of this.off) f();
    this.off.length = 0;
    for (const l of this.engines.values()) this.stopLoop(l);
    this.engines.clear();
    if (this.beds) for (const l of Object.values(this.beds)) this.stopLoop(l);
    this.beds = null;
  }
}
