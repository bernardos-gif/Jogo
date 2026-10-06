// Gadget system: activation for every soldier (player and bots share the same input path) and
// the deployables it creates. Grapnel (grapple line), Bulwark (hex-cell wall that stops bullets
// both ways), Watchdog (auto sentry), Arc Tool (repair / EMP beam), Mender (healing and reviving
// darts, self-heal on hold), Supply Cache (ammo, throwables, armor plates), Kestrel (pilotable
// scout drone; bots fly it on autopilot), Echo (thrown motion sensor). Also the passives that
// need per-tick work (Plated armor rebuild, Stockpile regen boost) and EMP disruption.
import * as THREE from 'three';
import { TUNING } from '../config/tuning';
import { InstancedModel } from '../render/instanced';
import { ShieldMaterial } from '../render/shieldMaterial';
import { FACTION_PALETTES } from '../art/palette';
import { sentryBase, sentryHead, shieldEmitter, supplyCache, motionSensor, scoutDrone, menderDart } from '../art/gadgetModels';
import { healPulse, empBurst, muzzleFlash, impact } from '../render/recipes';
import { viewDir, yawOf, wrapAngle, clamp } from '../core/math';
import { chestPoint } from '../weapons/hitboxes';
import { weaponStats, type WeaponStats } from '../weapons/stats';
import { defaultAttachments } from '../art/weaponModels';
import { coneDir } from '../weapons/ballistics';
import { revive, type CombatContext } from '../weapons/damage';
import { makeHit, type DynBox } from '../physics/collision';
import { G as GROUPS } from '../physics/physics';
import { hasPassive, newGadgetState, gadgetOf } from './state';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Soldier } from '../player/soldier';
import type { TeamId } from '../config/content';

const GT = TUNING.gadgets;
const DEG = Math.PI / 180;

export interface GadgetContext extends CombatContext {
  scene: THREE.Scene;
  groundHeight(x: number, z: number): number;
  /** Marks an enemy as spotted for the spotter's team (scoring and pings). */
  spot(by: Soldier, target: Soldier, quiet?: boolean): void;
  /** Vehicle hooks (repair or overload) for the Arc Tool; false when no vehicle was there. */
  arcVehicle?(by: Soldier, ref: unknown, dt: number): boolean;
  muzzle(s: Soldier, out: THREE.Vector3): THREE.Vector3;
}

interface Sentry {
  kind: 'sentry';
  owner: Soldier;
  team: TeamId;
  pos: THREE.Vector3;
  baseYaw: number;
  yaw: number;
  pitch: number;
  hp: number;
  life: number;
  target: Soldier | null;
  seekT: number;
  reactT: number;
  burstLeft: number;
  shotT: number;
  pauseT: number;
  disabledT: number;
  box: DynBox;
}

interface Wall {
  kind: 'shield';
  owner: Soldier;
  team: TeamId;
  pos: THREE.Vector3;
  yaw: number;
  hp: number;
  life: number;
  box: DynBox;
  collider: RAPIER.Collider;
  mesh: THREE.Mesh;
  disabledT: number;
}

interface Cache {
  kind: 'cache';
  owner: Soldier;
  team: TeamId;
  pos: THREE.Vector3;
  yaw: number;
  hp: number;
  life: number;
  timers: Map<number, { mag: number; thr: number }>;
  box: DynBox;
  disabledT: number;
  scoreT: number;
}

interface Sensor {
  kind: 'sensor';
  owner: Soldier;
  team: TeamId;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  landed: boolean;
  life: number;
  pulseT: number;
  hp: number;
  disabledT: number;
}

export interface Drone {
  kind: 'drone';
  owner: Soldier;
  team: TeamId;
  pos: THREE.Vector3;
  prev: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  pitch: number;
  hp: number;
  battery: number;
  piloted: boolean;
  /** Pilot command captured before the soldier's own movement is frozen. */
  cmd: { moveX: number; moveZ: number; up: number; yaw: number; pitch: number };
  /** Autopilot orbit center (bot drones). */
  orbit: THREE.Vector3;
  orbitT: number;
  spotT: number;
  box: DynBox;
  disabledT: number;
}

interface Dart {
  owner: Soldier;
  pos: THREE.Vector3;
  prev: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
}

export type Deployable = Sentry | Wall | Cache | Sensor | Drone;

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _one = new THREE.Vector3(1, 1, 1);
const _hit = makeHit();

export class GadgetSystem {
  readonly sentries: Sentry[] = [];
  readonly walls: Wall[] = [];
  readonly caches: Cache[] = [];
  readonly sensors: Sensor[] = [];
  readonly drones: Drone[] = [];
  readonly darts: Dart[] = [];
  /** Uses this round (automated test stats). */
  uses = 0;
  private vis: {
    sentryBase: InstancedModel[];
    sentryHead: InstancedModel[];
    emitter: InstancedModel[];
    cache: InstancedModel[];
    sensor: InstancedModel[];
    drone: InstancedModel[];
    dart: InstancedModel;
  };
  private shieldMats: ShieldMaterial[];
  private sentryStats: WeaponStats;
  private beams: { from: THREE.Vector3; to: THREE.Vector3; t: number }[] = [];
  private beamT = 0;
  private time = 0;
  private passiveT = 0;

