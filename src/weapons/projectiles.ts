// Ballistic projectiles: pooled bullets, rockets and shells simulated as swept ray segments each
// tick, with gravity drop, penetration through thin materials, homing rockets, near-miss whizzes,
// impact effects and decals. Tracers render with the style's glow treatment.
import * as THREE from 'three';
import { TUNING } from '../config/tuning';
import { integrate, damageAt } from './ballistics';
import { damageSoldier, explode, type CombatContext } from './damage';
import { impact, FX_COLORS } from '../render/recipes';
import { Trail } from '../render/vfx';
import { makeHit } from '../physics/collision';
import type { WeaponStats } from './stats';
import type { Soldier } from '../player/soldier';
import type { EnergyFamily } from '../config/content';

export type ProjectileKind = 'bullet' | 'rocket' | 'shell' | 'cannon';

export interface Projectile {
  active: boolean;
  kind: ProjectileKind;
  pos: THREE.Vector3;
  prev: THREE.Vector3;
  vel: THREE.Vector3;
  owner: Soldier | null;
  /** Object to ignore on the first ticks (the shooter's vehicle). */
  ignore: unknown;
  team: number;
  stats: WeaponStats | null;
  weaponName: string;
  energy: EnergyFamily;
  traveled: number;
  life: number;
  gravity: number;
  penetration: number;
  damageMul: number;
  tracer: boolean;
  /** Visual offset from the true path (first-person muzzle), decays quickly. */
  visOffset: THREE.Vector3;
  visT: number;
  homing: { pos(): THREE.Vector3 | null } | null;
  splash: { damage: number; radius: number; inner: number; vehicle: number } | null;
  directDamage: number;
  vehicleDamage: number;
  trail: Trail | null;
  whizzed: boolean;
}

const _dir = new THREE.Vector3();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _hit = makeHit();
const POOL = 900;

export class Projectiles {
  readonly list: Projectile[] = [];
  private free: Projectile[] = [];
  private tickCount = 0;

  constructor() {
    for (let i = 0; i < POOL; i++) this.free.push(this.blank());
  }

  private blank(): Projectile {
    return {
      active: false,
      kind: 'bullet',
      pos: new THREE.Vector3(),
      prev: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      owner: null,
      ignore: null,
      team: -1,
      stats: null,
      weaponName: '',
      energy: 'kinetic',
      traveled: 0,
      life: 0,
      gravity: 0,
      penetration: 0,
      damageMul: 1,
      tracer: false,
      visOffset: new THREE.Vector3(),
      visT: 0,
      homing: null,
      splash: null,
      directDamage: 0,
      vehicleDamage: 0,
      trail: null,
      whizzed: false,
    };
  }

  spawn(kind: ProjectileKind, origin: THREE.Vector3, dir: THREE.Vector3, speed: number, owner: Soldier | null, stats: WeaponStats | null, opts: Partial<Projectile> = {}): Projectile | null {
    const p = this.free.pop() ?? null;
    if (!p) return null;
    p.active = true;
    p.kind = kind;
    p.pos.copy(origin);
    p.prev.copy(origin);
    p.vel.copy(dir).multiplyScalar(speed);
    p.owner = owner;
    p.ignore = opts.ignore ?? owner;
    p.team = owner ? owner.team : -1;
    p.stats = stats;
    p.weaponName = opts.weaponName ?? stats?.id ?? kind;
    p.energy = opts.energy ?? stats?.energy ?? 'kinetic';
    p.traveled = 0;
    p.life = opts.life ?? TUNING.weapons.maxProjectileLife;
    p.gravity = opts.gravity ?? TUNING.weapons.gravity * (stats?.gravityMul ?? 1);
    p.penetration = opts.penetration ?? stats?.penetration ?? 0;
    p.damageMul = opts.damageMul ?? 1;
    p.tracer = opts.tracer ?? true;
    p.visOffset.copy(opts.visOffset ?? _v.set(0, 0, 0));
    p.visT = 0;
    p.homing = opts.homing ?? null;
    p.splash = opts.splash ?? null;
    p.directDamage = opts.directDamage ?? 0;
    p.vehicleDamage = opts.vehicleDamage ?? 0;
    p.trail = opts.trail ?? null;
    p.whizzed = false;
    this.list.push(p);
    return p;
  }

