// Dynamic world events and the weather they drive. The ion storm forms at a map edge, crosses the
// battlefield past an objective, pulls and lifts soldiers and vehicles, tears props apart, damages
// whatever sits in its core and throws lightning; rain bands run ahead of it and visibility drops
// near it. The launch sequence counts down at pad A: with the fuel farm intact the rocket burns on
// the pad and climbs away, with the farm destroyed it detonates and leaves rubble on the pad. The
// round also drifts from afternoon to dusk and the wind wanders. Banners, the HUD event timer and
// minimap hazard cones come from here; bots read the danger zones to stay clear.
import * as THREE from 'three';
import { TUNING } from '../config/tuning';
import { Rng } from '../core/rng';
import { clamp, smoothstep, yawOf, bearingDeg } from '../core/math';
import { damageSoldier, explode, type CombatContext } from '../weapons/damage';
import { fling } from '../player/movement';
import { StormVisual } from '../render/stormFx';
import { ModelBuilder, box, cyl } from '../render/toon';
import type { VehicleSystem } from '../vehicles/system';
import type { Destructibles } from './destruction';
import type { Rocket } from './rocket';
import type { DynBox } from '../physics/collision';
import type RAPIER from '@dimforge/rapier3d-compat';

const S = TUNING.events.storm;
const L = TUNING.events.launch;
const WX = TUNING.weather;

/** A map hazard: drawn on the maps (with an optional travel cone) and avoided by bots when dangerous. */
export interface Hazard {
  x: number;
  z: number;
  r: number;
  label: string;
  /** Travel heading (yaw) and how far ahead the warning cone reaches. */
  dir?: number;
  reach?: number;
  /** Bots keep out while true. */
  danger: boolean;
}

export interface EventTimer {
  label: string;
  seconds: number;
  tone: 'warn' | 'bad' | 'info';
}

export interface EventHost extends CombatContext {
  readonly scene: THREE.Scene;
  readonly vehicles: VehicleSystem;
  readonly destructibles: Destructibles;
  readonly rocket: Rocket | null;
  groundHeight(x: number, z: number): number;
  /** Points the storm aims to pass near (objective centers). */
  stormTargets(): readonly { x: number; z: number }[];
  /** Camera shake for the local player near a point. */
  shakeAt(pos: THREE.Vector3, amount: number, radius: number): void;
}

type StormPhase = 'idle' | 'warn' | 'active' | 'done';
type LaunchPhase = 'idle' | 'countdown' | 'ignition' | 'ascent' | 'detonated' | 'done';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

export class WorldEvents {
  readonly rng = new Rng(4242);
  readonly hazards: Hazard[] = [];
  /** Off on maps without the event set (training ground). */
  enabled = true;
  /** Round clock for scheduling. */
  t = 0;
  // ---- Storm
  stormPhase: StormPhase = 'idle';
  private stormAt: number[] = [];
  private stormT = 0;
  readonly stormPos = new THREE.Vector3();
  private readonly stormPrev = new THREE.Vector3();
  private readonly stormDir = new THREE.Vector3(1, 0, 0);
  /** 0..1: fades the funnel in and out. */
  stormIntensity = 0;
  private strikeAcc = 0;
  private dmgT = 0;
  private skirtT = 0;
  private arcT = 0;
  private readonly visual: StormVisual;
  // ---- Launch
  launchPhase: LaunchPhase = 'idle';
  private launchAt = Infinity;
  private launchT = 0;
  private fuelStart = 0;
  private calls = new Set<number>();
  private rubble: { mesh: THREE.Object3D; colliders: RAPIER.Collider[]; boxes: DynBox[] } | null = null;
  // ---- Weather
  readonly wind = new THREE.Vector3(3, 0, 1);
  private windAngle = 0.4;
  dayT = WX.dayStart;
  /** Outputs for the frame: sky darkening, fog closing in, rain and dust at the camera. */
  storm = 0;
  fogMix = 0;
  rain = 0;
  dust = 0.3;
  // ---- Stats
  storms = 0;
  launches = 0;
  detonations = 0;

  constructor(
    private host: EventHost,
    private fast = false,
  ) {
    this.visual = new StormVisual(host.scene, S.height);
    this.reset();
  }