  constructor(private scene: THREE.Scene) {
    const teams: TeamId[] = [0, 1];
    this.vis = {
      sentryBase: teams.map((t) => new InstancedModel(scene, sentryBase(t), 24)),
      sentryHead: teams.map((t) => new InstancedModel(scene, sentryHead(t), 24)),
      emitter: teams.map((t) => new InstancedModel(scene, shieldEmitter(t, GT.shield.width), 16)),
      cache: teams.map((t) => new InstancedModel(scene, supplyCache(t), 16)),
      sensor: teams.map((t) => new InstancedModel(scene, motionSensor(t), 24)),
      drone: teams.map((t) => new InstancedModel(scene, scoutDrone(t), 16)),
      dart: new InstancedModel(scene, menderDart(), 32, { shadow: false }),
    };
    this.shieldMats = teams.map((t) => {
      const c = FACTION_PALETTES[t].glow;
      const m = new ShieldMaterial(c, new THREE.Color(c).lerp(new THREE.Color(0xffffff), 0.5).getHex(), 0.3, GT.shield.height);
      m.intensity = GT.shield.intensity;
      return m;
    });
    // Sentry rounds: a light energy rifle profile.
    const base = weaponStats('lumen', defaultAttachments('lumen'));
    this.sentryStats = { ...base, damage: GT.sentry.damage, range: [12, GT.sentry.range], headMul: 1.3, limbMul: 0.9, velocity: GT.sentry.velocity, penetration: 0 };
  }

  /** Gives a soldier the gadget of their specialist (spawn, loadout change). */
  equip(s: Soldier): void {
    s.gadget = newGadgetState(gadgetOf(s.specialist));
    if (hasPassive(s, 'Plated')) {
      s.maxArmor = GT.passives.platedArmor;
      s.armor = s.maxArmor;
    }
  }

  // ---- Per soldier ---------------------------------------------------------------------------
  /** Cooldowns, recharge and activation from the soldier's command. */
  stepSoldier(s: Soldier, dt: number, ctx: GadgetContext): void {
    const g = s.gadget;
    if (!g) return;
    g.cooldown = Math.max(0, g.cooldown - dt);
    g.disabledT = Math.max(0, g.disabledT - dt);
    if (g.id === 'mender' && g.charges < g.maxCharges) {
      g.rechargeT += dt;
      if (g.rechargeT >= GT.mender.recharge) {
        g.rechargeT = 0;
        g.charges++;
      }
    }
    if (g.id === 'arctool' && !(s.input.gadgetHeld && s.active)) {
      g.heat = Math.max(0, g.heat - GT.arctool.coolPerSecond * dt);
      if (g.heat <= 0) g.overheated = false;
    }
    const inp = s.input;
    const blocked = !s.active || s.inVehicle || s.empT > 0 || g.disabledT > 0 || s.state === 'ladder' || s.state === 'zipline';
    // The drone toggles with the gadget key even while piloting.
    if (g.id === 'drone') {
      if (inp.gadget && !blocked) this.toggleDrone(s, g, ctx);
      return;
    }
    if (blocked) {
      g.holdT = 0;
      return;
    }
    switch (g.id) {
      case 'grapple':
        if (inp.gadget && g.cooldown <= 0) this.grapple(s, g, ctx);
        break;
      case 'shield':
        if (inp.gadget && g.cooldown <= 0 && g.deployed === 0) this.deployWall(s, g, ctx);
        break;
      case 'sentry':
        if (inp.gadget && g.cooldown <= 0 && g.deployed === 0) this.deploySentry(s, g, ctx);
        break;
      case 'cache':
        if (inp.gadget && g.cooldown <= 0 && g.deployed === 0) this.deployCache(s, g, ctx);
        break;
      case 'sensor':
        if (inp.gadget && g.cooldown <= 0) this.throwSensor(s, g);
        break;
      case 'arctool':
        if (inp.gadgetHeld && !g.overheated) this.arcBeam(s, g, dt, ctx);
        break;
      case 'mender': {
        // Hold to self-heal; release (without a self-heal) to fire a dart.
        if (inp.gadgetHeld && g.charges > 0) {
          g.holdT += dt;
          if (!g.holdUsed && g.holdT >= GT.mender.selfHold && s.health < TUNING.health.max) {
            g.holdUsed = true;
            g.charges--;
            s.health = Math.min(TUNING.health.max, s.health + GT.mender.selfHeal);
            healPulse(ctx.vfx, s.pos);
            this.uses++;
          }
        } else if (g.holdT > 0) {
          if (!g.holdUsed && g.charges > 0 && g.cooldown <= 0) this.fireDart(s, g, ctx);
          g.holdT = 0;
          g.holdUsed = false;
        }
        break;
      }
    }
  }

  private aim(s: Soldier, out: THREE.Vector3): THREE.Vector3 {
    return viewDir(s.yaw, s.pitch, out);
  }

  private grapple(s: Soldier, g: ReturnType<typeof newGadgetState>, ctx: GadgetContext): void {
    const dir = this.aim(s, _dir);
    const h = ctx.collision.raycast(s.eyePos, dir, GT.grapple.range, { worldOnly: true, ignore: s }, _hit);
    if (!h) return;
    s.grapplePoint.copy(h.point).addScaledVector(dir, -0.4);
    s.state = 'grapple';
    s.vel.set(0, 0, 0);
    g.cooldown = GT.grapple.cooldown;
    g.cooldownMax = GT.grapple.cooldown;
    this.uses++;
  }

