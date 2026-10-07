// Weapon handling for every soldier: equip / switch, fire modes, sprint-to-fire, ADS blend,
// spread with bloom, deterministic recoil applied to the aim, recovery, reloads (magazine and
// per-shell), bolt / pump cycling, heat and overheat, launcher lock-on, melee and throwables.
import * as THREE from 'three';
import { TUNING } from '../config/tuning';
import { clamp, viewDir } from '../core/math';
import { Rng } from '../core/rng';
import { coneDir } from './ballistics';
import { recoilKick, recoilSeed } from './recoil';
import { fireInterval } from './stats';
import { damageSoldier, type CombatContext } from './damage';
import { chestPoint } from './hitboxes';
import { Trail } from '../render/vfx';
import type { Arsenal, WeaponState } from './arsenal';
import type { Soldier } from '../player/soldier';
import type { ThrowableId } from '../config/content';

const W = TUNING.weapons;
const DEG = Math.PI / 180;

export interface WeaponContext extends CombatContext {
  arsenal(s: Soldier): Arsenal;
  /** Shot origin (eye) and the visual muzzle offset from it. */
  muzzle(s: Soldier, out: THREE.Vector3): THREE.Vector3;
  applyRecoil(s: Soldier, pitch: number, yaw: number): void;
  lockCandidate(s: Soldier): { id: unknown; pos(): THREE.Vector3 | null } | null;
  throwGrenade(s: Soldier, kind: ThrowableId, origin: THREE.Vector3, dir: THREE.Vector3): void;
  horizontalSpeed(s: Soldier): number;
  /** Optional simplified resolution (far AI level of detail). Returns true when it handled the shot. */
  resolveShot?(s: Soldier, st: WeaponState['stats'], origin: THREE.Vector3, dir: THREE.Vector3): boolean;
  /** Passive scaling of the sprint-to-fire delay. */
  sprintToFireMul?(s: Soldier): number;
  /** True when a mounted soldier fires their own weapons (open passenger seats). */
  personalWeaponSeat?(s: Soldier): boolean;
}

const _dir = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _o = new THREE.Vector3();
const _mz = new THREE.Vector3();
const _v = new THREE.Vector3();

/** Current spread cone (degrees) for a soldier with a weapon. */
export function currentSpread(s: Soldier, a: Arsenal, w: WeaponState, speed: number): number {
  const st = w.stats;
  let base = st.hip + (st.ads - st.hip) * a.adsK;
  base += st.move * clamp(speed / TUNING.movement.walkSpeed, 0, 1.4) * (1 - a.adsK * 0.6);
  const ss = W.stanceSpread;
  let mul = s.stance === 'prone' ? ss.prone : s.stance === 'crouch' ? ss.crouch : ss.stand;
  if (s.state === 'air' || s.state === 'parachute' || s.state === 'zipline') mul = ss.air;
  else if (s.state === 'slide') mul = ss.slide;
  return Math.max(0, base * mul + w.bloom);
}

export class WeaponSystem {
  private rng = new Rng(4242);

