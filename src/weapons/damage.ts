// Damage and health: armor plates absorb first, lethal damage downs a soldier (bleed-out, revive
// or finish), explosive overkill and takedowns kill outright, assists, regeneration, revives and
// radius explosions with line-of-sight occlusion and knockback.
import * as THREE from 'three';
import { TUNING } from '../config/tuning';
import { explosion, type ExplosionKind } from '../render/recipes';
import { chestPoint } from './hitboxes';
import { setStance } from '../player/movement';
import type { Soldier } from '../player/soldier';
import type { EventBus } from '../core/events';
import type { VFX } from '../render/vfx';
import type { CollisionWorld, HitPart } from '../physics/collision';
import type { Physics } from '../physics/physics';
import type { Rng } from '../core/rng';
import type { Projectiles } from './projectiles';

const H = TUNING.health;

export interface CombatContext {
  time: number;
  soldiers: readonly Soldier[];
  events: EventBus;
  vfx: VFX;
  collision: CollisionWorld;
  physics: Physics;
  rng: Rng;
  projectiles: Projectiles;
  player: Soldier | null;
  soldierById(id: number): Soldier | undefined;
  /** Vehicles, destructibles and gadgets react to explosions. */
  onExplosion(pos: THREE.Vector3, radius: number, damage: number, attacker: Soldier | null, vehicleDamage: number, kind: string): void;
  /** Damage to non-soldier hits (destructibles, shields, vehicles, gadgets). Returns true when it absorbed the round. */
  damageObject(ref: unknown, kind: string, damage: number, attacker: Soldier | null, pos: THREE.Vector3, vehicleDamage: number): boolean;
  /** True when smoke blocks sight between two points. */
  smokeBlocks(a: THREE.Vector3, b: THREE.Vector3): boolean;
  isMedic(s: Soldier): boolean;
  fastReviver(s: Soldier): boolean;
  explosiveResist(s: Soldier): number;
}

export interface DamageInfo {
  attacker: Soldier | null;
  weapon: string;
  part: HitPart | null;
  explosive: boolean;
  from: THREE.Vector3;
  armorMul: number;
  takedown?: boolean;
}

export interface DamageResult {
  dealt: number;
  armorBreak: boolean;
  downed: boolean;
  killed: boolean;
}

const _v = new THREE.Vector3();
const _c = new THREE.Vector3();

export function damageSoldier(ctx: CombatContext, v: Soldier, amount: number, info: DamageInfo): DamageResult {
  const res: DamageResult = { dealt: 0, armorBreak: false, downed: false, killed: false };
  if (!v.alive || amount <= 0) return res;
  const a = info.attacker;
  if (a && a !== v && a.team === v.team) return res;
  if (v.spawnProtectT > 0 && a !== v) return res;
  if (info.explosive) amount *= ctx.explosiveResist(v);
  v.lastDamageT = ctx.time;
  v.lastCombatT = ctx.time;
  if (a) {
    a.lastCombatT = ctx.time;
    v.lastAttacker = a.id;
    v.lastAttackerWeapon = info.weapon;
  }
  v.flashT = 0.12;
  if (v.downed) {
    // Finishing a downed soldier.
    if (a && a.team !== v.team) {
      res.dealt = amount;
      res.killed = true;
      killSoldier(ctx, v);
    }
    return res;
  }
  let left = amount;
  if (v.armor > 0) {
    const armorDmg = left * info.armorMul;
    if (armorDmg >= v.armor) {
      left = (armorDmg - v.armor) / Math.max(0.01, info.armorMul);
      res.dealt += v.armor;
      v.armor = 0;
      res.armorBreak = true;
    } else {
      v.armor -= armorDmg;
      res.dealt += armorDmg;
      left = 0;
    }
  }
  if (left > 0) {
    const before = v.health;
    v.health -= left;
    res.dealt += Math.min(before, left);
  }
  if (a && a !== v) {
    a.stats.damage += res.dealt;
    v.assistants.set(a.id, (v.assistants.get(a.id) ?? 0) + res.dealt);
  }
  ctx.events.emit('damaged', { victim: v, attacker: a, amount: res.dealt, from: info.from, explosive: info.explosive });
  if (v.health <= 0) {
    const overkill = -v.health;
    const instant = info.takedown || (info.explosive && overkill > 45) || v.inVehicle || v.state === 'parachute' || v.state === 'wingsuit' || v.state === 'zipline';
    creditKill(ctx, v, info);
    if (instant) {
      res.killed = true;
      killSoldier(ctx, v);
    } else {
      res.downed = true;
      downSoldier(ctx, v, info);
    }
  }
  return res;
}

function creditKill(ctx: CombatContext, v: Soldier, info: DamageInfo): void {
  const killer = info.attacker && info.attacker !== v ? info.attacker : null;
  const assists: Soldier[] = [];
  for (const [id, dmg] of v.assistants) {
    if (killer && id === killer.id) continue;
    if (dmg >= 20) {
      const s = ctx.soldierById(id);
      if (s && s.team !== v.team) assists.push(s);
    }
  }
  v.assistants.clear();
  if (killer) killer.stats.kills++;
  if (killer && info.part === 'head') killer.stats.headshots++;
  for (const s of assists) s.stats.assists++;
  const distance = killer ? killer.pos.distanceTo(v.pos) : 0;
  ctx.events.emit('kill', { victim: v, killer, weapon: info.weapon, headshot: info.part === 'head', distance, assists, vehicle: !!killer?.inVehicle });
}