  /** Ground point in front of a soldier (or under the aim within reach). */
  private placePoint(s: Soldier, reach: number, ctx: GadgetContext, out: THREE.Vector3): THREE.Vector3 {
    const dir = this.aim(s, _dir);
    const h = ctx.collision.raycast(s.eyePos, dir, reach, { worldOnly: true, ignore: s }, _hit);
    if (h && h.normal.y > 0.7) return out.copy(h.point);
    out.set(s.pos.x - Math.sin(s.yaw) * 1.6, s.pos.y + 1, s.pos.z - Math.cos(s.yaw) * 1.6);
    const g = ctx.collision.groundBelow(out.x, out.y, out.z, 4);
    out.y = g ?? Math.max(s.pos.y, ctx.groundHeight(out.x, out.z));
    return out;
  }

  private deployWall(s: Soldier, g: ReturnType<typeof newGadgetState>, ctx: GadgetContext): void {
    const W = GT.shield;
    const p = new THREE.Vector3(s.pos.x - Math.sin(s.yaw) * W.distance, s.pos.y, s.pos.z - Math.cos(s.yaw) * W.distance);
    p.y = ctx.collision.groundBelow(p.x, p.y + 1, p.z, 3) ?? s.pos.y;
    const center = p.clone().setY(p.y + W.height / 2);
    const half = new THREE.Vector3(W.width / 2, W.height / 2, 0.06);
    const wall: Wall = {
      kind: 'shield',
      owner: s,
      team: s.team,
      pos: p,
      yaw: s.yaw,
      hp: W.hp,
      life: W.life,
      box: null as unknown as DynBox,
      collider: ctx.physics.addStaticBox(center, half, s.yaw, GROUPS.SHIELD),
      mesh: new THREE.Mesh(new THREE.PlaneGeometry(W.width, W.height, 1, 1), this.shieldMats[s.team]),
      disabledT: 0,
    };
    wall.box = ctx.collision.addBox(center, half, s.yaw, 'glass', 'shield', wall, { opaque: false, team: s.team });
    wall.mesh.position.copy(center);
    wall.mesh.rotation.y = s.yaw;
    wall.mesh.frustumCulled = false;
    this.scene.add(wall.mesh);
    this.walls.push(wall);
    g.deployed++;
    this.uses++;
  }

  private deploySentry(s: Soldier, g: ReturnType<typeof newGadgetState>, ctx: GadgetContext): void {
    const p = this.placePoint(s, GT.sentry.placeRange, ctx, new THREE.Vector3());
    const t: Sentry = {
      kind: 'sentry',
      owner: s,
      team: s.team,
      pos: p,
      baseYaw: s.yaw,
      yaw: s.yaw,
      pitch: 0,
      hp: GT.sentry.hp,
      life: GT.sentry.life,
      target: null,
      seekT: 0,
      reactT: 0,
      burstLeft: 0,
      shotT: 0,
      pauseT: 0,
      disabledT: 0,
      box: null as unknown as DynBox,
    };
    t.box = ctx.collision.addBox(p.clone().setY(p.y + 0.45), new THREE.Vector3(0.32, 0.45, 0.32), 0, 'metal', 'gadget', t);
    this.sentries.push(t);
    g.deployed++;
    this.uses++;
  }

  private deployCache(s: Soldier, g: ReturnType<typeof newGadgetState>, ctx: GadgetContext): void {
    const p = this.placePoint(s, 4, ctx, new THREE.Vector3());
    const c: Cache = { kind: 'cache', owner: s, team: s.team, pos: p, yaw: s.yaw, hp: 220, life: GT.cache.life, timers: new Map(), box: null as unknown as DynBox, disabledT: 0, scoreT: 0 };
    c.box = ctx.collision.addBox(p.clone().setY(p.y + 0.27), new THREE.Vector3(0.48, 0.27, 0.31), s.yaw, 'metal', 'gadget', c);
    this.caches.push(c);
    g.deployed++;
    this.uses++;
  }

  private throwSensor(s: Soldier, g: ReturnType<typeof newGadgetState>): void {
    const dir = viewDir(s.yaw, s.pitch + 0.15, _dir);
    const sn: Sensor = { kind: 'sensor', owner: s, team: s.team, pos: s.eyePos.clone().addScaledVector(dir, 0.5), vel: dir.clone().multiplyScalar(GT.sensor.throwSpeed).add(_v.set(0, 3, 0)), landed: false, life: GT.sensor.life, pulseT: 0, hp: 30, disabledT: 0 };
    this.sensors.push(sn);
    g.cooldown = GT.sensor.cooldown;
    g.cooldownMax = GT.sensor.cooldown;
    this.uses++;
  }

  private fireDart(s: Soldier, g: ReturnType<typeof newGadgetState>, ctx: GadgetContext): void {
    const dir = this.aim(s, _dir);
    const from = ctx.muzzle(s, _v);
    this.darts.push({ owner: s, pos: from.clone(), prev: from.clone(), vel: dir.clone().multiplyScalar(GT.mender.velocity), life: 2 });
    g.charges--;
    g.cooldown = GT.mender.fireCooldown;
    g.cooldownMax = GT.mender.fireCooldown;
    this.uses++;
  }