  step(s: Soldier, dt: number, ctx: WeaponContext): void {
    const a = ctx.arsenal(s);
    const inp = s.input;
    const w = a.current;
    const st = w.stats;
    a.meleeCooldown = Math.max(0, a.meleeCooldown - dt);
    // Passive throwable trickle.
    a.resupplyT += dt;
    if (a.resupplyT > TUNING.throwables.resupplyEvery && a.throwables < TUNING.throwables[a.throwable].count) {
      a.resupplyT = 0;
      a.throwables++;
    }
    this.coolHeat(a, dt, ctx);
    if (!s.active || (s.inVehicle && !ctx.personalWeaponSeat?.(s))) {
      a.adsK = 0;
      w.reloadT = -1;
      return;
    }
    const busyMove = s.state === 'ladder' || s.state === 'zipline' || s.state === 'mantle' || s.state === 'parachute' || s.state === 'wingsuit' || s.state === 'grapple';
    // ---- Slot switching
    if (inp.slot >= 0) {
      let target = inp.slot;
      if (target >= 100) target = (a.slot + (target > 100 ? 1 : 2)) % a.slots.length;
      if (a.switchTo(target)) {
        a.throwT = -1;
      }
    }
    if (a.equipT > 0) a.equipT = Math.max(0, a.equipT - dt);
    // ---- Fire mode
    if (inp.fireMode && st.modes.length > 1) {
      w.modeIndex = (w.modeIndex + 1) % st.modes.length;
      ctx.events.emit('ui', { sound: 'mode' });
    }
    // ---- Inspect
    if (inp.inspect && a.inspectT < 0 && !w.reloading) a.inspectT = 0;
    if (a.inspectT >= 0) {
      a.inspectT += dt / TUNING.viewmodel.inspectTime;
      if (a.inspectT >= 1 || inp.fire || inp.aim) a.inspectT = -1;
    }
    // ---- Melee
    if (inp.melee && a.meleeCooldown <= 0 && a.meleeT < 0 && !busyMove) {
      a.meleeT = 0;
      a.meleeCooldown = TUNING.melee.cooldown;
      w.reloadT = -1;
    }
    if (a.meleeT >= 0) {
      const prev = a.meleeT;
      a.meleeT += dt / TUNING.viewmodel.meleeTime;
      const hitAt = TUNING.melee.windup / TUNING.viewmodel.meleeTime;
      if (prev < hitAt && a.meleeT >= hitAt) this.melee(s, ctx);
      if (a.meleeT >= 1) a.meleeT = -1;
      a.adsK = Math.max(0, a.adsK - dt * 8);
      return;
    }
    // ---- Throwables
    if (inp.grenade && a.throwT < 0 && a.throwables > 0 && !busyMove) {
      a.throwT = 0;
      w.reloadT = -1;
    }
    if (a.throwT >= 0) {
      const prev = a.throwT;
      a.throwT += dt / TUNING.viewmodel.throwTime;
      if (prev < 0.4 && a.throwT >= 0.4) {
        a.throwables--;
        ctx.muzzle(s, _o);
        viewDir(s.yaw, s.pitch + 0.12, _dir);
        ctx.throwGrenade(s, a.throwable, s.eyePos.clone().addScaledVector(_dir, 0.5), _dir.clone());
        ctx.events.emit('throw', { soldier: s, kind: a.throwable });
      }
      if (a.throwT >= 1) a.throwT = -1;
      a.adsK = Math.max(0, a.adsK - dt * 8);
      return;
    }
    // ---- Sprint-to-fire
    if (s.sprinting || s.tacSprint || busyMove) a.sprintBlock = st.sprintToFire * (ctx.sprintToFireMul?.(s) ?? 1);
    else a.sprintBlock = Math.max(0, a.sprintBlock - dt);
    // ---- ADS
    const canAds = !s.sprinting && !s.tacSprint && !busyMove && a.equipT <= 0 && !(w.reloading && st.category === 'launcher');
    const wantAds = inp.aim && canAds;
    a.adsK = clamp(a.adsK + (wantAds ? 1 : -1.6) * (dt / Math.max(0.05, st.adsTime)), 0, 1);
    // ---- Bolt / pump cycle
    if (w.cycleT >= 0) {
      w.cycleT += dt / Math.max(0.05, st.bolt);
      if (w.cycleT >= 1) w.cycleT = -1;
    }
    // ---- Reload
    if (inp.reload) this.startReload(w, s, ctx);
    if (w.reloading) {
      this.stepReload(w, s, dt, ctx, inp.firePressed);
      if (w.reloading) {
        w.shot = 0;
        this.recover(s, a, w, dt, ctx);
        this.lock(s, a, w, dt, ctx);
        return;
      }
    }
    // ---- Fire
    w.cooldown = Math.max(0, w.cooldown - dt);
    const ready = a.equipT <= 0 && a.sprintBlock <= 0 && w.cooldown <= 0 && w.cycleT < 0 && !busyMove && w.overheatT <= 0;
    const mode = w.mode;
    let trigger = false;
    if (mode === 'auto') trigger = inp.fire;
    else if (mode === 'single') trigger = inp.firePressed;
    else if (mode === 'burst') {
      if (inp.firePressed && w.burstLeft <= 0) w.burstLeft = st.burst;
      trigger = w.burstLeft > 0;
    }
    if (trigger && ready) {
      if (!w.usesHeat && w.mag <= 0) {
        if (inp.firePressed) ctx.events.emit('empty', { soldier: s });
        this.startReload(w, s, ctx);
      } else {
        this.fire(s, a, w, ctx);
        if (mode === 'burst') w.burstLeft--;
      }
    }
    if (!inp.fire && mode !== 'burst' && w.shot > 0 && ctx.time - w.lastShotT > fireInterval(st) * 1.5) {
      w.shot = 0;
      w.stringIndex++;
    }
    if (mode === 'burst' && w.burstLeft <= 0 && w.shot > 0 && ctx.time - w.lastShotT > fireInterval(st) * 2.5) {
      w.shot = 0;
      w.stringIndex++;
    }
    // Bloom recovery.
    w.bloom = Math.max(0, w.bloom - st.bloomRecover * dt * (ctx.time - w.lastShotT > 0.1 ? 1 : 0.2));
    this.recover(s, a, w, dt, ctx);
    this.lock(s, a, w, dt, ctx);
  }

