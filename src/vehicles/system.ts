// Vehicle system: HQ pads and airdrops, seats (enter, exit, switch), hover vehicles on four
// raycast springs with arcade drive, arcade flight for the VTOL and the helicopter, per-seat weapon
// mounts (cannon, coax beam, rocket pods, chin turret, miniguns, door gun, personal weapons on
// open seats), hull and component damage with self-repair, burning and wreck explosions, run-over
// damage, crash damage, launcher lock-on targets, lock warnings and countermeasures.
import * as THREE from 'three';
import { TUNING } from '../config/tuning';
import { RAPIER, G, groups, VEHICLE_FILTER, type Physics } from '../physics/physics';
import { Vehicle, SEAT_EXPOSED, type Mount } from './vehicle';
import { wrapAngle, clamp, rayObb, viewDir } from '../core/math';
import { weaponStats, type WeaponStats } from '../weapons/stats';
import { defaultAttachments } from '../art/weaponModels';
import { coneDir } from '../weapons/ballistics';
import { damageSoldier, explode, type CombatContext } from '../weapons/damage';
import { muzzleFlash, dustKick, shieldSpark } from '../render/recipes';
import { Trail } from '../render/vfx';
import { setStance, teleport } from '../player/movement';
import type { Hit, RayTargetSet, CollisionWorld } from '../physics/collision';
import type { Soldier } from '../player/soldier';
import { VEHICLES, type TeamId, type VehicleKind } from '../config/content';
import type { HqDef } from '../world/maps/breakwater/layout';

const V = TUNING.vehicles;
const VW = V.weapons;

export interface VehicleContext extends CombatContext {
  scene: THREE.Scene;
  physics: Physics;
  collision: CollisionWorld;
  groundHeight(x: number, z: number): number;
}

interface Pad {
  kind: VehicleKind;
  team: TeamId;
  pos: THREE.Vector3;
  yaw: number;
  vehicle: Vehicle | null;
  respawnT: number;
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _n = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler();
const _up = new THREE.Vector3(0, 1, 0);
const _down = new THREE.Vector3(0, -1, 0);
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _hits: THREE.Vector3[] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];

export class VehicleSystem implements RayTargetSet {
  readonly list: Vehicle[] = [];
  readonly pads: Pad[] = [];
  /** Vehicles entered this round (automated test stats). */
  entries = 0;
  private stats: Record<'coax' | 'chin' | 'minigun' | 'doorgun' | 'rockets' | 'cannon', WeaponStats>;
  /** Intended velocity before the physics step (crash detection). */
  private intended = new Map<number, THREE.Vector3>();

  constructor(private scene: THREE.Scene) {
    const base = weaponStats('lumen', defaultAttachments('lumen'));
    const mk = (o: Partial<WeaponStats>): WeaponStats => ({ ...base, penetration: 0, ...o });
    this.stats = {
      coax: mk({ damage: VW.coax.damage, range: [20, 120], velocity: VW.coax.velocity, vehicleMul: VW.coax.vehicleMul, energy: 'cyan' }),
      chin: mk({ damage: VW.chin.damage, range: [30, 160], velocity: VW.chin.velocity, vehicleMul: VW.chin.vehicleMul, energy: 'kinetic', gravityMul: 0.3 }),
      minigun: mk({ damage: VW.minigun.damage, range: [20, 110], velocity: VW.minigun.velocity, vehicleMul: VW.minigun.vehicleMul, energy: 'kinetic' }),
      doorgun: mk({ damage: VW.doorgun.damage, range: [20, 110], velocity: VW.doorgun.velocity, vehicleMul: VW.doorgun.vehicleMul, energy: 'kinetic' }),
      rockets: mk({ damage: [VW.rockets.damage, VW.rockets.damage], range: [0, 1], velocity: VW.rockets.velocity, vehicleMul: 1, energy: 'rocket', gravityMul: 0.2 }),
      cannon: mk({ damage: [VW.cannon.damage, VW.cannon.damage], range: [0, 1], velocity: VW.cannon.velocity, vehicleMul: 1, energy: 'kinetic', gravityMul: VW.cannon.gravityMul }),
    };
  }

  // ---- Spawning ------------------------------------------------------------------------------
  setupPads(hqs: readonly HqDef[], height: (x: number, z: number) => number): void {
    this.pads.length = 0;
    for (const hq of hqs) for (const p of hq.pads) this.pads.push({ kind: p.kind, team: hq.team, pos: p.pos.clone().setY(height(p.pos.x, p.pos.z)), yaw: p.yaw, vehicle: null, respawnT: 0 });
  }