  private arcBeam(s: Soldier, g: ReturnType<typeof newGadgetState>, dt: number, ctx: GadgetContext): void {
    const A = GT.arctool;
    g.heat = Math.min(1, g.heat + A.heatPerSecond * dt);
    if (g.heat >= 1) {
      g.overheated = true;
      return;
    }
    const dir = this.aim(s, _dir);
    const h = ctx.collision.raycast(s.eyePos, dir, A.range, { ignore: s }, _hit);
    const end = h ? h.point : _v.copy(s.eyePos).addScaledVector(dir, A.range);
    if (this.beams.length < 8) this.beams.push({ from: s.eyePos.clone().add(_v2.set(0, -0.2, 0)), to: end.clone(), t: 0 });
    if (!h) return;
    const ref = h.ref as Deployable | null;
    if (ref && typeof ref === 'object' && 'kind' in ref && ref.team !== s.team) {
      this.damageDeployable(ref, A.gadgetDamagePerSecond * dt, s, ctx, h.point);
      ref.disabledT = Math.max(ref.disabledT, A.disable);
    } else if (h.ref) ctx.arcVehicle?.(s, h.ref, dt);
  }

  private toggleDrone(s: Soldier, g: ReturnType<typeof newGadgetState>, ctx: GadgetContext): void {
    const mine = this.drones.find((d) => d.owner === s);
    if (mine) {
      this.removeDrone(mine, ctx, false);
      return;
    }
    if (g.cooldown > 0) return;
    const p = s.eyePos.clone().add(_v.set(0, 1.5, 0));
    const d: Drone = { kind: 'drone', owner: s, team: s.team, pos: p, prev: p.clone(), vel: new THREE.Vector3(), yaw: s.yaw, pitch: -0.2, hp: GT.drone.hp, battery: GT.drone.battery, piloted: this.pilotable(s), cmd: { moveX: 0, moveZ: 0, up: 0, yaw: s.yaw, pitch: -0.2 }, orbit: s.pos.clone(), orbitT: 0, spotT: 0, box: null as unknown as DynBox, disabledT: 0 };
    d.box = ctx.collision.addBox(p, new THREE.Vector3(0.3, 0.12, 0.3), 0, 'metal', 'gadget', d);
    this.drones.push(d);
    g.deployed++;
    s.piloting = d.piloted;
    this.uses++;
  }

  /** The player flies the drone; bots let it orbit on autopilot. */
  pilotable(s: Soldier): boolean {
    return s.isPlayer && !this.botPilot.has(s.id);
  }

  /** Soldiers whose drone runs on autopilot even if they are the player (autoplay). */
  readonly botPilot = new Set<number>();

  droneOf(s: Soldier): Drone | null {
    return this.drones.find((d) => d.owner === s) ?? null;
  }

  // ---- World step ----------------------------------------------------------------------------
  step(dt: number, ctx: GadgetContext): void {
    this.time += dt;
    for (let i = this.sentries.length - 1; i >= 0; i--) this.stepSentry(this.sentries[i], dt, ctx);
    for (let i = this.walls.length - 1; i >= 0; i--) {
      const w = this.walls[i];
      w.life -= dt;
      w.disabledT = Math.max(0, w.disabledT - dt);
      if (w.life <= 0 || w.hp <= 0 || w.disabledT > 0) this.removeWall(w, ctx, w.hp <= 0 || w.disabledT > 0);
    }
    for (let i = this.caches.length - 1; i >= 0; i--) this.stepCache(this.caches[i], dt, ctx);
    for (let i = this.sensors.length - 1; i >= 0; i--) this.stepSensor(this.sensors[i], dt, ctx);
    for (let i = this.drones.length - 1; i >= 0; i--) this.stepDrone(this.drones[i], dt, ctx);
    for (let i = this.darts.length - 1; i >= 0; i--) this.stepDart(i, dt, ctx);
    // Passives that tick.
    const P = GT.passives;
    this.passiveT += dt;
    const tick = this.passiveT >= 1;
    if (tick) this.passiveT = 0;
    for (const s of ctx.soldiers) {
      if (!s.alive || s.downed) continue;
      if (hasPassive(s, 'Plated') && s.armor < s.maxArmor && ctx.time - s.lastDamageT > P.platedRegenDelay) s.armor = Math.min(s.maxArmor, s.armor + P.platedRegenRate * dt);
      if (tick && hasPassive(s, 'Stockpile'))
        for (const m of ctx.soldiers) if (m !== s && m.team === s.team && m.alive && m.squadId === s.squadId && m.pos.distanceToSquared(s.pos) < P.stockpileRadius * P.stockpileRadius) m.regenBoostT = Math.max(m.regenBoostT, P.stockpileBoost);
    }
  }