  private release(p: Projectile): void {
    p.active = false;
    if (p.trail) p.trail.emitting = false;
    p.trail = null;
    p.homing = null;
    p.owner = null;
    p.ignore = null;
    p.stats = null;
    this.free.push(p);
  }

  step(dt: number, ctx: CombatContext): void {
    this.tickCount++;
    const R = TUNING.weapons.rocket;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.life -= dt;
      p.visT += dt;
      if (p.kind === 'rocket') {
        // Accelerate and (when locked) steer toward the target.
        const sp = p.vel.length();
        const ns = Math.min(R.maxSpeed, sp + R.accel * dt);
        _dir.copy(p.vel).normalize();
        const tgt = p.homing?.pos();
        if (tgt) {
          _v.subVectors(tgt, p.pos).normalize();
          const ang = _dir.angleTo(_v);
          const k = Math.min(1, (R.turnRate * dt) / Math.max(1e-4, ang));
          _dir.lerp(_v, k).normalize();
        }
        p.vel.copy(_dir).multiplyScalar(ns);
      }
      const seg = integrate(p.pos, p.vel, p.prev, dt, p.gravity);
      p.traveled += seg;
      if (seg > 1e-5) {
        _dir.subVectors(p.pos, p.prev).multiplyScalar(1 / seg);
        this.whiz(p, ctx);
        let remaining = seg;
        const from = _v2.copy(p.prev);
        // Resolve hits along the segment (penetration may continue through thin surfaces).
        for (let guard = 0; guard < 4 && remaining > 1e-3; guard++) {
          const h = ctx.collision.raycast(from, _dir, remaining, { ignore: p.ignore, shieldTeam: undefined }, _hit);
          if (!h) break;
          const stop = this.resolve(p, h, ctx);
          if (stop) {
            this.release(p);
            this.list.splice(i, 1);
            break;
          }
          from.copy(h.point).addScaledVector(_dir, 0.05);
          remaining -= h.dist + 0.05;
        }
        if (!p.active) continue;
      }
      if (p.life <= 0 || p.pos.y < -50) {
        if (p.kind === 'rocket' && p.splash) explode(ctx, p.pos, { radius: p.splash.radius, damage: p.splash.damage, inner: p.splash.inner, attacker: p.owner, weapon: p.weaponName, kind: 'rocket', vehicleDamage: p.splash.vehicle });
        this.release(p);
        this.list.splice(i, 1);
      }
    }
  }

  /** Near-miss audio and suppression for the local player. */
  private whiz(p: Projectile, ctx: CombatContext): void {
    const pl = ctx.player;
    if (!pl || p.whizzed || p.owner === pl || p.team === pl.team || !pl.alive) return;
    const eye = pl.eyePos;
    _v.subVectors(eye, p.prev);
    const t = THREE.MathUtils.clamp(_v.dot(_dir), 0, p.prev.distanceTo(p.pos));
    _v.copy(p.prev).addScaledVector(_dir, t);
    if (_v.distanceTo(eye) < TUNING.weapons.whizRadius) {
      p.whizzed = true;
      ctx.events.emit('whiz', { pos: _v.clone(), crack: p.vel.lengthSq() > 343 * 343 });
    }
  }

  /** Applies a hit. Returns true when the projectile stops. */
  private resolve(p: Projectile, h: ReturnType<typeof makeHit>, ctx: CombatContext): boolean {
    const dist = p.traveled - (p.pos.distanceTo(h.point));
    const s = p.stats;
    // Explosive rounds detonate on contact.
    if (p.splash) {
      if (h.kind === 'soldier' && p.directDamage > 0) {
        damageSoldier(ctx, h.ref as Soldier, p.directDamage, { attacker: p.owner, weapon: p.weaponName, part: h.part, explosive: true, from: p.prev, armorMul: 1 });
      } else if (h.ref && h.kind !== 'soldier') {
        ctx.damageObject(h.ref, h.kind, p.directDamage, p.owner, h.point, p.vehicleDamage);
      }
      _v.copy(h.point).addScaledVector(h.normal, 0.3);
      explode(ctx, _v, { radius: p.splash.radius, damage: p.splash.damage, inner: p.splash.inner, attacker: p.owner, weapon: p.weaponName, kind: p.kind === 'rocket' ? 'rocket' : 'shell', vehicleDamage: p.splash.vehicle });
      return true;
    }
    const base = s ? damageAt(s, dist, h.part) : p.directDamage;
    const dmg = base * p.damageMul;
    if (h.kind === 'soldier') {
      const victim = h.ref as Soldier;
      const r = damageSoldier(ctx, victim, dmg, { attacker: p.owner, weapon: p.weaponName, part: h.part, explosive: false, from: p.prev, armorMul: s?.armorMul ?? 1 });
      if (p.owner && r.dealt > 0)
        ctx.events.emit('hit', { attacker: p.owner, victim, kind: 'soldier', part: h.part, damage: r.dealt, armorBreak: r.armorBreak, kill: r.killed, downed: r.downed, pos: h.point.clone() });
      impact(ctx.vfx, h.point, h.normal, 'armor', p.energy, h.part === 'head', victim.team === 0 ? 0x3fe0ff : 0xff3a5c);
      return true;
    }
    // World and objects.
    impact(ctx.vfx, h.point, h.normal, h.surface, p.energy, p.kind !== 'bullet');
    ctx.events.emit('impact', { pos: h.point.clone(), surface: h.surface, energy: p.energy, heavy: false });
    if (h.kind === 'terrain' || h.kind === 'static') ctx.vfx.decal(h.point, h.normal, p.energy === 'kinetic' ? 0.22 : 0.3, p.energy === 'kinetic' ? 'hole' : 'burn', 30, p.energy === 'kinetic' ? undefined : FX_COLORS[p.energy].main);
    if (h.ref && h.kind !== 'terrain' && h.kind !== 'static') {
      const absorbed = ctx.damageObject(h.ref, h.kind, dmg, p.owner, h.point, dmg * (s?.vehicleMul ?? 0.05));
      if (p.owner && absorbed) ctx.events.emit('hit', { attacker: p.owner, victim: null, kind: h.kind === 'vehicle' ? 'vehicle' : h.box?.kind === 'shield' ? 'shield' : 'object', part: null, damage: dmg, armorBreak: false, kill: false, downed: false, pos: h.point.clone() });
      if (absorbed && !h.thin) return true;
    }
    if (h.thin && p.penetration > 0) {
      p.penetration--;
      p.damageMul *= TUNING.weapons.penetrationKeep;
      return false;
    }
    return true;
  }

  /** Draws tracers for this frame. `alpha` interpolates between sim steps. */
  render(ctx: { vfx: CombatContext['vfx'] }, alpha: number): void {
    for (const p of this.list) {
      if (!p.tracer || p.kind !== 'bullet') continue;
      const head = _v.copy(p.prev).lerp(p.pos, alpha);
      const decay = Math.max(0, 1 - p.visT / 0.09);
      head.addScaledVector(p.visOffset, decay);
      const sp = p.vel.length();
      const len = Math.min(p.traveled, 4 + sp * 0.006);
      _dir.copy(p.vel).normalize();
      const tail = _v2.copy(head).addScaledVector(_dir, -len);
      const c = FX_COLORS[p.energy === 'rocket' ? 'kinetic' : p.energy].main;
      ctx.vfx.tracer(tail, head, c, p.energy === 'kinetic' ? 0.02 : 0.03, p.energy === 'kinetic' ? 0.9 : 1.2);
    }
  }

  clear(): void {
    for (const p of this.list) this.release(p);
    this.list.length = 0;
  }

  get count(): number {
    return this.list.length;
  }
}