  spawn(kind: VehicleKind, team: TeamId, pos: THREE.Vector3, yaw: number, physics: Physics): Vehicle {
    const v = new Vehicle(kind, team);
    v.yaw = yaw;
    v.quat.setFromAxisAngle(_up, yaw);
    v.prevQuat.copy(v.quat);
    const start = pos.clone();
    if (!v.aircraft) start.y += V[kind as 'wisp'].hoverHeight;
    v.pos.copy(start);
    v.prevPos.copy(start);
    const h = v.halfExtents;
    v.body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(start.x, start.y, start.z).setRotation({ x: v.quat.x, y: v.quat.y, z: v.quat.z, w: v.quat.w }).setGravityScale(0).lockRotations().setLinearDamping(0).setCanSleep(false),
    );
    v.collider = physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(h.x, h.y, h.z).setTranslation(0, v.model.centerY, 0).setCollisionGroups(groups(G.VEHICLE, VEHICLE_FILTER)).setMass(V[kind].mass).setFriction(0.3),
      v.body,
    );
    this.scene.add(v.model.root);
    this.list.push(v);
    v.updateInverse();
    return v;
  }

  private despawn(v: Vehicle, physics: Physics): void {
    physics.world.removeRigidBody(v.body);
    v.model.root.removeFromParent();
    this.list.splice(this.list.indexOf(v), 1);
    for (const p of this.pads) if (p.vehicle === v) {
      p.vehicle = null;
      p.respawnT = V[p.kind].respawn;
    }
  }

  /** Round reset: removes every vehicle and refills the pads. */
  reset(ctx: VehicleContext): void {
    for (const v of [...this.list]) {
      for (let i = 0; i < v.seats.length; i++) if (v.seats[i]) this.exit(v.seats[i]!, ctx, true);
      this.despawn(v, ctx.physics);
    }
    for (const p of this.pads) {
      p.vehicle = this.spawn(p.kind, p.team, p.pos, p.yaw, ctx.physics);
      p.vehicle.pad = { pos: p.pos, yaw: p.yaw, team: p.team };
      p.respawnT = 0;
    }
    this.entries = 0;
  }

  // ---- Seats ---------------------------------------------------------------------------------
  vehicleOf(s: Soldier): Vehicle | null {
    if (s.vehicleId < 0) return null;
    return this.list.find((v) => v.id === s.vehicleId) ?? null;
  }

  /** True when the soldier can be hit by bullets (not in a vehicle, or in an open seat). */
  exposed(s: Soldier): boolean {
    const v = this.vehicleOf(s);
    return !v || SEAT_EXPOSED[v.kind][s.seat] === true;
  }

  /** Closest enterable vehicle (alive, a free seat, friendly or empty). */
  nearest(s: Soldier, range = V.enterRange): Vehicle | null {
    let best: Vehicle | null = null;
    let bd = range;
    for (const v of this.list) {
      if (!v.alive || !v.seats.includes(null)) continue;
      if (v.crewCount > 0 && v.team !== s.team) continue;
      const d = this.distToHull(v, s.pos);
      if (d < bd) {
        bd = d;
        best = v;
      }
    }
    return best;
  }

  distToHull(v: Vehicle, p: THREE.Vector3): number {
    _v.copy(p).applyMatrix4(v.inv);
    const h = v.halfExtents;
    const dx = Math.max(0, Math.abs(_v.x) - h.x), dy = Math.max(0, Math.abs(_v.y) - h.y), dz = Math.max(0, Math.abs(_v.z) - h.z);
    return Math.hypot(dx, dy, dz);
  }

  enter(s: Soldier, v: Vehicle, seat = -1): boolean {
    if (!v.alive || !s.active || s.inVehicle) return false;
    let i = seat >= 0 && seat < v.seats.length && !v.seats[seat] ? seat : v.seats.indexOf(null);
    if (i < 0) return false;
    if (seat < 0 && v.seats[0] === null) i = 0;
    v.seats[i] = s;
    if (v.crewCount === 1) v.team = s.team;
    s.vehicleId = v.id;
    s.seat = i;
    s.enclosed = !SEAT_EXPOSED[v.kind][i];
    s.state = 'vehicle';
    s.sprinting = false;
    s.tacSprint = false;
    s.collider?.setEnabled(false);
    s.vel.set(0, 0, 0);
    this.entries++;
    return true;
  }

  switchSeat(s: Soldier, seat: number): boolean {
    const v = this.vehicleOf(s);
    if (!v || seat < 0 || seat >= v.seats.length || v.seats[seat]) return false;
    v.seats[s.seat] = null;
    v.seats[seat] = s;
    s.seat = seat;
    s.enclosed = !SEAT_EXPOSED[v.kind][seat];
    return true;
  }

  exit(s: Soldier, ctx: VehicleContext, force = false): boolean {
    const v = this.vehicleOf(s);
    if (!v) return false;
    // Step out to the side (the first clear spot).
    const right = _right.set(1, 0, 0).applyQuaternion(v.quat).setY(0).normalize();
    const out = new THREE.Vector3();
    let placed = false;
    for (const side of [1, -1, 0]) {
      out.copy(v.pos).addScaledVector(right, side * (v.halfExtents.x + V.exitClear));
      if (side === 0) out.addScaledVector(v.forward(_v).setY(0).normalize(), v.halfExtents.z + V.exitClear);
      const gy = ctx.collision.groundBelow(out.x, v.pos.y + 3, out.z, 200);
      out.y = (gy ?? ctx.groundHeight(out.x, out.z)) + 0.05;
      if (!ctx.physics.capsuleBlocked(out.clone().setY(out.y + 0.95), 0.6, 0.35)) {
        placed = true;
        break;
      }
    }
    if (!placed && !force) return false;
    v.seats[s.seat] = null;
    s.vehicleId = -1;
    s.seat = -1;
    s.enclosed = false;
    s.state = v.aircraft && out.y - ctx.groundHeight(out.x, out.z) > 4 ? 'air' : 'ground';
    s.collider?.setEnabled(true);
    teleport(s, out);
    s.vel.copy(v.vel).multiplyScalar(V.handling.exitCarry);
    s.fallStartY = s.pos.y;
    setStance(s, 'stand', ctx.physics);
    return true;
  }

  // ---- Per tick ------------------------------------------------------------------------------
  step(dt: number, ctx: VehicleContext): void {
    for (const p of this.pads) {
      if (p.vehicle) continue;
      p.respawnT -= dt;
      if (p.respawnT <= 0) {
        // Only when the pad is clear.
        const blocked = this.list.some((v) => v.pos.distanceTo(p.pos) < V.handling.padClearRadius);
        if (!blocked) {
          p.vehicle = this.spawn(p.kind, p.team, p.pos, p.yaw, ctx.physics);
          p.vehicle.pad = { pos: p.pos, yaw: p.yaw, team: p.team };
        }
      }
    }
    for (let i = this.list.length - 1; i >= 0; i--) {
      const v = this.list[i];
      v.prevPos.copy(v.pos);
      v.prevQuat.copy(v.quat);
      if (!v.alive) {
        v.wreckT += dt;
        v.body.setLinvel({ x: 0, y: Math.min(0, v.vel.y - 9.8 * dt), z: 0 }, true);
        v.vel.y = Math.min(0, v.vel.y - 9.8 * dt);
        if (v.wreckT > V.wreckSeconds) this.despawn(v, ctx.physics);
        continue;
      }
      v.empT = Math.max(0, v.empT - dt);
      v.cm.cooldown = Math.max(0, v.cm.cooldown - dt);
      v.cm.activeT = Math.max(0, v.cm.activeT - dt);
      v.lockWarnT = Math.max(0, v.lockWarnT - dt);
      // Self-repair to a floor after a quiet spell; burning below the threshold.
      if (ctx.time - v.lastDamageT > V.selfRepairDelay && v.hp < v.maxHp * V.selfRepairTo) v.hp = Math.min(v.maxHp * V.selfRepairTo, v.hp + V.selfRepairRate * dt);
      if (v.hp < v.maxHp * V.burnBelow) {
        v.hp -= V.burnRate * dt;
        if (Math.random() < dt * 8) ctx.vfx.burst(v.pos.clone().setY(v.pos.y + v.model.centerY * 1.5), { count: 2, color: 0x2a2428, color2: 0x5a4a48, speed: [0.5, 2], up: 2, life: [1, 2], size: [0.6, 1.2], sizeEnd: 2, shape: 'puff', additive: false });
        if (v.hp <= 0) {
          this.destroy(v, v.lastAttacker, ctx);
          continue;
        }
      }
      // Seat commands.
      const drv = v.driver;
      if (drv && drv.input.fireMode && v.cm.charges > 0 && v.cm.cooldown <= 0) this.countermeasure(v, ctx);
      if (v.kind === 'condor' && drv && drv.input.reload) v.forwardFlight = !v.forwardFlight;
      if (v.aircraft) this.fly(v, dt, ctx);
      else this.hover(v, dt, ctx);
      this.stepMounts(v, dt, ctx);
    }
  }

  /** Hover vehicles: four raycast springs, arcade drive, tilt to the ground under the pads. */
  private hover(v: Vehicle, dt: number, ctx: VehicleContext): void {
    const T = V[v.kind as 'wisp' | 'basalt'];
    const drv = v.driver;
    const inp = drv && v.empT <= 0 ? drv.input : null;
    // Pads.
    const pads = v.model.pads;
    let n = 0;
    let sumH = 0;
    const exclude = v.collider;
    for (let i = 0; i < pads.length && i < 4; i++) {
      _v.copy(pads[i]).applyQuaternion(v.quat).add(v.pos);
      _v.y += 1;
      const hit = ctx.physics.ray(_v, _down, T.hoverHeight * 3 + 1, groups(G.VEHICLE, G.STATIC | G.DESTRUCT | G.VEHICLE), exclude);
      if (hit) {
        sumH += hit.dist - 1;
        _hits[n].copy(_v).setY(_v.y - hit.dist);
        n++;
      }
    }
    v.grounded = n > 0;
    if (n > 0) {
      const h = sumH / n;
      v.vel.y += (T.spring * (T.hoverHeight - h) - T.damping * v.vel.y) * dt;
    } else v.vel.y -= TUNING.movement.gravity * dt;
    // Ground normal from the pad hits.
    _n.set(0, 1, 0);
    if (n === 4) {
      _v2.subVectors(_hits[3], _hits[0]);
      _v3.subVectors(_hits[2], _hits[1]);
      _n.crossVectors(_v2, _v3).normalize();
      if (_n.y < 0) _n.negate();
    }
    // Drive.
    const mob = v.comps.mobility < V.componentCrippled ? V.crippledSpeedMul : 1;
    const eng = v.comps.engine < V.componentCrippled ? V.crippledSpeedMul : 1;
    const throttle = inp ? inp.moveZ : 0;
    const steer = inp ? inp.moveX : 0;
    const brake = inp ? inp.jumpHeld : true;
    _fwd.set(-Math.sin(v.yaw), 0, -Math.cos(v.yaw));
    _right.set(Math.cos(v.yaw), 0, -Math.sin(v.yaw));
    let vf = v.vel.x * _fwd.x + v.vel.z * _fwd.z;
    let vr = v.vel.x * _right.x + v.vel.z * _right.z;
    const target = throttle > 0 ? T.maxSpeed * throttle * eng : throttle < 0 ? -T.reverseSpeed : 0;
    const rate = brake || Math.sign(target) !== Math.sign(vf) ? T.brake : T.accel;
    vf += clamp(target - vf, -rate * dt, rate * dt);
    if (brake) vf *= Math.max(0, 1 - V.handling.brakeDecay * dt);
    vr *= Math.exp(-(v.grounded ? T.grip : T.grip * V.handling.airGripMul) * dt);
    vf *= 1 - T.drag * dt * 0.1;
    const turnK = clamp(Math.abs(vf) / 4 + 0.35, 0, 1) * mob;
    v.yaw -= steer * T.turnRate * turnK * dt * (vf < -0.5 ? -1 : 1);
    v.vel.x = _fwd.x * vf + _right.x * vr;
    v.vel.z = _fwd.z * vf + _right.z * vr;
    // Orientation: yaw, then lean toward the ground normal with a little banking.
    _q.setFromAxisAngle(_up, v.yaw);
    _q2.setFromUnitVectors(_up, _n);
    _q.premultiply(_q2);
    _e.set(0, 0, -steer * T.tilt * clamp(Math.abs(vf) / T.maxSpeed, 0, 1));
    _q.multiply(_q2.setFromEuler(_e));
    v.quat.slerp(_q, Math.min(1, dt * 8));
    this.apply(v);
  }

  /** Arcade flight: heading from the pilot's look, pitch and roll from the stick, climb keys. */
  private fly(v: Vehicle, dt: number, ctx: VehicleContext): void {
    const isCondor = v.kind === 'condor';
    const T = isCondor ? V.condor : V.midge;
    const drv = v.driver;
    const inp = drv && v.empT <= 0 ? drv.input : null;
    const ground = ctx.groundHeight(v.pos.x, v.pos.z);
    const alt = v.pos.y - ground;
    const eng = v.comps.engine < V.componentCrippled ? V.crippledSpeedMul : 1;
    if (inp) {
      const dy = wrapAngle(inp.yaw - v.yaw);
      v.yaw += clamp(dy, -T.yawRate * dt, T.yawRate * dt);
      const fwdSpeed = isCondor ? (v.forwardFlight ? V.condor.forwardSpeed : V.condor.hoverSpeed) : V.midge.forwardSpeed;
      _fwd.set(-Math.sin(v.yaw), 0, -Math.cos(v.yaw));
      _right.set(Math.cos(v.yaw), 0, -Math.sin(v.yaw));
      const climb = ((inp.jumpHeld ? 1 : 0) - (inp.sprint ? 1 : 0)) * T.climb;
      _v.copy(_fwd).multiplyScalar(inp.moveZ * fwdSpeed * eng).addScaledVector(_right, inp.moveX * fwdSpeed * 0.45 * eng);
      _v.y = climb;
      // Forward flight keeps a little speed and loses no altitude.
      if (isCondor && v.forwardFlight && inp.moveZ <= 0) _v.addScaledVector(_fwd, fwdSpeed * V.handling.cruiseGlide);
      v.vel.lerp(_v, Math.min(1, T.accel * dt * V.handling.flightResponse));
      const tp = -inp.moveZ * T.maxPitch * (isCondor && v.forwardFlight ? 0.5 : 1);
      const tr = -inp.moveX * T.maxRoll - dy * 0.6;
      v.pitch += (tp - v.pitch) * Math.min(1, T.pitchRate * dt);
      v.roll += (clamp(tr, -T.maxRoll, T.maxRoll) - v.roll) * Math.min(1, T.pitchRate * dt);
      // Ground cushion: no flying into the ground while the pilot is not descending.
      if (alt < T.minAltitude && v.vel.y < 0 && !inp.sprint) v.vel.y *= V.handling.groundCushion;
    } else {
      // Unmanned: settle down.
      const H = V.handling;
      v.vel.x *= Math.max(0, 1 - dt * H.unmannedDrag);
      v.vel.z *= Math.max(0, 1 - dt * H.unmannedDrag);
      v.vel.y = alt > 0.5 ? Math.max(v.vel.y - H.unmannedSink * dt, -H.unmannedSink) : 0;
      v.pitch *= 0.95;
      v.roll *= 0.95;
    }
    v.grounded = alt < 0.6;
    _e.set(v.pitch, v.yaw, v.roll, 'YXZ');
    v.quat.setFromEuler(_e);
    v.rotorAngle += dt * (drv ? 28 : 6);
    this.apply(v);
  }

  /** External push (storm winds): adds velocity on top of the drive for this tick. */
  push(v: Vehicle, dx: number, dy: number, dz: number): void {
    if (!v.alive) return;
    v.vel.x += dx;
    v.vel.y += dy;
    v.vel.z += dz;
    v.body.setLinvel({ x: v.vel.x, y: v.vel.y, z: v.vel.z }, true);
    this.intended.get(v.id)?.copy(v.vel);
  }

  /** Pushes the intended velocity and rotation into the rigid body. */
  private apply(v: Vehicle): void {
    v.body.setLinvel({ x: v.vel.x, y: v.vel.y, z: v.vel.z }, true);
    v.body.setRotation({ x: v.quat.x, y: v.quat.y, z: v.quat.z, w: v.quat.w }, true);
    let iv = this.intended.get(v.id);
    if (!iv) this.intended.set(v.id, (iv = new THREE.Vector3()));
    iv.copy(v.vel);
  }

  /** After the physics step: read back, crash damage, run-overs, occupants follow. */
  postPhysics(dt: number, ctx: VehicleContext): void {
    for (const v of this.list) {
      const t = v.body.translation();
      v.pos.set(t.x, t.y, t.z);
      const actual = _v.subVectors(v.pos, v.prevPos).multiplyScalar(1 / dt);
      const iv = this.intended.get(v.id);
      if (iv && v.alive) {
        // Crashes count horizontal speed lost against an obstacle (hover springs only move vertically).
        const lost = Math.hypot(iv.x - actual.x, iv.z - actual.z);
        if (lost > V.crashSpeed && Math.hypot(iv.x, iv.z) > V.crashSpeed) {
          this.damage(v, (lost - V.crashSpeed) * V.crashDamage, null, ctx, false);
          v.vel.copy(actual);
          dustKick(ctx.vfx, v.pos, 1.5);
        } else if (lost > 2) v.vel.copy(actual).lerp(iv, 0.2);
      }
      v.updateInverse();
      // Run over enemies (ground vehicles).
      const speed = Math.hypot(v.vel.x, v.vel.z);
      if (v.alive && !v.aircraft && speed > V.roadkillSpeed) {
        const drv = v.driver;
        for (const s of ctx.soldiers) {
          if (!s.alive || s.inVehicle || (drv && s.team === drv.team)) continue;
          if (this.distToHull(v, _v3.copy(s.pos).setY(s.pos.y + 0.9)) > 0.4) continue;
          damageSoldier(ctx, s, speed * V.roadkillDamage, { attacker: drv, weapon: VEHICLES[v.kind].name, part: 'body', explosive: false, from: v.pos.clone(), armorMul: 1 });
          s.vel.copy(v.vel).multiplyScalar(V.handling.roadkillCarry).setY(V.handling.roadkillToss);
        }
      }
      // Occupants ride along.
      for (let i = 0; i < v.seats.length; i++) {
        const s = v.seats[i];
        if (!s) continue;
        v.seatWorld(i, _v3);
        s.prevPos.copy(s.pos);
        s.pos.set(_v3.x, _v3.y - 0.9, _v3.z);
        s.vel.copy(v.vel);
      }
    }
  }

  // ---- Weapons -------------------------------------------------------------------------------
  private stepMounts(v: Vehicle, dt: number, ctx: VehicleContext): void {
    const crippled = v.comps.weapons < V.componentCrippled ? V.crippledFireMul : 1;
    for (let i = 0; i < v.mounts.length; i++) {
      const m = v.mounts[i];
      const s = v.seats[i];
      m.cooldown = Math.max(0, m.cooldown - dt);
      m.overheatT = Math.max(0, m.overheatT - dt);
      if (m.kind === 'coax' || m.kind === 'chin' || m.kind === 'minigun' || m.kind === 'doorgun') {
        const cool = VW[m.kind].cool;
        if (!s || !s.input.fire) m.heat = Math.max(0, m.heat - cool * dt);
      }
      if (m.kind === 'cannon' && m.ammo <= 0) {
        m.reloadT -= dt * crippled;
        if (m.reloadT <= 0) m.ammo = 1;
      }
      if (m.kind === 'rockets' && m.ammo <= 0 && m.salvoLeft <= 0) {
        m.reloadT -= dt * crippled;
        if (m.reloadT <= 0) m.ammo = VW.rockets.salvo;
      }
      if (!s || !m.kind || m.kind === 'personal') continue;
      // Aim: turret and chin mounts traverse toward the occupant's look.
      const relYaw = wrapAngle(s.input.yaw - v.yaw);
      const speed = m.kind === 'cannon' ? V.basalt.turretSpeed : m.kind === 'chin' ? V.condor.chinSpeed : V.handling.gunTraverse;
      m.yaw += clamp(wrapAngle(relYaw - m.yaw), -speed * dt, speed * dt);
      const pMin = m.kind === 'cannon' ? V.basalt.barrelMin : m.kind === 'chin' ? V.condor.chinPitchMin : V.handling.gunPitch[0];
      const pMax = m.kind === 'cannon' ? V.basalt.barrelMax : m.kind === 'chin' ? V.condor.chinPitchMax : V.handling.gunPitch[1];
      m.pitch += clamp(clamp(s.input.pitch - v.pitch, pMin, pMax) - m.pitch, -speed * dt, speed * dt);
      if (v.empT > 0) continue;
      this.fireMount(v, m, s, crippled, ctx);
    }
  }

  /** World muzzle position and direction for a mount. */
  muzzle(v: Vehicle, m: Mount, out: THREE.Vector3, dir: THREE.Vector3): void {
    const md = v.model;
    let local: THREE.Vector3;
    if (m.kind === 'cannon') local = new THREE.Vector3(0, 2.2, 0).add(new THREE.Vector3(0, 0, md.muzzleMain.z).applyAxisAngle(new THREE.Vector3(1, 0, 0), m.pitch).applyAxisAngle(_up, m.yaw));
    else if (m.kind === 'coax') local = new THREE.Vector3(0.6, 2.6, 0.6).add(new THREE.Vector3(0, 0, -0.9).applyAxisAngle(_up, m.yaw));
    else if (m.kind === 'chin') local = new THREE.Vector3(0, 1.0, -3.6).add(new THREE.Vector3(0, 0, md.muzzleChin.z).applyAxisAngle(new THREE.Vector3(1, 0, 0), m.pitch).applyAxisAngle(_up, m.yaw));
    else if (m.kind === 'rockets' || m.kind === 'minigun') local = (md.muzzleRockets[m.side % Math.max(1, md.muzzleRockets.length)] ?? new THREE.Vector3(0, 1, -2)).clone();
    else local = md.seats[1]?.clone().add(new THREE.Vector3(-0.6, 0.4, 0)) ?? new THREE.Vector3();
    out.copy(local).applyQuaternion(v.quat).add(v.pos);
    if (m.kind === 'rockets' || m.kind === 'minigun') viewDir(v.yaw, v.pitch + (m.kind === 'minigun' ? m.pitch * 0.5 : 0), dir);
    else if (m.kind === 'doorgun') viewDir(v.seats[1]?.input.yaw ?? v.yaw, v.seats[1]?.input.pitch ?? 0, dir);
    else dir.set(0, 0, -1).applyAxisAngle(new THREE.Vector3(1, 0, 0), m.pitch).applyAxisAngle(_up, m.yaw).applyQuaternion(v.quat);
  }

  private fireMount(v: Vehicle, m: Mount, s: Soldier, crippled: number, ctx: VehicleContext): void {
    const inp = s.input;
    const mz = _v;
    const dir = _v2;
    if (m.kind === 'cannon') {
      if (!inp.firePressed || m.ammo <= 0 || m.cooldown > 0) return;
      this.muzzle(v, m, mz, dir);
      const C = VW.cannon;
      ctx.projectiles.spawn('shell', mz, dir, C.velocity, s, this.stats.cannon, { weaponName: 'Basalt cannon', ignore: v, splash: { damage: C.splashDamage, radius: C.splashRadius, inner: 1.2, vehicle: C.vehicleDamage }, directDamage: C.damage, vehicleDamage: C.vehicleDamage, energy: 'kinetic', tracer: true });
      muzzleFlash(ctx.vfx, mz, dir, 'kinetic', 3, true);
      dustKick(ctx.vfx, v.pos, 1);
      ctx.events.emit('mountShot', { soldier: s, kind: 'cannon', pos: mz.clone() });
      m.ammo = 0;
      m.reloadT = C.reload;
      m.cooldown = C.refire;
      s.lastCombatT = ctx.time;
      return;
    }
    if (m.kind === 'rockets') {
      const R = VW.rockets;
      if (inp.firePressed && m.ammo > 0 && m.salvoLeft <= 0) m.salvoLeft = Math.min(R.burst, m.ammo);
      if (m.salvoLeft <= 0 || m.cooldown > 0) return;
      this.muzzle(v, m, mz, dir);
      coneDir(dir, R.spread, ctx.rng.next(), ctx.rng.next(), _v3);
      const trail = new Trail(0xffb060, 0.12, 14);
      trail.emitting = true;
      const p = ctx.projectiles.spawn('rocket', mz, _v3, R.velocity, s, this.stats.rockets, { weaponName: 'Condor rockets', ignore: v, trail, splash: { damage: R.splashDamage, radius: R.splashRadius, inner: 1, vehicle: R.vehicleDamage }, directDamage: R.damage, vehicleDamage: R.vehicleDamage, life: 4, tracer: false });
      if (p) ctx.vfx.addTrail(trail, () => p.pos, () => !p.active);
      muzzleFlash(ctx.vfx, mz, dir, 'rocket', 1.2, false);
      ctx.events.emit('mountShot', { soldier: s, kind: 'rockets', pos: mz.clone() });
      m.side++;
      m.ammo--;
      m.salvoLeft--;
      m.cooldown = R.interval / crippled;
      if (m.ammo <= 0) m.reloadT = R.reload;
      s.lastCombatT = ctx.time;
      return;
    }
    // Heat-limited automatic mounts.
    const M = VW[m.kind as 'coax' | 'chin' | 'minigun' | 'doorgun'];
    if (!inp.fire || m.overheatT > 0 || m.cooldown > 0) return;
    let shots = 0;
    const interval = (60 / M.rpm) / crippled;
    while (m.cooldown <= 0 && shots < 4) {
      m.cooldown += interval;
      shots++;
      this.muzzle(v, m, mz, dir);
      coneDir(dir, M.spread, ctx.rng.next(), ctx.rng.next(), _v3);
      const st = this.stats[m.kind as 'coax'];
      const splash = m.kind === 'chin' ? { damage: VW.chin.splashDamage, radius: VW.chin.splashRadius, inner: 0.5, vehicle: 30 } : null;
      ctx.projectiles.spawn(m.kind === 'chin' ? 'cannon' : 'bullet', mz, _v3, M.velocity, s, st, { weaponName: m.kind === 'coax' ? 'Coax beam' : m.kind === 'chin' ? 'Chin turret' : m.kind === 'minigun' ? 'Miniguns' : 'Door gun', ignore: v, tracer: m.side++ % 2 === 0, splash, energy: st.energy });
      if (shots === 1) {
        muzzleFlash(ctx.vfx, mz, dir, st.energy, m.kind === 'chin' ? 1.4 : 0.9, false);
        ctx.events.emit('mountShot', { soldier: s, kind: m.kind ?? 'coax', pos: mz.clone() });
      }
      m.heat += M.heatPerShot;
      if (m.heat >= 1) {
        m.heat = 1;
        m.overheatT = VW.overheatLock;
        break;
      }
    }
    s.lastCombatT = ctx.time;
    s.firedUntil = ctx.time + V.handling.firingHeard;
  }

  // ---- Countermeasures and locks -------------------------------------------------------------
  private countermeasure(v: Vehicle, ctx: VehicleContext): void {
    const C = V.countermeasures;
    v.cm.charges--;
    v.cm.cooldown = C.cooldown;
    v.cm.activeT = C.duration;
    if (v.cm.charges <= 0) v.cm.charges = C.charges;
    // Flares (aircraft) or smoke (ground): break homing in range.
    for (let i = 0; i < 6; i++) {
      _v.set((Math.random() - 0.5) * 6, v.aircraft ? -1 - Math.random() * 2 : 1, (Math.random() - 0.5) * 6).add(v.pos);
      if (v.aircraft) ctx.vfx.flash(_v, 0xffd070, 2.2, 0.8);
      else ctx.vfx.burst(_v, { count: 3, color: 0xc8c0b8, color2: 0x908880, speed: [1, 3], up: 1, life: [2.5, 4], size: [1.5, 2.6], sizeEnd: 3.5, shape: 'puff', additive: false });
    }
    for (const p of ctx.projectiles.list) {
      if (!p.active || !p.homing) continue;
      if (p.pos.distanceTo(v.pos) < C.breakRadius) p.homing = null;
    }
  }

  /** Launcher lock-on target: the enemy vehicle closest to the view axis inside the lock cone. */
  lockCandidate(s: Soldier, eye: THREE.Vector3, yaw: number, pitch: number): { id: unknown; pos(): THREE.Vector3 | null } | null {
    const R = TUNING.weapons.rocket;
    const look = viewDir(yaw, pitch, _fwd);
    let best: Vehicle | null = null;
    let ba = (R.lockCone * Math.PI) / 180;
    for (const v of this.list) {
      if (!v.alive || v.crewCount === 0 || v.team === s.team || v.cm.activeT > 0) continue;
      _v.copy(v.pos).setY(v.pos.y + v.model.centerY).sub(eye);
      const d = _v.length();
      if (d > R.lockRange) continue;
      const a = Math.acos(clamp(_v.dot(look) / d, -1, 1));
      if (a < ba) {
        ba = a;
        best = v;
      }
    }
    if (!best) return null;
    const v = best;
    v.lockWarnT = V.lockWarnHold;
    return { id: v, pos: () => (v.alive && v.cm.activeT <= 0 ? new THREE.Vector3(v.pos.x, v.pos.y + v.model.centerY, v.pos.z) : null) };
  }

  // ---- Damage --------------------------------------------------------------------------------
  /** Damage from a projectile or object hit; true when the ref was a vehicle. */
  damageRef(ref: unknown, vehicleDamage: number, attacker: Soldier | null, ctx: VehicleContext, at: THREE.Vector3): boolean {
    if (!(ref instanceof Vehicle)) return false;
    if (attacker && attacker.team === ref.team && ref.crewCount > 0) return true;
    this.damage(ref, vehicleDamage, attacker, ctx, false);
    shieldSpark(ctx.vfx, at, _v.set(0, 1, 0), 0xffd070);
    return true;
  }

  radiusDamage(pos: THREE.Vector3, radius: number, vehicleDamage: number, attacker: Soldier | null, ctx: VehicleContext): void {
    if (vehicleDamage <= 0) return;
    for (const v of this.list) {
      if (!v.alive) continue;
      const d = this.distToHull(v, pos);
      if (d > radius) continue;
      if (attacker && attacker.team === v.team && v.crewCount > 0 && attacker.vehicleId !== v.id) continue;
      this.damage(v, vehicleDamage * (1 - d / radius), attacker, ctx, true);
    }
  }

  damage(v: Vehicle, amount: number, attacker: Soldier | null, ctx: VehicleContext, explosive: boolean): void {
    if (!v.alive || amount <= 0) return;
    v.hp -= amount;
    v.lastDamageT = ctx.time;
    if (attacker) v.lastAttacker = attacker;
    for (const s of v.seats) if (s) s.lastCombatT = ctx.time;
    // Heavy hits can damage a component.
    if ((explosive || amount > V.componentHitMin) && ctx.rng.next() < V.componentChance) {
      const keys = ['engine', 'weapons', 'mobility'] as const;
      const k = keys[Math.floor(ctx.rng.next() * 3)];
      v.comps[k] = Math.max(0, v.comps[k] - V.componentDamage);
    }
    if (v.hp <= 0) this.destroy(v, attacker, ctx);
  }

  /** Arc Tool on a vehicle: repairs a friendly one, overloads an enemy one. Returns true when handled. */
  arc(by: Soldier, ref: unknown, dt: number, ctx: VehicleContext): boolean {
    if (!(ref instanceof Vehicle) || !ref.alive) return false;
    const A = TUNING.gadgets.arctool;
    if (ref.team === by.team || ref.crewCount === 0) {
      const before = ref.hp;
      ref.hp = Math.min(ref.maxHp, ref.hp + A.repairPerSecond * dt);
      for (const k of ['engine', 'weapons', 'mobility'] as const) ref.comps[k] = Math.min(1, ref.comps[k] + dt * V.arcComponentRepair);
      const fixed = ref.hp - before;
      if (fixed > 0) {
        by.stats.score += fixed * TUNING.sector.score.repairPerPoint;
        if (Math.random() < dt * 2) ctx.events.emit('score', { soldier: by, amount: Math.max(1, Math.round(fixed * TUNING.sector.score.repairPerPoint * 30)), reason: 'Repair' });
      }
    } else {
      this.damage(ref, A.empPerSecond * dt, by, ctx, false);
      ref.empT = Math.max(ref.empT, A.disable * V.arcEmpShare);
    }
    return true;
  }

  /** EMP: vehicles in range lose drive and weapons for a while. */
  emp(pos: THREE.Vector3, radius: number, team: number): void {
    for (const v of this.list) if (v.alive && v.team !== team && this.distToHull(v, pos) < radius) v.empT = Math.max(v.empT, TUNING.throwables.emp.disable);
  }

  private destroy(v: Vehicle, killer: Soldier | null, ctx: VehicleContext): void {
    if (!v.alive) return;
    v.alive = false;
    v.hp = 0;
    v.wreckT = 0;
    const X = V.explosion;
    const center = v.pos.clone().setY(v.pos.y + v.model.centerY);
    // Crew dies with the vehicle.
    for (let i = 0; i < v.seats.length; i++) {
      const s = v.seats[i];
      if (!s) continue;
      this.exit(s, ctx, true);
      damageSoldier(ctx, s, 999, { attacker: killer, weapon: `${VEHICLES[v.kind].name} wreck`, part: null, explosive: true, from: center, armorMul: 1 });
    }
    explode(ctx, center, { radius: X.radius, damage: X.damage, inner: X.inner, attacker: killer, weapon: `${VEHICLES[v.kind].name} explosion`, kind: 'fuel', vehicleDamage: X.vehicleDamage });
    ctx.vfx.debris(center, [0x2e3038, 0x5a5f6e, 0x1a1a1e], 18, { size: [0.2, 0.7], speed: [4, 12], up: 6 });
    // The wreck's lights die.
    v.model.glowMat.color.setRGB(0.05, 0.03, 0.03);
    ctx.events.emit('vehicleDestroyed', { pos: center, kind: v.kind, killer });
    if (killer && killer.team !== v.team) {
      killer.stats.vehicleKills++;
      killer.stats.score += TUNING.sector.score.vehicleKill;
      ctx.events.emit('score', { soldier: killer, amount: TUNING.sector.score.vehicleKill, reason: 'Vehicle destroyed' });
    }
  }

  // ---- Ray target ----------------------------------------------------------------------------
  raycast(o: THREE.Vector3, d: THREE.Vector3, max: number, ignore: unknown, out: Hit): boolean {
    let best = max;
    let found: Vehicle | null = null;
    for (const v of this.list) {
      if (v === ignore) continue;
      if (_v.copy(v.pos).distanceTo(o) > max + 12) continue;
      const t = rayObb(o, d, v.inv, v.halfExtents, best, _n);
      if (t >= 0 && t < best) {
        best = t;
        found = v;
      }
    }
    if (!found) return false;
    out.dist = best;
    out.point.copy(o).addScaledVector(d, best);
    out.normal.copy(d).negate();
    out.surface = 'metal';
    out.kind = 'vehicle';
    out.box = null;
    out.ref = found;
    out.part = null;
    out.thin = false;
    return true;
  }

  // ---- Rendering -----------------------------------------------------------------------------
  render(alpha: number): void {
    for (const v of this.list) {
      const r = v.model.root;
      r.position.copy(v.prevPos).lerp(v.pos, alpha);
      r.quaternion.copy(v.prevQuat).slerp(v.quat, alpha);
      const m0 = v.mounts.find((m) => m.kind === 'cannon');
      if (v.model.turret && m0) v.model.turret.rotation.y = m0.yaw;
      if (v.model.barrel && m0) v.model.barrel.rotation.x = m0.pitch;
      const chin = v.mounts.find((m) => m.kind === 'chin');
      if (v.model.chin && chin) v.model.chin.rotation.y = chin.yaw;
      if (v.model.chinGun && chin) v.model.chinGun.rotation.x = chin.pitch;
      if (v.model.rotor) v.model.rotor.rotation.y = v.rotorAngle;
      if (v.model.tailRotor) v.model.tailRotor.rotation.x = v.rotorAngle * 1.6;
      const tilt = v.kind === 'condor' ? (v.forwardFlight ? -Math.PI / 2 * 0.85 : 0) : 0;
      for (const n of v.model.nacelles) n.rotation.x += (tilt - n.rotation.x) * 0.1;
    }
  }
}