  private stepSentry(t: Sentry, dt: number, ctx: GadgetContext): void {
    const S = GT.sentry;
    t.life -= dt;
    t.disabledT = Math.max(0, t.disabledT - dt);
    if (t.life <= 0 || t.hp <= 0) {
      this.removeSentry(t, ctx, t.hp <= 0);
      return;
    }
    if (t.disabledT > 0) {
      t.pitch = Math.max(-0.5, t.pitch - dt);
      return;
    }
    const head = _v.copy(t.pos).setY(t.pos.y + 0.75);
    t.seekT -= dt;
    if (t.seekT <= 0) {
      t.seekT = 0.25;
      let best: Soldier | null = null;
      let bd = S.range;
      for (const e of ctx.soldiers) {
        if (e.team === t.team || !e.alive || e.downed || e.inVehicle) continue;
        const d = e.pos.distanceTo(t.pos);
        if (d > bd) continue;
        if (Math.abs(wrapAngle(yawOf(e.pos.x - t.pos.x, e.pos.z - t.pos.z) - t.baseYaw)) > S.arc / 2) continue;
        chestPoint(e, _v2);
        _dir.subVectors(_v2, head);
        const len = _dir.length();
        _dir.multiplyScalar(1 / len);
        if (ctx.collision.raycast(head, _dir, len - 0.4, { worldOnly: true, sight: true }, _hit)) continue;
        bd = d;
        best = e;
      }
      if (best !== t.target) {
        t.target = best;
        t.reactT = S.reaction;
      }
    }
    const tg = t.target;
    if (!tg || !tg.alive) {
      // Idle sweep across the arc.
      t.yaw = t.baseYaw + Math.sin(this.time * 0.6 + t.pos.x) * (S.arc / 2) * 0.8;
      t.pitch *= 0.95;
      return;
    }
    chestPoint(tg, _v2);
    const goalYaw = yawOf(_v2.x - head.x, _v2.z - head.z);
    const goalPitch = Math.atan2(_v2.y - head.y, Math.hypot(_v2.x - head.x, _v2.z - head.z));
    const dy = wrapAngle(goalYaw - t.yaw);
    const step = S.turnSpeed * dt;
    t.yaw += clamp(dy, -step, step);
    t.pitch += clamp(goalPitch - t.pitch, -step, step);
    t.reactT -= dt;
    t.pauseT -= dt;
    if (t.reactT > 0 || Math.abs(dy) > 4 * DEG) return;
    if (t.burstLeft <= 0) {
      if (t.pauseT > 0) return;
      t.burstLeft = S.burst;
    }
    t.shotT -= dt;
    if (t.shotT > 0) return;
    t.shotT = 60 / S.rpm;
    t.burstLeft--;
    if (t.burstLeft <= 0) t.pauseT = S.burstPause;
    const dir = viewDir(t.yaw, t.pitch, _dir);
    const muzzle = _v2.copy(head).addScaledVector(dir, 0.7);
    coneDir(dir, S.spread, ctx.rng.next(), ctx.rng.next(), _v);
    ctx.projectiles.spawn('bullet', muzzle, _v, S.velocity, t.owner.alive ? t.owner : t.owner, this.sentryStats, { weaponName: 'Watchdog', energy: this.sentryStats.energy, tracer: true, ignore: t });
    muzzleFlash(ctx.vfx, muzzle, dir, this.sentryStats.energy, 0.8, false);
  }

  private stepCache(c: Cache, dt: number, ctx: GadgetContext): void {
    const C = GT.cache;
    c.life -= dt;
    c.disabledT = Math.max(0, c.disabledT - dt);
    if (c.life <= 0 || c.hp <= 0) {
      this.removeCache(c, ctx, c.hp <= 0);
      return;
    }
    if (c.disabledT > 0) return;
    c.scoreT -= dt;
    for (const s of ctx.soldiers) {
      if (s.team !== c.team || !s.active || s.pos.distanceToSquared(c.pos) > C.radius * C.radius) continue;
      let t = c.timers.get(s.id);
      if (!t) c.timers.set(s.id, (t = { mag: 0, thr: 0 }));
      t.mag += dt;
      t.thr += dt;
      let gave = false;
      if (t.mag >= C.magEvery) {
        t.mag = 0;
        for (const w of s.arsenal.slots) {
          if (w.usesHeat) continue;
          const full = w.stats.reserve;
          if (w.reserve < full) {
            w.reserve = Math.min(full, w.reserve + (w.stats.category === 'launcher' ? 1 : w.stats.mag));
            gave = true;
          }
        }
      }
      if (t.thr >= C.throwableEvery) {
        t.thr = 0;
        const cap = TUNING.throwables[s.arsenal.throwable].count;
        if (s.arsenal.throwables < cap) {
          s.arsenal.throwables++;
          gave = true;
        }
      }
      if (s.maxArmor < C.plate) s.maxArmor = C.plate;
      if (s.armor < s.maxArmor) s.armor = Math.min(s.maxArmor, s.armor + C.armorPerSecond * dt);
      if (gave && s !== c.owner && c.scoreT <= 0 && c.owner.team === s.team) {
        c.scoreT = 3;
        c.owner.stats.score += TUNING.sector.score.resupply;
        ctx.events.emit('score', { soldier: c.owner, amount: TUNING.sector.score.resupply, reason: 'Resupply' });
      }
    }
  }