  private fire(s: Soldier, a: Arsenal, w: WeaponState, ctx: WeaponContext): void {
    const st = w.stats;
    w.cooldown += fireInterval(st);
    w.lastShotT = ctx.time;
    if (w.usesHeat && st.heat) {
      w.heat += st.heat.perShot;
      w.heatCoolT = st.heat.coolDelay;
      if (w.heat >= 1) {
        w.heat = 1;
        w.overheatT = st.heat.lockout;
      }
    } else w.mag--;
    if (st.bolt > 0 && w.mag > 0) w.cycleT = 0;
    // Aim and spread.
    viewDir(s.yaw, s.pitch, _aim);
    const speed = ctx.horizontalSpeed(s);
    const spread = currentSpread(s, a, w, speed);
    const origin = s.eyePos.clone();
    ctx.muzzle(s, _mz);
    const visOffset = _mz.clone().sub(origin);
    const pellets = st.pellets;
    for (let i = 0; i < pellets; i++) {
      const cone = pellets > 1 ? Math.max(spread, st.pelletSpread) : spread;
      coneDir(_aim, cone, this.rng.next(), this.rng.next(), _dir);
      if (st.category === 'launcher') this.fireRocket(s, w, origin, _dir, visOffset, ctx);
      else if (!ctx.resolveShot?.(s, st, origin, _dir)) ctx.projectiles.spawn('bullet', origin, _dir, st.velocity, s, st, { visOffset, tracer: pellets > 1 ? i < 3 : (w.shot % W.tracerEvery === 0 || s.isPlayer) });
    }
    // Recoil (deterministic per string) and bloom.
    const rng = new Rng(recoilSeed(st.id, w.stringIndex) + w.shot * 7919);
    const braced = s.stance === 'prone' || s.stance === 'crouch' ? st.braced : 1;
    const adsMul = 1 - a.adsK * 0.25;
    const k = recoilKick(st, w.shot, rng, adsMul, braced);
    ctx.applyRecoil(s, k.v * DEG, -k.h * DEG);
    w.recoilAccum += k.v * DEG;
    w.shot++;
    w.bloom = Math.min(st.bloomMax, w.bloom + (a.adsK > 0.5 ? st.bloom : st.bloomHip));
    s.firedUntil = ctx.time + (st.suppressed ? 0.4 : 1.2);
    s.lastCombatT = ctx.time;
    ctx.events.emit('shot', { soldier: s, weapon: st.id, pos: _mz.clone(), dir: _aim.clone(), suppressed: st.suppressed, energy: st.energy });
    if (!w.usesHeat && w.mag <= 0 && w.reserve > 0) {
      // Auto-reload when the magazine runs dry.
      this.startReload(w, s, ctx);
    }
  }

  private fireRocket(s: Soldier, w: WeaponState, origin: THREE.Vector3, dir: THREE.Vector3, visOffset: THREE.Vector3, ctx: WeaponContext): void {
    const R = W.rocket;
    const start = origin.clone().add(visOffset).addScaledVector(dir, 0.6);
    const trail = new Trail(0xffd04a, 0.18, 22);
    trail.emitting = true;
    const target = w.locked ? (w.lockTarget as { pos(): THREE.Vector3 | null } | null) : null;
    const p = ctx.projectiles.spawn('rocket', start, dir, w.stats.velocity, s, w.stats, {
      trail,
      homing: target,
      splash: { damage: R.splashDamage, radius: R.splashRadius, inner: 1.2, vehicle: R.vehicleDamage },
      directDamage: w.stats.damage[0],
      vehicleDamage: R.vehicleDamage,
      life: R.life,
      tracer: false,
    });
    if (p) ctx.vfx.addTrail(trail, () => p.pos, () => !p.active);
    w.locked = false;
    w.lockT = 0;
  }

  private startReload(w: WeaponState, s: Soldier, ctx: WeaponContext): void {
    const st = w.stats;
    if (w.usesHeat || w.reloading || w.reserve <= 0 || w.mag >= st.mag) return;
    w.reloadT = 0;
    w.reloadDur = st.perShell ? st.reload : w.mag > 0 ? st.reload : st.reloadEmpty;
    w.burstLeft = 0;
    ctx.events.emit('reload', { soldier: s, weapon: st.id });
  }