  /** New round: schedules the events and puts the world back. */
  reset(): void {
    this.t = 0;
    this.stormPhase = 'idle';
    this.stormIntensity = 0;
    this.launchPhase = 'idle';
    this.calls.clear();
    this.hazards.length = 0;
    this.dayT = WX.dayStart;
    const r = this.rng;
    if (this.fast) {
      this.stormAt = [TUNING.events.fast.storm];
      this.launchAt = TUNING.events.fast.launch;
    } else {
      this.stormAt = [r.range(S.firstAt[0], S.firstAt[1])];
      if (r.next() < S.secondChance) this.stormAt.push(r.range(S.secondAt[0], S.secondAt[1]));
      this.launchAt = r.range(L.at[0], L.at[1]);
    }
    if (this.rubble) {
      this.rubble.mesh.removeFromParent();
      for (const c of this.rubble.colliders) this.host.physics.removeCollider(c);
      for (const b of this.rubble.boxes) this.host.collision.remove(b);
      this.rubble = null;
    }
    this.host.rocket?.reset();
  }

  /** Test hooks: start an event now. */
  forceStorm(): boolean {
    if (this.stormPhase === 'warn' || this.stormPhase === 'active') return false;
    this.beginStorm();
    return true;
  }

  forceLaunch(): boolean {
    if (!this.host.rocket || this.launchPhase !== 'idle') return false;
    this.launchAt = this.t;
    return true;
  }

  // ---- Simulation tick ------------------------------------------------------------------------
  update(dt: number): void {
    this.t += dt;
    this.dayT = WX.dayStart + (WX.dayEnd - WX.dayStart) * clamp(this.t / WX.dayLength, 0, 1);
    // Wind wanders; the storm drags it along.
    this.windAngle += (this.rng.next() - 0.5) * WX.windDrift * 2 * dt * 60;
    const gust = WX.windBase + Math.sin(this.t * 0.21) * WX.windGust * 0.5 + Math.sin(this.t * 0.07 + 1.3) * WX.windGust * 0.5;
    this.wind.set(Math.cos(this.windAngle) * gust, 0, Math.sin(this.windAngle) * gust);
    if (!this.enabled) return;
    if (this.stormPhase === 'idle' && this.stormAt.length && this.t >= this.stormAt[0]) {
      this.stormAt.shift();
      this.beginStorm();
    }
    if (this.stormPhase === 'warn' || this.stormPhase === 'active') this.stepStorm(dt);
    this.stepLaunch(dt);
    this.updateHazards();
  }

  // ---- Ion storm ------------------------------------------------------------------------------
  private beginStorm(): void {
    const h = this.host;
    const r = this.rng;
    const lim = TUNING.movement.mapLimit - 30;
    const side = r.next() < 0.5 ? -1 : 1;
    this.stormPos.set(side * lim, 0, r.range(-S.startSpread, S.startSpread));
    const targets = h.stormTargets();
    const tg = targets.length ? targets[Math.floor(r.next() * targets.length)] : { x: 0, z: 0 };
    this.stormDir.set(tg.x + r.range(-S.aimJitter, S.aimJitter) - this.stormPos.x, 0, tg.z + r.range(-S.aimJitter, S.aimJitter) - this.stormPos.z).normalize();
    this.stormPos.y = h.groundHeight(this.stormPos.x, this.stormPos.z);
    this.stormPrev.copy(this.stormPos);
    this.stormPhase = 'warn';
    this.stormT = 0;
    this.stormIntensity = 0;
    this.storms++;
    const heading = Math.round(bearingDeg(yawOf(this.stormDir.x, this.stormDir.z)));
    h.events.emit('announce', { text: 'Ion storm forming', sub: `Crossing the map on a heading of ${String(heading).padStart(3, '0')}° in ${S.warnSeconds} s`, tone: 'warn' });
    h.events.emit('worldEvent', { kind: 'storm', phase: 'warn', pos: this.stormPos.clone() });
  }