  private stepSensor(sn: Sensor, dt: number, ctx: GadgetContext): void {
    const S = GT.sensor;
    if (!sn.landed) {
      sn.vel.y -= TUNING.weapons.gravity * dt;
      _dir.copy(sn.vel).multiplyScalar(dt);
      const len = _dir.length();
      _dir.multiplyScalar(1 / Math.max(1e-6, len));
      const h = ctx.collision.raycast(sn.pos, _dir, len, { worldOnly: true }, _hit);
      if (h) {
        sn.pos.copy(h.point).addScaledVector(h.normal, 0.05);
        sn.landed = true;
      } else sn.pos.addScaledVector(sn.vel, dt);
      if (sn.pos.y < ctx.groundHeight(sn.pos.x, sn.pos.z)) {
        sn.pos.y = ctx.groundHeight(sn.pos.x, sn.pos.z);
        sn.landed = true;
      }
      return;
    }
    sn.life -= dt;
    sn.disabledT = Math.max(0, sn.disabledT - dt);
    if (sn.life <= 0 || sn.hp <= 0) {
      this.sensors.splice(this.sensors.indexOf(sn), 1);
      return;
    }
    if (sn.disabledT > 0) return;
    sn.pulseT -= dt;
    if (sn.pulseT > 0) return;
    sn.pulseT = S.pulse;
    ctx.vfx.shockwave(sn.pos.clone().setY(sn.pos.y + 0.1), FACTION_PALETTES[sn.team].glow, S.radius * 0.35, 0.6, { opacity: 0.35 });
    for (const e of ctx.soldiers) {
      if (e.team === sn.team || !e.alive || e.pos.distanceToSquared(sn.pos) > S.radius * S.radius) continue;
      if (Math.hypot(e.vel.x, e.vel.z) < S.moveSpeed) continue;
      ctx.spot(sn.owner, e, true);
    }
  }

  private stepDrone(d: Drone, dt: number, ctx: GadgetContext): void {
    const D = GT.drone;
    d.prev.copy(d.pos);
    d.battery -= dt;
    d.disabledT = Math.max(0, d.disabledT - dt);
    if (d.battery <= 0 || d.hp <= 0 || !d.owner.alive || d.owner.downed || d.disabledT > 0) {
      this.removeDrone(d, ctx, d.hp <= 0 || d.disabledT > 0);
      return;
    }
    if (d.piloted) {
      // The pilot's command drives the drone (the soldier itself stands still).
      const c = d.cmd;
      d.yaw = c.yaw;
      d.pitch = clamp(c.pitch, -1.4, 0.6);
      const fx = -Math.sin(d.yaw), fz = -Math.cos(d.yaw);
      const rx = Math.cos(d.yaw), rz = -Math.sin(d.yaw);
      _v.set(fx * c.moveZ + rx * c.moveX, 0, fz * c.moveZ + rz * c.moveX).multiplyScalar(D.speed);
      _v.y = c.up * D.climb;
      d.vel.lerp(_v, Math.min(1, dt * 4));
    } else {
      // Autopilot: orbit above the owner's objective area.
      d.orbitT += dt * 0.25;
      const o = d.orbit;
      const r = D.botRadius * 0.5;
      _v.set(o.x + Math.cos(d.orbitT) * r, Math.max(ctx.groundHeight(o.x, o.z), o.y) + 30, o.z + Math.sin(d.orbitT) * r);
      _v.sub(d.pos).multiplyScalar(0.6);
      if (_v.length() > D.speed) _v.setLength(D.speed);
      d.vel.lerp(_v, Math.min(1, dt * 2));
      d.yaw = yawOf(o.x - d.pos.x, o.z - d.pos.z);
      d.pitch = -0.6;
    }
    d.pos.addScaledVector(d.vel, dt);
    const ground = ctx.groundHeight(d.pos.x, d.pos.z) + 1.2;
    d.pos.y = clamp(d.pos.y, ground, ground + D.maxAltitude);
    ctx.collision.updateBox(d.box, d.pos, d.yaw);
    // Spotting: enemies inside the camera cone with a clear line.
    d.spotT -= dt;
    if (d.spotT > 0) return;
    d.spotT = 0.5;
    const look = viewDir(d.yaw, d.pitch, _dir);
    for (const e of ctx.soldiers) {
      if (e.team === d.team || !e.alive) continue;
      _v2.subVectors(e.pos, d.pos);
      const dist = _v2.length();
      if (dist > (d.piloted ? D.spotRange : D.botRadius * 1.6)) continue;
      _v2.multiplyScalar(1 / dist);
      if (d.piloted && _v2.dot(look) < Math.cos(D.spotCone)) continue;
      if (ctx.collision.raycast(d.pos, _v2, dist - 1, { worldOnly: true, sight: true }, _hit)) continue;
      ctx.spot(d.owner, e, !d.piloted);
    }
  }