  private stepReload(w: WeaponState, s: Soldier, dt: number, ctx: WeaponContext, interrupt: boolean): void {
    const st = w.stats;
    w.reloadT += dt;
    if (st.perShell) {
      // One shell per cycle; firing interrupts between shells.
      if (w.reloadT >= w.reloadDur) {
        w.mag++;
        w.reserve--;
        w.reloadT = 0;
        if (w.mag >= st.mag || w.reserve <= 0 || interrupt) w.reloadT = -1;
      }
      return;
    }
    if (w.reloadT >= w.reloadDur) {
      const need = st.mag - w.mag;
      const take = Math.min(need, w.reserve);
      w.mag += take;
      w.reserve -= take;
      w.reloadT = -1;
    }
    void s;
    void ctx;
  }

  private coolHeat(a: Arsenal, dt: number, _ctx: WeaponContext): void {
    for (const w of a.slots) {
      if (!w.usesHeat || !w.stats.heat) continue;
      const h = w.stats.heat;
      if (w.overheatT > 0) {
        w.overheatT -= dt;
        w.heat = Math.max(0, w.heat - dt / h.lockout);
        if (w.overheatT <= 0) w.heat = 0;
        continue;
      }
      if (w.heatCoolT > 0) w.heatCoolT -= dt;
      else w.heat = Math.max(0, w.heat - h.cool * dt);
    }
  }

  /** Pulls a fraction of the vertical recoil back after firing stops. */
  private recover(s: Soldier, _a: Arsenal, w: WeaponState, dt: number, ctx: WeaponContext): void {
    if (ctx.time - w.lastShotT < W.recoilRecoverDelay) return;
    if (w.recoilAccum > 0) {
      w.recoverLeft += w.recoilAccum * w.stats.recoil.recover;
      w.recoilAccum = 0;
    }
    if (w.recoverLeft <= 0) return;
    const step = Math.min(w.recoverLeft, Math.max(w.recoverLeft * W.recoilRecoverRate * dt, 0.0005));
    ctx.applyRecoil(s, -step, 0);
    w.recoverLeft -= step;
  }

  /** Launcher lock-on: ADS on a vehicle inside the cone for lockTime. */
  private lock(s: Soldier, a: Arsenal, w: WeaponState, dt: number, ctx: WeaponContext): void {
    if (w.stats.category !== 'launcher') return;
    const R = W.rocket;
    if (a.adsK < 0.8) {
      w.lockT = 0;
      w.locked = false;
      w.lockTarget = null;
      return;
    }
    const cand = ctx.lockCandidate(s);
    if (!cand) {
      w.lockT = Math.max(0, w.lockT - dt * 2);
      if (w.lockT <= 0) {
        w.locked = false;
        w.lockTarget = null;
      }
      return;
    }
    if (w.lockTarget && (w.lockTarget as { id: unknown }).id !== cand.id) w.lockT = 0;
    w.lockTarget = cand;
    w.lockT = Math.min(R.lockTime, w.lockT + dt);
    w.locked = w.lockT >= R.lockTime;
  }

  private melee(s: Soldier, ctx: WeaponContext): void {
    const M = TUNING.melee;
    let best: Soldier | null = null;
    let bd = M.range;
    viewDir(s.yaw, 0, _aim);
    for (const t of ctx.soldiers) {
      if (!t.alive || t.team === s.team || t.inVehicle) continue;
      chestPoint(t, _v).sub(s.pos).setY(0);
      const d = _v.length();
      if (d > bd || d < 1e-3) continue;
      if (_v.normalize().dot(_aim) < M.cone) continue;
      best = t;
      bd = d;
    }
    ctx.events.emit('melee', { soldier: s, hit: !!best });
    if (!best) return;
    // Takedown from behind: the victim faces away from the attacker.
    const facing = new THREE.Vector3(-Math.sin(best.yaw), 0, -Math.cos(best.yaw));
    const behind = facing.dot(_aim) > 0.4 || best.downed;
    const dmg = behind ? M.takedownDamage : M.damage;
    const r = damageSoldier(ctx, best, dmg, { attacker: s, weapon: 'Melee', part: 'body', explosive: false, from: s.pos.clone(), armorMul: 1, takedown: behind });
    ctx.events.emit('hit', { attacker: s, victim: best, kind: 'soldier', part: 'body', damage: r.dealt, armorBreak: r.armorBreak, kill: r.killed, downed: r.downed, pos: best.pos.clone() });
  }
}