  private stepStorm(dt: number): void {
    const h = this.host;
    this.stormT += dt;
    this.stormPrev.copy(this.stormPos);
    if (this.stormPhase === 'warn') {
      this.stormIntensity = 0.45 * clamp(this.stormT / S.warnSeconds, 0, 1);
      if (this.stormT >= S.warnSeconds) {
        this.stormPhase = 'active';
        this.stormT = 0;
        h.events.emit('announce', { text: 'Ion storm', sub: 'Get clear of the funnel; lightning strikes around it', tone: 'bad' });
        h.events.emit('worldEvent', { kind: 'storm', phase: 'active', pos: this.stormPos.clone() });
      }
    } else {
      this.stormPos.addScaledVector(this.stormDir, S.speed * dt);
      this.stormPos.y = h.groundHeight(this.stormPos.x, this.stormPos.z);
      const lim = TUNING.movement.mapLimit + 40;
      const leaving = Math.abs(this.stormPos.x) > lim - 60 || Math.abs(this.stormPos.z) > lim - 60 || this.stormT > S.maxSeconds - 10;
      this.stormIntensity = leaving ? Math.max(0, this.stormIntensity - dt / S.fadeOut) : Math.min(1, this.stormIntensity + dt / S.fadeIn);
      if ((leaving && this.stormIntensity <= 0) || this.stormT > S.maxSeconds) {
        this.stormPhase = this.stormAt.length ? 'idle' : 'done';
        this.stormIntensity = 0;
        h.events.emit('announce', { text: 'Ion storm passed', tone: 'info' });
        h.events.emit('worldEvent', { kind: 'storm', phase: 'end', pos: this.stormPos.clone() });
        return;
      }
    }
    const k = this.stormIntensity;
    if (k < 0.05) return;
    const c = this.stormPos;
    // Winds: pull in, swirl around, lift near the core.
    this.dmgT += dt;
    const tick = this.dmgT >= 0.25;
    if (tick) this.dmgT = 0;
    for (const s of h.soldiers) {
      if (!s.alive || s.dummy) continue;
      const dx = c.x - s.pos.x, dz = c.z - s.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > S.pullRadius || s.inVehicle) continue;
      const f = (1 - d / S.pullRadius) * k;
      const nx = dx / Math.max(0.5, d), nz = dz / Math.max(0.5, d);
      const above = s.pos.y - h.groundHeight(s.pos.x, s.pos.z);
      const lift = d < S.liftRadius && above < S.maxLiftHeight ? S.lift * (1 - d / S.liftRadius) * k : 0;
      fling(s, (nx * S.pull + nz * S.swirl) * f * dt, lift * dt, (nz * S.pull - nx * S.swirl) * f * dt);
      if (tick && d < S.coreRadius) damageSoldier(h, s, S.coreDps * 0.25 * k, { attacker: null, weapon: 'Ion storm', part: null, explosive: false, from: c, armorMul: 1 });
    }
    for (const v of h.vehicles.list) {
      if (!v.alive) continue;
      const dx = c.x - v.pos.x, dz = c.z - v.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > S.pullRadius) continue;
      const f = (1 - d / S.pullRadius) * k;
      const nx = dx / Math.max(0.5, d), nz = dz / Math.max(0.5, d);
      const lift = d < S.liftRadius ? S.vehicleLift * (1 - d / S.liftRadius) * k : 0;
      h.vehicles.push(v, (nx * S.vehiclePull + nz * S.swirl * 0.6) * f * dt, lift * dt, (nz * S.vehiclePull - nx * S.swirl * 0.6) * f * dt);
      if (tick && d < S.liftRadius) h.vehicles.damage(v, S.vehicleDps * 0.25 * k, null, h, false);
    }
    // Tear props apart.
    if (tick) h.destructibles.radiusDamage(c, S.tearRadius, S.tearDps * 0.25 * k);
    // Lightning.
    this.strikeAcc += S.strikesPerSecond * k * dt;
    while (this.strikeAcc >= 1) {
      this.strikeAcc -= 1;
      this.lightning();
    }
    // Arcs inside the funnel and the dust skirt (visual only).
    this.arcT -= dt;
    if (this.arcT <= 0) {
      this.arcT = 0.12 + this.rng.next() * 0.25;
      const a = this.rng.next() * Math.PI * 2, b = a + 1 + this.rng.next() * 2;
      const y0 = 20 + this.rng.next() * 90;
      const r0 = 6 + y0 * 0.3;
      _v.set(c.x + Math.cos(a) * r0, c.y + y0, c.z + Math.sin(a) * r0);
      _v2.set(c.x + Math.cos(b) * r0 * 1.2, c.y + y0 + 10 + this.rng.next() * 20, c.z + Math.sin(b) * r0 * 1.2);
      h.vfx.bolt(_v, _v2, 0x9af6ff, { width: 0.35, life: 0.12, segments: 7, jag: 2.5 });
    }
    this.skirtT -= dt;
    if (this.skirtT <= 0) {
      this.skirtT = 0.06;
      const a = this.rng.next() * Math.PI * 2, r = 4 + this.rng.next() * 18;
      _v.set(c.x + Math.cos(a) * r, c.y + 0.5, c.z + Math.sin(a) * r);
      h.vfx.burst(_v, { count: 2, color: 0x8a7464, color2: 0x5a4a48, speed: [3, 8], up: 4, life: [1, 2], size: [1.2, 2.4], sizeEnd: 4, shape: 'puff', additive: false, dir: _v2.set(-Math.sin(a), 0.4, Math.cos(a)), spread: 0.4 });
    }
    h.shakeAt(c, 0.012 * k, S.pullRadius * 1.6);
  }

  private lightning(): void {
    const h = this.host;
    const c = this.stormPos;
    const r = this.rng;
    // Mostly random ground near the storm, sometimes a soldier caught out in the open.
    let x: number, z: number;
    const victims = h.soldiers.filter((s) => s.alive && !s.inVehicle && Math.hypot(s.pos.x - c.x, s.pos.z - c.z) < S.strikeRadius);
    if (victims.length && r.next() < S.victimChance) {
      const v = victims[Math.floor(r.next() * victims.length)];
      x = v.pos.x + r.range(-4, 4);
      z = v.pos.z + r.range(-4, 4);
    } else {
      const a = r.next() * Math.PI * 2, d = S.strikeMinDistance + Math.sqrt(r.next()) * S.strikeRadius;
      x = c.x + Math.cos(a) * d;
      z = c.z + Math.sin(a) * d;
    }
    const top = h.groundHeight(x, z) + 160;
    const gy = h.collision.groundBelow(x, top, z, 400) ?? h.groundHeight(x, z);
    const hit = _v.set(x, gy, z);
    const from = _v2.set(c.x + (x - c.x) * 0.3 + r.range(-10, 10), c.y + S.height * 0.8, c.z + (z - c.z) * 0.3 + r.range(-10, 10));
    h.vfx.bolt(from, hit, 0xd8fbff, { width: 0.9, life: 0.22, segments: 14, jag: 6, branches: 3 });
    h.vfx.flash(hit, 0xbff6ff, 6, 0.18);
    h.vfx.light(hit, 0x9af6ff, 220, 0.25, 70);
    h.vfx.shockwave(hit, 0x9af6ff, S.strikeBlast * 1.6, 0.35, { r0: 0.5 });
    h.vfx.burst(hit, { count: 14, color: 0xe8fcff, color2: 0x7cf0ff, speed: [6, 16], up: 6, life: [0.2, 0.5], size: [0.08, 0.16], shape: 'spark', additive: true });
    explode(h, hit.clone().setY(hit.y + 0.3), { radius: S.strikeBlast, damage: S.strikeDamage, inner: 1.5, attacker: null, weapon: 'Lightning', kind: 'shell', vehicleDamage: S.strikeVehicleDamage, fx: false });
    h.vfx.decal(hit.clone().setY(hit.y + 0.05), _up, 2.4, 'scorch', 40);
    h.shakeAt(hit, 0.35, 60);
    h.events.emit('lightning', { pos: hit.clone() });
  }

  // ---- Launch sequence ------------------------------------------------------------------------
  private stepLaunch(dt: number): void {
    const h = this.host;
    const rk = h.rocket;
    if (!rk) return;
    if (this.launchPhase === 'idle') {
      if (this.t < this.launchAt) return;
      this.launchPhase = 'countdown';
      this.launchT = L.countdown;
      this.fuelStart = h.destructibles.items.filter((d) => d.tag === 'rocketFuel').length;
      const doomed = this.fuelDoomed();
      h.events.emit('announce', { text: 'Launch sequence started', sub: doomed ? 'The fuel farm is gone: the rocket will blow on the pad' : `Pad A clears in ${L.countdown} s`, tone: 'warn' });
      h.events.emit('worldEvent', { kind: 'launch', phase: 'countdown', pos: rk.spec.base.clone() });
      return;
    }
    if (this.launchPhase === 'countdown') {
      this.launchT -= dt;
      for (const c of [30, 10]) {
        if (this.launchT <= c && !this.calls.has(c)) {
          this.calls.add(c);
          h.events.emit('announce', { text: `Launch in ${c}`, sub: this.fuelDoomed() ? 'Fuel lines breached: clear the pad' : 'Clear the pad', tone: c === 10 ? 'bad' : 'warn' });
        }
      }
      if (this.launchT > 0) return;
      if (this.fuelDoomed()) this.detonate();
      else {
        rk.ignite();
        this.launchPhase = 'ignition';
        this.launches++;
        h.events.emit('announce', { text: 'Ignition', sub: 'Engines burning on pad A', tone: 'bad' });
        h.events.emit('worldEvent', { kind: 'launch', phase: 'ignition', pos: rk.spec.base.clone() });
      }
      return;
    }
    if (this.launchPhase === 'ignition' || this.launchPhase === 'ascent') {
      rk.update(dt, L.ignitionSeconds, L.accel);
      const ex = rk.exhaust(_v);
      if (rk.phase === 'ignition') {
        // The exhaust blast scours the pad.
        const base = rk.spec.base;
        for (const s of h.soldiers) {
          if (!s.alive || s.inVehicle) continue;
          const d = Math.hypot(s.pos.x - base.x, s.pos.z - base.z);
          if (d > L.blastRadius || s.pos.y > base.y + 12) continue;
          const f = 1 - d / L.blastRadius;
          damageSoldier(h, s, L.blastDps * f * dt, { attacker: null, weapon: 'Launch exhaust', part: null, explosive: true, from: base, armorMul: 1 });
          const nx = (s.pos.x - base.x) / Math.max(0.5, d), nz = (s.pos.z - base.z) / Math.max(0.5, d);
          fling(s, nx * L.blastPush * f * dt, 0, nz * L.blastPush * f * dt);
        }
        for (const v of h.vehicles.list) if (v.alive && Math.hypot(v.pos.x - base.x, v.pos.z - base.z) < L.blastRadius) h.vehicles.damage(v, L.blastDps * 2 * dt, null, h, true);
        h.shakeAt(base, 0.04, 220);
      } else {
        h.shakeAt(ex, 0.02, 300);
      }
      const big = rk.phase === 'ignition';
      // Fire at the bells, smoke rolling out along the pad (ignition) or trailing the climb.
      h.vfx.burst(ex, { count: big ? 3 : 2, color: 0xfff0c0, color2: 0xff7a2a, speed: big ? [6, 14] : [4, 10], dir: _v2.set(0, -1, 0), spread: 0.35, life: [0.25, 0.5], size: [1, 2.2], sizeEnd: 3.5, shape: 'puff', additive: true });
      if (this.rng.next() < (big ? 0.7 : 0.5)) {
        const a = this.rng.next() * Math.PI * 2;
        h.vfx.burst(ex, { count: 1, color: 0xd8d0c8, color2: 0x7a7068, speed: big ? [14, 26] : [2, 5], dir: big ? _v2.set(Math.cos(a), 0.15, Math.sin(a)) : _v2.set(0, -1, 0), spread: 0.25, drag: 1.2, life: big ? [2.5, 4] : [3, 5], size: [2, 3.5], sizeEnd: big ? 8 : 6, shape: 'puff', additive: false });
      }
      if (rk.phase === 'ascent' && this.launchPhase === 'ignition') {
        this.launchPhase = 'ascent';
        h.events.emit('announce', { text: 'Liftoff', sub: 'The launch went ahead', tone: 'info' });
        h.events.emit('worldEvent', { kind: 'launch', phase: 'liftoff', pos: rk.spec.base.clone() });
      }
      if (rk.phase === 'gone') this.launchPhase = 'done';
    }
  }

  /** The farm counts as destroyed once half or more of its tanks are gone. */
  private fuelDoomed(): boolean {
    const total = this.fuelStart || this.host.destructibles.items.filter((d) => d.tag === 'rocketFuel').length;
    if (total === 0) return false;
    return this.host.destructibles.aliveWithTag('rocketFuel') <= total / 2;
  }

  private detonate(): void {
    const h = this.host;
    const rk = h.rocket!;
    const base = rk.spec.base;
    rk.detonate();
    this.launchPhase = 'detonated';
    this.detonations++;
    // A chain of blasts up the body, then the big one at the base.
    for (let i = 0; i < 5; i++) {
      _v.set(base.x + this.rng.range(-3, 3), base.y + 6 + i * rk.spec.height * 0.16, base.z + this.rng.range(-3, 3));
      h.vfx.blastSphere(_v, 0xff7a2a, 8 + i * 2, 0.6);
      h.vfx.flash(_v, 0xffe8b0, 18, 0.3);
    }
    explode(h, base.clone().setY(base.y + 2), { radius: L.detonateRadius, damage: L.detonateDamage, inner: L.detonateRadius * 0.35, attacker: null, weapon: 'Rocket detonation', kind: 'launch', vehicleDamage: L.detonateVehicleDamage });
    h.destructibles.radiusDamage(base, L.detonateRadius, 2000);
    h.vfx.debris(base.clone().setY(base.y + 10), [0xe8e4dc, 0x5a5f6e, 0xc04a3a, 0x2e3038], 40, { size: [0.4, 1.6], speed: [8, 26], up: 14 });
    for (let i = 0; i < 4; i++) {
      const a = this.rng.next() * Math.PI * 2, d = 6 + this.rng.next() * 16;
      h.vfx.decal(_v.set(base.x + Math.cos(a) * d, base.y + 0.06, base.z + Math.sin(a) * d), _up, 6 + this.rng.next() * 6, 'crater', 600);
    }
    h.vfx.decal(_v.set(base.x, base.y + 0.05, base.z), _up, 26, 'scorch', 600);
    h.shakeAt(base, 1, 400);
    this.buildRubble();
    h.events.emit('announce', { text: 'Rocket destroyed', sub: 'The fuel farm was gone; pad A is wrecked', tone: 'bad' });
    h.events.emit('worldEvent', { kind: 'launch', phase: 'detonated', pos: base.clone() });
  }

  /** Wreckage that reshapes the pad: tilted hull sections and slabs with colliders. */
  private buildRubble(): void {
    const h = this.host;
    const base = h.rocket!.spec.base;
    const mb = new ModelBuilder();
    const colliders: RAPIER.Collider[] = [];
    const boxes: DynBox[] = [];
    for (let i = 0; i < L.rubblePieces; i++) {
      const a = (i / L.rubblePieces) * Math.PI * 2 + this.rng.range(-0.3, 0.3);
      const d = 3 + this.rng.next() * 14;
      const x = base.x + Math.cos(a) * d, z = base.z + Math.sin(a) * d;
      const y = h.collision.groundBelow(x, base.y + 30, z, 120) ?? h.groundHeight(x, z);
      const hx = 1.6 + this.rng.next() * 2.4, hy = 0.9 + this.rng.next() * 1.6, hz = 2.2 + this.rng.next() * 3.5;
      const ry = this.rng.next() * Math.PI;
      const col = i % 3 === 0 ? 0xe8e4dc : i % 3 === 1 ? 0x2e3038 : 0x7a7068;
      mb.add(box(hx * 2, hy * 2, hz * 2, col, { x, y: y + hy * 0.8, z, ry, rx: this.rng.range(-0.25, 0.25), rz: this.rng.range(-0.25, 0.25) }));
      const center = new THREE.Vector3(x, y + hy * 0.8, z);
      const half = new THREE.Vector3(hx, hy, hz);
      colliders.push(h.physics.addStaticBox(center, half, ry));
      boxes.push(h.collision.addBox(center, half, ry, 'metal', 'prop', null, { opaque: true }));
    }
    // Two fallen hull sections lying across the pad.
    const rad = h.rocket!.spec.radius;
    for (const [len, a, d] of [[16, this.rng.next() * Math.PI * 2, 9], [11, this.rng.next() * Math.PI * 2, 15]] as const) {
      const x = base.x + Math.cos(a) * d, z = base.z + Math.sin(a) * d;
      const y = (h.collision.groundBelow(x, base.y + 30, z, 120) ?? h.groundHeight(x, z)) + rad * 0.85;
      const ry = this.rng.next() * Math.PI;
      mb.add(cyl(rad, rad, len, 10, 0xe8e4dc, { x, y, z, ry, rz: Math.PI / 2 }));
      mb.add(cyl(rad * 1.02, rad * 1.02, 1.2, 10, 0xc04a3a, { x, y, z, ry, rz: Math.PI / 2 }));
      const center = new THREE.Vector3(x, y, z);
      const half = new THREE.Vector3(len / 2, rad * 0.85, rad * 0.85);
      colliders.push(h.physics.addStaticBox(center, half, ry));
      boxes.push(h.collision.addBox(center, half, ry, 'metal', 'prop', null, { opaque: true }));
    }
    const mesh = mb.build();
    h.scene.add(mesh);
    this.rubble = { mesh, colliders, boxes };
  }

  // ---- Hazards and HUD ------------------------------------------------------------------------
  private updateHazards(): void {
    this.hazards.length = 0;
    if (this.stormPhase === 'warn' || this.stormPhase === 'active') {
      this.hazards.push({ x: this.stormPos.x, z: this.stormPos.z, r: S.pullRadius, label: 'Ion storm', dir: yawOf(this.stormDir.x, this.stormDir.z), reach: S.speed * 24, danger: this.stormPhase === 'active' });
    }
    const rk = this.host.rocket;
    if (rk && (this.launchPhase === 'countdown' || this.launchPhase === 'ignition')) {
      const doomed = this.launchPhase === 'countdown' && this.fuelDoomed();
      this.hazards.push({ x: rk.spec.base.x, z: rk.spec.base.z, r: doomed ? L.detonateRadius : L.blastRadius, label: doomed ? 'Rocket detonation' : 'Launch blast', danger: this.launchPhase === 'ignition' || this.launchT < L.botAvoidBefore });
    }
  }

  /** The event countdown the HUD shows (storm arrival, launch). */
  timer(): EventTimer | null {
    if (this.launchPhase === 'countdown') return { label: this.fuelDoomed() ? 'Detonation' : 'Launch', seconds: Math.max(0, this.launchT), tone: this.launchT < 10 ? 'bad' : 'warn' };
    if (this.stormPhase === 'warn') return { label: 'Ion storm', seconds: Math.max(0, S.warnSeconds - this.stormT), tone: 'warn' };
    return null;
  }

  /** Squad threat added to an objective near an active hazard. */
  zoneThreat(x: number, z: number): number {
    let t = 0;
    for (const hz of this.hazards) {
      if (!hz.danger && hz.label !== 'Rocket detonation') continue;
      if (Math.hypot(hz.x - x, hz.z - z) < hz.r + 40) t += hz.label === 'Ion storm' ? S.zoneThreat : L.zoneThreat;
    }
    return t;
  }

  // ---- Per frame (visuals and atmosphere at the camera) ----------------------------------------
  render(frameDt: number, alpha: number, cam: THREE.Vector3): void {
    _v.copy(this.stormPrev).lerp(this.stormPos, alpha);
    this.visual.update(frameDt, _v, this.stormIntensity);
    const k = this.stormIntensity;
    const d = Math.hypot(cam.x - _v.x, cam.z - _v.z);
    // Sky darkening: some everywhere while the storm is out, heavy close to it.
    this.storm = k > 0 ? k * clamp(0.3 + 0.7 * (1 - smoothstep(S.visRadius * 0.4, S.visRadius * 2, d)), 0, 1) : 0;
    this.fogMix = k * (1 - smoothstep(S.coreRadius, S.visRadius, d));
    // Rain band runs ahead of the storm; a drizzle elsewhere while it is out.
    const ax = _v.x + this.stormDir.x * S.rainAhead, az = _v.z + this.stormDir.z * S.rainAhead;
    const band = 1 - smoothstep(S.rainRadius * 0.35, S.rainRadius, Math.hypot(cam.x - ax, cam.z - az));
    this.rain = k > 0 ? Math.max(WX.drizzle * k, band * k) : 0;
    this.dust = clamp(0.25 + this.wind.length() / 18 + k * (1 - smoothstep(30, S.visRadius, d)) * 0.8, 0, 1);
  }

  dispose(): void {
    this.visual.dispose();
    this.rubble?.mesh.removeFromParent();
  }
}