  private stepDart(i: number, dt: number, ctx: GadgetContext): void {
    const M = GT.mender;
    const dr = this.darts[i];
    dr.life -= dt;
    dr.prev.copy(dr.pos);
    dr.vel.y -= TUNING.weapons.gravity * 0.3 * dt;
    _dir.copy(dr.vel).multiplyScalar(dt);
    const len = _dir.length();
    _dir.multiplyScalar(1 / Math.max(1e-6, len));
    const h = ctx.collision.raycast(dr.pos, _dir, len, { ignore: dr.owner }, _hit);
    if (!h) {
      dr.pos.addScaledVector(dr.vel, dt);
      if (dr.life <= 0) this.darts.splice(i, 1);
      return;
    }
    this.darts.splice(i, 1);
    const owner = dr.owner;
    if (h.kind === 'soldier') {
      const t = h.ref as Soldier;
      if (t.team === owner.team) {
        if (t.downed) revive(ctx, t, owner);
        else this.heal(t, M.heal, owner, ctx);
        healPulse(ctx.vfx, t.pos);
        return;
      }
    }
    // Ground splash heals allies close by.
    healPulse(ctx.vfx, h.point);
    for (const s of ctx.soldiers) if (s.team === owner.team && s.active && s.pos.distanceTo(h.point) < M.splashRadius) this.heal(s, M.splashHeal, owner, ctx);
  }

  private heal(t: Soldier, amount: number, by: Soldier, ctx: GadgetContext): void {
    const before = t.health;
    t.health = Math.min(TUNING.health.max, t.health + amount);
    t.regenBoostT = Math.max(t.regenBoostT, 2);
    const healed = t.health - before;
    if (healed > 1 && t !== by) {
      const sc = Math.round(healed * TUNING.sector.score.healPerPoint);
      by.stats.score += sc;
      ctx.events.emit('score', { soldier: by, amount: sc, reason: 'Heal' });
    }
  }

  // ---- Damage, EMP, removal ------------------------------------------------------------------
  /** Bullet or explosion damage to a deployable; true when the round was absorbed. */
  damageRef(ref: unknown, amount: number, attacker: Soldier | null, ctx: GadgetContext, at: THREE.Vector3): boolean {
    if (!ref || typeof ref !== 'object' || !('kind' in ref)) return false;
    const d = ref as Deployable;
    if (!['sentry', 'shield', 'cache', 'sensor', 'drone'].includes(d.kind)) return false;
    this.damageDeployable(d, amount, attacker, ctx, at);
    return true;
  }

  private damageDeployable(d: Deployable, amount: number, attacker: Soldier | null, ctx: GadgetContext, at: THREE.Vector3): void {
    if (attacker && attacker.team === d.team && d.kind !== 'shield') return;
    d.hp -= amount;
    if (d.kind === 'shield') this.shieldMats[d.team].ripple(at);
    else impact(ctx.vfx, at, _v.set(0, 1, 0), 'metal', 'kinetic', false);
  }

  /** Explosion damage to deployables in a radius (linear falloff). */
  radiusDamage(pos: THREE.Vector3, radius: number, damage: number, attacker: Soldier | null, ctx: GadgetContext): void {
    for (const list of [this.sentries, this.walls, this.caches, this.sensors, this.drones] as Deployable[][])
      for (const d of [...list]) {
        const dist = d.pos.distanceTo(pos);
        if (dist < radius) this.damageDeployable(d, damage * (1 - dist / radius), attacker, ctx, d.pos);
      }
  }

  /** EMP blast: disables deployables and gadgets in the radius. */
  emp(pos: THREE.Vector3, radius: number, ctx: GadgetContext, byTeam: number): void {
    const r2 = radius * radius;
    const hit = (d: Deployable) => d.pos.distanceToSquared(pos) < r2 && d.team !== byTeam;
    for (const list of [this.sentries, this.walls, this.caches, this.sensors, this.drones] as Deployable[][])
      for (const d of list) if (hit(d)) d.disabledT = Math.max(d.disabledT, GT.empDisable);
    for (const s of ctx.soldiers) if (s.gadget && s.team !== byTeam && s.pos.distanceToSquared(pos) < r2) s.gadget.disabledT = Math.max(s.gadget.disabledT, GT.empDisable);
  }

  private owned(s: Soldier, delta: number, cooldown: number): void {
    const g = s.gadget;
    if (!g) return;
    g.deployed = Math.max(0, g.deployed + delta);
    if (delta < 0) {
      g.cooldown = cooldown;
      g.cooldownMax = cooldown;
    }
  }

  private removeSentry(t: Sentry, ctx: GadgetContext, destroyed: boolean): void {
    this.sentries.splice(this.sentries.indexOf(t), 1);
    ctx.collision.remove(t.box);
    if (destroyed) this.burst(t.pos, t.team, ctx);
    this.owned(t.owner, -1, GT.sentry.cooldown);
  }

  private removeWall(w: Wall, ctx: GadgetContext, destroyed: boolean): void {
    this.walls.splice(this.walls.indexOf(w), 1);
    ctx.collision.remove(w.box);
    ctx.physics.removeCollider(w.collider);
    w.mesh.removeFromParent();
    w.mesh.geometry.dispose();
    if (destroyed) this.burst(w.pos.clone().setY(w.pos.y + 1), w.team, ctx);
    this.owned(w.owner, -1, GT.shield.cooldown);
  }

  private removeCache(c: Cache, ctx: GadgetContext, destroyed: boolean): void {
    this.caches.splice(this.caches.indexOf(c), 1);
    ctx.collision.remove(c.box);
    if (destroyed) this.burst(c.pos, c.team, ctx);
    this.owned(c.owner, -1, GT.cache.cooldown);
  }