function downSoldier(ctx: CombatContext, v: Soldier, info: DamageInfo): void {
  v.downed = true;
  v.health = H.downedHealth;
  v.downedT = H.downedSeconds;
  v.reviveProgress = 0;
  v.state = 'downed';
  v.sprinting = false;
  v.tacSprint = false;
  setStance(v, 'prone', ctx.physics);
  ctx.events.emit('downed', { victim: v, attacker: info.attacker, weapon: info.weapon, headshot: info.part === 'head' });
}

/** Final death: tickets are lost here (the mode listens to the 'death' event). */
export function killSoldier(ctx: CombatContext, v: Soldier): void {
  if (!v.alive) return;
  v.alive = false;
  v.downed = false;
  v.state = 'dead';
  v.deadT = 0;
  v.health = 0;
  v.armor = 0;
  v.stats.deaths++;
  setStance(v, 'prone', ctx.physics);
  ctx.events.emit('death', { victim: v });
}

/** Per-tick health: regeneration, bleed-out while downed, revive progress. */
export function stepHealth(ctx: CombatContext, s: Soldier, dt: number): void {
  if (!s.alive) {
    s.deadT += dt;
    return;
  }
  s.spawnProtectT = Math.max(0, s.spawnProtectT - dt);
  s.flashT = Math.max(0, s.flashT - dt);
  if (s.downed) {
    s.downedT -= dt;
    if (s.downedT <= 0) {
      killSoldier(ctx, s);
      return;
    }
    // Revive: a nearby teammate holding interact (bots set interactHeld when reviving).
    let reviver: Soldier | null = null;
    for (const t of ctx.soldiers) {
      if (t === s || !t.active || t.team !== s.team || t.inVehicle) continue;
      if (!t.input.interactHeld) continue;
      if (t.pos.distanceToSquared(s.pos) > H.reviveRange * H.reviveRange) continue;
      reviver = t;
      break;
    }
    if (reviver) {
      const time = ctx.fastReviver(reviver) ? H.reviveTimeMedic * 0.5 : ctx.isMedic(reviver) ? H.reviveTimeMedic : H.reviveTime;
      s.reviveProgress += dt / time;
      s.reviverId = reviver.id;
      if (s.reviveProgress >= 1) revive(ctx, s, reviver);
    } else {
      s.reviveProgress = Math.max(0, s.reviveProgress - dt * 0.5);
      s.reviverId = -1;
    }
    return;
  }
  const regenDelay = s.regenBoostT > 0 ? H.regenDelay * 0.5 : H.regenDelay;
  if (s.health < H.max && ctx.time - s.lastDamageT > regenDelay) s.health = Math.min(H.max, s.health + H.regenRate * dt);
  s.regenBoostT = Math.max(0, s.regenBoostT - dt);
}

export function revive(ctx: CombatContext, s: Soldier, reviver: Soldier | null): void {
  s.downed = false;
  s.state = 'ground';
  s.health = reviver && ctx.fastReviver(reviver) ? H.max : H.revivedHealth;
  s.reviveProgress = 0;
  s.lastDamageT = ctx.time;
  setStance(s, 'crouch', ctx.physics);
  if (reviver) {
    reviver.stats.revives++;
    ctx.events.emit('revive', { victim: s, reviver });
  }
}

export interface ExplodeOpts {
  radius: number;
  damage: number;
  inner: number;
  attacker: Soldier | null;
  weapon: string;
  kind: ExplosionKind;
  vehicleDamage: number;
  fx?: boolean;
}

/** Radius damage with falloff, occlusion, self-damage scaling and knockback. */
export function explode(ctx: CombatContext, pos: THREE.Vector3, o: ExplodeOpts): void {
  if (o.fx !== false) explosion(ctx.vfx, pos, o.radius * 0.5, o.kind);
  ctx.vfx.decal(_v.copy(pos).setY(pos.y - 0.2), new THREE.Vector3(0, 1, 0), o.radius * 0.8, 'crater', 60);
  ctx.events.emit('explosion', { pos: pos.clone(), radius: o.radius, kind: o.kind, owner: o.attacker });
  const E = TUNING.explosions;
  for (const s of ctx.soldiers) {
    if (!s.alive) continue;
    chestPoint(s, _c);
    const d = _c.distanceTo(pos);
    if (d > o.radius) continue;
    let f = d <= o.inner ? 1 : 1 - (d - o.inner) / (o.radius - o.inner);
    if (ctx.collision.blocked(pos.clone().setY(pos.y + 0.3), _c, false)) f *= E.occludedMul;
    if (s === o.attacker) f *= E.selfDamageMul;
    const dmg = o.damage * f;
    if (dmg < 1) continue;
    damageSoldier(ctx, s, dmg, { attacker: o.attacker, weapon: o.weapon, part: null, explosive: true, from: pos, armorMul: 1.2 });
    // Knockback.
    if (s.alive && !s.downed && !s.inVehicle) {
      _v.subVectors(s.pos, pos).setY(0).normalize().multiplyScalar(6 * f);
      s.vel.add(_v);
    }
  }
  ctx.onExplosion(pos, o.radius, o.damage, o.attacker, o.vehicleDamage, o.kind);
}