  private removeDrone(d: Drone, ctx: GadgetContext, destroyed: boolean): void {
    this.drones.splice(this.drones.indexOf(d), 1);
    ctx.collision.remove(d.box);
    if (destroyed) this.burst(d.pos, d.team, ctx);
    d.owner.piloting = false;
    this.owned(d.owner, -1, GT.drone.cooldown);
  }

  private burst(p: THREE.Vector3, team: TeamId, ctx: GadgetContext): void {
    empBurst(ctx.vfx, p, 1.5);
    ctx.vfx.debris(p, [0x5a5f6e, FACTION_PALETTES[team].armor], 6, { size: [0.06, 0.16], speed: [2, 5], up: 2 });
  }

  /** Test and showcase: one of every deployable fanned out in front of a soldier. */
  showcase(s: Soldier, ctx: GadgetContext): void {
    const keep = { yaw: s.yaw, pitch: s.pitch, gadget: s.gadget };
    const g = newGadgetState('sentry');
    s.gadget = g;
    const at = (dyaw: number, pitch: number) => {
      s.yaw = keep.yaw + dyaw;
      s.pitch = pitch;
    };
    at(0.5, -0.45);
    this.deploySentry(s, g, ctx);
    at(0, 0);
    this.deployWall(s, g, ctx);
    at(-0.5, -0.5);
    this.deployCache(s, g, ctx);
    at(0.25, 0.3);
    this.throwSensor(s, g);
    at(0, -0.2);
    g.cooldown = 0;
    const d = { ...newGadgetState('drone') };
    s.gadget = d;
    this.botPilot.add(s.id);
    this.toggleDrone(s, d, ctx);
    this.botPilot.delete(s.id);
    s.yaw = keep.yaw;
    s.pitch = keep.pitch;
    s.gadget = keep.gadget;
  }

  /** Round reset. */
  clear(ctx: GadgetContext): void {
    for (const t of [...this.sentries]) this.removeSentry(t, ctx, false);
    for (const w of [...this.walls]) this.removeWall(w, ctx, false);
    for (const c of [...this.caches]) this.removeCache(c, ctx, false);
    for (const d of [...this.drones]) this.removeDrone(d, ctx, false);
    this.sensors.length = 0;
    this.darts.length = 0;
    this.uses = 0;
  }

  // ---- Rendering -----------------------------------------------------------------------------
  render(dt: number, alpha: number, ctx: GadgetContext): void {
    const V = this.vis;
    for (const team of [0, 1] as TeamId[]) {
      V.sentryBase[team].begin();
      V.sentryHead[team].begin();
      V.emitter[team].begin();
      V.cache[team].begin();
      V.sensor[team].begin();
      V.drone[team].begin();
    }
    V.dart.begin();
    for (const t of this.sentries) {
      V.sentryBase[t.team].add(_m.compose(t.pos, _q.setFromAxisAngle(_v.set(0, 1, 0), t.baseYaw), _one));
      _e.set(t.pitch, t.yaw, 0, 'YXZ');
      V.sentryHead[t.team].add(_m.compose(_v2.copy(t.pos).setY(t.pos.y + 0.7), _q.setFromEuler(_e), _one));
    }
    for (const w of this.walls) V.emitter[w.team].add(_m.compose(w.pos, _q.setFromAxisAngle(_v.set(0, 1, 0), w.yaw), _one));
    for (const c of this.caches) V.cache[c.team].add(_m.compose(c.pos, _q.setFromAxisAngle(_v.set(0, 1, 0), c.yaw), _one));
    for (const s of this.sensors) V.sensor[s.team].add(_m.compose(s.pos, _q.setFromAxisAngle(_v.set(0, 1, 0), 0), _one));
    for (const d of this.drones) {
      _e.set(-d.vel.z * 0.03, d.yaw, d.vel.x * 0.03, 'YXZ');
      V.drone[d.team].add(_m.compose(_v2.copy(d.prev).lerp(d.pos, alpha), _q.setFromEuler(_e), _one));
    }
    for (const dr of this.darts) {
      _q.setFromUnitVectors(_v.set(0, 0, -1), _v2.copy(dr.vel).normalize());
      V.dart.add(_m.compose(dr.pos, _q, _one));
    }
    for (const team of [0, 1] as TeamId[]) {
      V.sentryBase[team].end();
      V.sentryHead[team].end();
      V.emitter[team].end();
      V.cache[team].end();
      V.sensor[team].end();
      V.drone[team].end();
    }
    V.dart.end();
    for (const m of this.shieldMats) m.time = this.time;
    for (const w of this.walls) w.mesh.visible = true;
    // Arc Tool beams and grapple lines.
    this.beamT -= dt;
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.t += dt;
      if (b.t > 0.06) this.beams.splice(i, 1);
      else if (this.beamT <= 0) ctx.vfx.bolt(b.from, b.to, 0x7cf0ff, { width: 0.03, life: 0.06, segments: 6, jag: 0.12 });
    }
    if (this.beamT <= 0) this.beamT = 0.04;
    for (const s of ctx.soldiers) if (s.state === 'grapple' && s.alive) ctx.vfx.tracer(_v.copy(s.pos).setY(s.pos.y + 1.3), s.grapplePoint, 0x9ad8ff, 0.015, 0.8);
  }
}
