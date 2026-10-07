// Bot vehicle crews. Bots on long trips board pad vehicles, airdrops and squadmates' vehicles;
// drivers follow navmesh paths with whisker avoidance and reverse out of jams; gunners pick
// targets in their mount's range and fire with heat discipline; pilots orbit the squad objective
// on a circular route and make diving attack runs before pulling out; soldiers on foot switch to
// the launcher and lock on to enemy vehicles; squad leaders request airdrops for long trips.
import * as THREE from 'three';
import { TUNING } from '../config/tuning';
import { AimState, turnToward, type AimProfile } from './aim';
import { yawOf, wrapAngle, clamp, viewDir, DEG } from '../core/math';
import { chestPoint } from '../weapons/hitboxes';
import type { Vehicle, Mount } from '../vehicles/vehicle';
import type { VehicleSystem } from '../vehicles/system';
import type { BotBrain } from './brain';
import type { Soldier } from '../player/soldier';
import type { Rng } from '../core/rng';
import type { CallInKind } from '../gadgets/callins';

const C = TUNING.ai.crews;
const V = TUNING.vehicles;
const VW = V.weapons;

export interface CrewHost {
  readonly time: number;
  readonly soldiers: readonly Soldier[];
  readonly vehicles: VehicleSystem;
  readonly rng: Rng;
  readonly profile: AimProfile;
  canSee(from: THREE.Vector3, to: THREE.Vector3): boolean;
  groundHeight(x: number, z: number): number;
  /** Distance to the first world obstacle along a ray (Infinity when clear). */
  probe(from: THREE.Vector3, dir: THREE.Vector3, max: number, ignore: unknown): number;
  requestPath(b: BotBrain, to: THREE.Vector3): void;
  enterVehicle(s: Soldier, v: Vehicle, seat: number): boolean;
  exitVehicle(s: Soldier): boolean;
  switchSeat(s: Soldier, seat: number): boolean;
  requestCallIn(s: Soldier, kind: CallInKind): boolean;
  readonly mapLimit: number;
  /** Map hazards (pilots steer around the storm). */
  readonly hazards: readonly { x: number; z: number; r: number; label: string; danger: boolean }[];
}

type Target = { soldier: Soldier | null; vehicle: Vehicle | null };

interface CrewState {
  // Boarding
  board: Vehicle | null;
  boardSeat: number;
  boardT: number;
  checkT: number;
  callinT: number;
  // Driving
  stuckT: number;
  readonly stuckRef: THREE.Vector3;
  reverseT: number;
  stuckCount: number;
  readonly pathGoal: THREE.Vector3;
  pathT: number;
  waitT: number;
  noDriverT: number;
  // Gunnery
  readonly aim: AimState;
  target: Target;
  retargetT: number;
  heatHold: boolean;
  // Pilot
  phase: 'climb' | 'patrol' | 'attack' | 'extend';
  phaseT: number;
  attackCd: number;
  orbitDir: number;
  // Launcher
  av: Vehicle | null;
  avT: number;
  avAligned: number;
  avCheckT: number;
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _mz = new THREE.Vector3();
const _md = new THREE.Vector3();
const _aimPt = new THREE.Vector3();
const _dir = new THREE.Vector3();

/** Projectile speed and gravity scale per mount (for lead and drop). */
function ballistics(kind: Mount['kind']): [number, number] {
  switch (kind) {
    case 'cannon':
      return [VW.cannon.velocity, VW.cannon.gravityMul];
    case 'rockets':
      return [VW.rockets.velocity, 0.2];
    case 'chin':
      return [VW.chin.velocity, 0.3];
    case 'coax':
      return [VW.coax.velocity, 0.2];
    case 'minigun':
      return [VW.minigun.velocity, 0.2];
    case 'doorgun':
      return [VW.doorgun.velocity, 0.2];
    default:
      return [900, 0.2];
  }
}

/** Steering for a hover vehicle toward a point: [steer (moveX), heading error]. Pure, for tests. */
export function steerToward(vehYaw: number, dx: number, dz: number): [number, number] {
  const diff = wrapAngle(yawOf(dx, dz) - vehYaw);
  // Positive moveX turns right, which lowers the yaw.
  return [clamp(-diff * 2, -1, 1), diff];
}

/** Throttle for a heading error and distance to the goal (slows for turns and on arrival). */
export function throttleFor(diff: number, distToGoal: number, arrive: number): number {
  const a = Math.abs(diff);
  const T = C.throttle;
  let t = a > T.sharpTurn ? T.sharpThrottle : clamp(1 - a * T.perRadian, T.min, 1);
  if (distToGoal < arrive * T.arriveSlow) t = Math.min(t, clamp(distToGoal / (arrive * T.arriveSlow), T.arriveMin, 1));
  return t;
}

/** Point on an orbit around (cx, cz) ahead of (x, z) by `lead` radians in direction `dir`. */
export function orbitPoint(cx: number, cz: number, x: number, z: number, radius: number, lead: number, dir: number, out: THREE.Vector3): THREE.Vector3 {
  const a = Math.atan2(z - cz, x - cx) + lead * dir;
  return out.set(cx + Math.cos(a) * radius, 0, cz + Math.sin(a) * radius);
}

export class VehicleCrews {
  private states = new Map<number, CrewState>();
  /** Bots walking to each vehicle (by id). */
  private claims = new Map<number, number>();

  constructor(private host: CrewHost) {}

  private state(s: Soldier): CrewState {
    let st = this.states.get(s.id);
    if (!st) {
      st = {
        board: null, boardSeat: 0, boardT: 0, checkT: this.host.rng.next() * C.boardCheck, callinT: this.host.rng.next() * C.callinCheck,
        stuckT: 0, stuckRef: new THREE.Vector3(), reverseT: 0, stuckCount: 0, pathGoal: new THREE.Vector3(1e9, 0, 0), pathT: 0, waitT: 0, noDriverT: 0,
        aim: new AimState(), target: { soldier: null, vehicle: null }, retargetT: 0, heatHold: false,
        phase: 'climb', phaseT: 0, attackCd: 0, orbitDir: this.host.rng.next() < 0.5 ? -1 : 1,
        av: null, avT: 0, avAligned: 0, avCheckT: this.host.rng.next(),
      };
      this.states.set(s.id, st);
    }
    return st;
  }

  /** Called every tick for each bot after its brain wrote the command. */
  step(b: BotBrain, dt: number, objective: { pos: THREE.Vector3; radius: number } | null): void {
    const s = b.s;
    const st = this.state(s);
    if (!s.active) {
      this.release(b, st);
      this.releaseLauncher(b, st);
      st.stuckCount = 0;
      st.phase = 'climb';
      return;
    }
    const v = this.host.vehicles.vehicleOf(s);
    if (v) {
      this.release(b, st);
      this.releaseLauncher(b, st);
      this.seated(b, st, v, dt, objective);
      return;
    }
    b.seatCombat = false;
    st.phase = 'climb';
    st.stuckCount = 0;
    st.waitT = 0;
    this.launcher(b, st, dt);
    if (!st.av) this.boarding(b, st, dt, objective);
  }

  // ---- On foot -------------------------------------------------------------------------------
  private release(b: BotBrain, st: CrewState): void {
    if (!st.board) return;
    this.claims.set(st.board.id, Math.max(0, (this.claims.get(st.board.id) ?? 1) - 1));
    st.board = null;
    if (b.detour) b.detour = null;
  }

  private freeSeats(v: Vehicle): number {
    let n = 0;
    for (const x of v.seats) if (!x) n++;
    return n - (this.claims.get(v.id) ?? 0);
  }

  private boarding(b: BotBrain, st: CrewState, dt: number, obj: { pos: THREE.Vector3; radius: number } | null): void {
    const s = b.s;
    const h = this.host;
    const vs = h.vehicles;
    if (st.board) {
      const v = st.board;
      st.boardT -= dt;
      const taken = v.seats[st.boardSeat] !== null;
      if (!v.alive || st.boardT <= 0 || b.mode !== 'objective' || (v.crewCount > 0 && v.team !== s.team)) {
        this.release(b, st);
        return;
      }
      if (taken) {
        const free = v.seats.indexOf(null);
        if (free < 0) {
          this.release(b, st);
          return;
        }
        st.boardSeat = free;
      }
      b.detour = v.pos;
      if (vs.distToHull(v, _v.copy(s.pos).setY(s.pos.y + 0.9)) < V.enterRange) {
        const seat = st.boardSeat;
        this.release(b, st);
        h.enterVehicle(s, v, seat);
      }
      return;
    }
    st.checkT -= dt;
    st.callinT -= dt;
    if (st.checkT > 0 || b.mode !== 'objective' || !obj) return;
    st.checkT = C.boardCheck * (0.8 + h.rng.next() * 0.4);
    const trip = Math.hypot(obj.pos.x - s.pos.x, obj.pos.z - s.pos.z);
    if (trip < C.joinTrip) return;
    let best: Vehicle | null = null;
    let bestSeat = -1;
    let bestScore = 0;
    for (const v of vs.list) {
      if (!v.alive || this.freeSeats(v) <= 0) continue;
      if (v.crewCount > 0 && v.team !== s.team) continue;
      const d = Math.hypot(v.pos.x - s.pos.x, v.pos.z - s.pos.z);
      if (d > C.enterRange) continue;
      const drv = v.driver;
      let score: number;
      let seat: number;
      if (drv) {
        // A friendly driver: join when close (squadmates first).
        if (d > C.joinRadius) continue;
        seat = v.seats.indexOf(null, 1);
        if (seat < 0) continue;
        score = (drv.squadId === s.squadId ? C.joinSquadBias : C.joinOtherBias) - d / 100;
      } else {
        if (trip < C.minTripDistance) continue;
        seat = 0;
        const roll = h.rng.next();
        if (v.aircraft && roll > C.aircraftChance) continue;
        if (v.kind === 'basalt' && roll > C.basaltChance) continue;
        score = 1 - d / 100;
        // Someone already claimed the driver seat: take a passenger seat instead.
        if ((this.claims.get(v.id) ?? 0) > 0) {
          seat = v.seats.indexOf(null, 1);
          if (seat < 0) continue;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        best = v;
        bestSeat = seat;
      }
    }
    if (best) {
      st.board = best;
      st.boardSeat = bestSeat;
      st.boardT = C.boardTimeout;
      this.claims.set(best.id, (this.claims.get(best.id) ?? 0) + 1);
      b.detour = best.pos;
      return;
    }
    // Squad leaders on long trips with nothing nearby request an airdrop.
    if (st.callinT <= 0) {
      st.callinT = C.callinCheck * (0.8 + h.rng.next() * 0.4);
      const sq = b.squad;
      if (!sq || sq.leader() !== s || trip < C.callinTrip) return;
      for (const v of vs.list) if (v.alive && (v.crewCount === 0 || v.team === s.team) && v.pos.distanceTo(s.pos) < C.callinNoVehicleRadius) return;
      if (h.rng.next() > TUNING.callins.botChance) return;
      const hasBasalt = vs.list.some((v) => v.alive && v.kind === 'basalt' && v.team === s.team);
      h.requestCallIn(s, !hasBasalt && h.rng.next() < 0.4 ? 'basalt' : 'wisp');
    }
  }

  /** Launcher against enemy vehicles: switch, ADS, wait for the lock, fire, reload. */
  private launcher(b: BotBrain, st: CrewState, dt: number): void {
    const s = b.s;
    const h = this.host;
    const a = s.arsenal;
    const lw = a.slots[2];
    if (!lw) return;
    if (!st.av) {
      b.aimOverride = false;
      st.avCheckT -= dt;
      if (st.avCheckT > 0) return;
      st.avCheckT = C.launcherCheck * (1 + h.rng.next() * 0.6);
      if (lw.mag + lw.reserve <= 0) return;
      if (b.target && b.targetVisible && b.target.pos.distanceTo(s.pos) < C.launcherBusyRange) return;
      const eye = s.eyePos;
      let best: Vehicle | null = null;
      let bd = C.antiVehicleRange;
      for (const v of h.vehicles.list) {
        if (!v.alive || v.crewCount === 0 || v.team === s.team) continue;
        const d = v.pos.distanceTo(s.pos);
        if (d > bd) continue;
        if (!h.canSee(eye, _v.copy(v.pos).setY(v.pos.y + v.model.centerY))) continue;
        bd = d;
        best = v;
      }
      if (!best || h.rng.next() > C.launcherChance) return;
      st.av = best;
      st.avT = C.launcherTimeout;
      st.avAligned = 0;
      st.aim.acquire(best.id, bd, h.profile, () => h.rng.next());
    }
    const v = st.av;
    st.avT -= dt;
    const close = b.target && b.targetVisible && b.target.pos.distanceTo(s.pos) < C.launcherBusyRange;
    if (!v.alive || v.crewCount === 0 || st.avT <= 0 || close || (lw.mag + lw.reserve <= 0 && !lw.reloading)) {
      this.releaseLauncher(b, st);
      return;
    }
    b.aimOverride = true;
    const inp = s.input;
    inp.sprint = false;
    if (a.slot !== 2) {
      inp.slot = 2;
      return;
    }
    const eye = s.eyePos;
    _aimPt.copy(v.pos).setY(v.pos.y + v.model.centerY);
    const d = eye.distanceTo(_aimPt);
    _aimPt.addScaledVector(v.vel, d / TUNING.weapons.rocket.maxSpeed);
    const dx = _aimPt.x - eye.x, dy = _aimPt.y - eye.y, dz = _aimPt.z - eye.z;
    const gy = yawOf(dx, dz), gp = Math.atan2(dy, Math.hypot(dx, dz));
    st.aim.update(dt, d, 0, b.suppression, h.profile, () => h.rng.next());
    const err = C.launcherAimError;
    [inp.yaw, inp.pitch] = turnToward(s.yaw, s.pitch, gy + st.aim.errYaw * err, gp + st.aim.errPitch * err, h.profile.turnSpeed * DEG * dt);
    inp.aim = true;
    if (lw.mag <= 0) {
      if (lw.reserve > 0 && !lw.reloading) inp.reload = true;
      return;
    }
    const off = Math.hypot(wrapAngle(s.yaw - gy), s.pitch - gp);
    if (off < C.launcherAlign) st.avAligned += dt;
    else st.avAligned = 0;
    const dumb = d < C.dumbFireRange && st.avAligned > C.dumbFireAfter;
    if (st.aim.reactLeft <= 0 && (lw.locked || dumb) && !lw.reloading && a.equipT <= 0) {
      inp.fire = true;
      inp.firePressed = true;
    }
  }

  private releaseLauncher(b: BotBrain, st: CrewState): void {
    if (!st.av && !b.aimOverride) return;
    st.av = null;
    b.aimOverride = false;
    if (b.s.arsenal?.slot === 2) b.s.input.slot = 0;
  }

  // ---- Seated --------------------------------------------------------------------------------
  private seated(b: BotBrain, st: CrewState, v: Vehicle, dt: number, obj: { pos: THREE.Vector3; radius: number } | null): void {
    const s = b.s;
    const h = this.host;
    const mount = v.mounts[s.seat];
    b.seatCombat = mount?.kind === 'personal';
    // Nobody driving: take the wheel, or get out once it has slowed.
    if (s.seat !== 0) {
      if (v.driver) st.noDriverT = 0;
      else st.noDriverT += dt;
      if (st.noDriverT > C.noDriverSeconds) {
        if (!v.seats[0] && (v.kind !== 'wisp' || h.rng.next() < 0.5) && !this.arrivedAt(v, obj)) h.switchSeat(s, 0);
        else if (Math.hypot(v.vel.x, v.vel.z) < C.exitSpeed) h.exitVehicle(s);
        st.noDriverT = 0;
        return;
      }
    }
    if (s.seat === 0) {
      if (v.aircraft) this.pilot(b, st, v, dt, obj);
      else this.drive(b, st, v, dt, obj);
      return;
    }
    if (mount && mount.kind && mount.kind !== 'personal') this.gunner(b, st, v, mount, dt);
    else if (!b.target || !b.targetVisible) b.s.input.yaw = v.yaw + Math.sin(h.time * 0.4 + s.id) * 1.2;
  }

  private arrivedAt(v: Vehicle, obj: { pos: THREE.Vector3; radius: number } | null): boolean {
    if (!obj) return true;
    return Math.hypot(obj.pos.x - v.pos.x, obj.pos.z - v.pos.z) < Math.max(C.arriveRadius, obj.radius);
  }

  /** Ground vehicle driver: path to the objective, avoid, unstick; the Basalt driver also aims its cannon. */
  private drive(b: BotBrain, st: CrewState, v: Vehicle, dt: number, obj: { pos: THREE.Vector3; radius: number } | null): void {
    const s = b.s;
    const h = this.host;
    const inp = s.input;
    const speed = Math.hypot(v.vel.x, v.vel.z);
    // Bail out of a burning vehicle.
    if (v.hp < v.maxHp * C.bailBelow || st.stuckCount > C.stuckGiveUp) {
      h.exitVehicle(s);
      return;
    }
    const turret = v.mounts[0];
    if (turret?.kind === 'cannon') this.gunner(b, st, v, turret, dt);
    else inp.yaw = v.yaw;
    if (!obj) {
      inp.jumpHeld = true;
      return;
    }
    const arrived = this.arrivedAt(v, obj);
    if (arrived) {
      inp.jumpHeld = true;
      st.stuckT = 0;
      // Light vehicles drop their crew at the objective; the Basalt holds there and fights.
      if (v.kind === 'wisp' && speed < C.exitSpeed) h.exitVehicle(s);
      return;
    }
    // Wait for boarding squadmates before leaving.
    if ((this.claims.get(v.id) ?? 0) > 0 && st.waitT < C.driverWait) {
      st.waitT += dt;
      inp.jumpHeld = true;
      return;
    }
    // Path (re)requests.
    st.pathT -= dt;
    if ((st.pathGoal.distanceTo(obj.pos) > C.repathDistance || (!b.path.length && st.pathT <= 0)) && !b.pathPending) {
      st.pathGoal.copy(obj.pos);
      st.pathT = C.repathEvery;
      b.pathPending = true;
      h.requestPath(b, obj.pos);
    }
    // Current waypoint.
    let wp: THREE.Vector3 = obj.pos;
    while (b.pathIdx < b.path.length) {
      const p = b.path[b.pathIdx];
      if (Math.hypot(p.x - v.pos.x, p.z - v.pos.z) < C.waypointReach && b.pathIdx < b.path.length - 1) b.pathIdx++;
      else {
        wp = p;
        break;
      }
    }
    if (b.pathIdx >= b.path.length - 1 && b.path.length) wp = b.path[b.path.length - 1];
    const aim = steerToward(v.yaw, wp.x - v.pos.x, wp.z - v.pos.z);
    let steer = aim[0];
    const diff = aim[1];
    const goalDist = Math.hypot(obj.pos.x - v.pos.x, obj.pos.z - v.pos.z);
    let throttle = throttleFor(diff, goalDist, C.arriveRadius);
    // Whiskers: steer away from the nearer obstacle; slow down and brake for one straight ahead.
    const reach = C.whiskerBase + speed * C.whiskerPerSpeed;
    _v.copy(v.pos).setY(v.pos.y + C.probeHeight);
    const l = h.probe(_v, viewDir(v.yaw + C.whiskerAngle, 0, _dir), reach, v);
    const r = h.probe(_v, viewDir(v.yaw - C.whiskerAngle, 0, _dir), reach, v);
    const ahead = h.probe(_v, viewDir(v.yaw, 0, _dir), reach * 1.3, v);
    if (l < reach || r < reach) {
      steer = clamp(steer + (l < r ? 1 : -1) * (1 - Math.min(l, r) / reach) * 1.5, -1, 1);
      throttle = Math.min(throttle, 0.6);
    }
    let brake = false;
    if (ahead < reach * 1.3) {
      throttle = Math.min(throttle, clamp(ahead / (reach * 1.3), 0.2, 1));
      brake = ahead < C.brakeBase + speed * C.brakePerSpeed;
      if (Math.abs(steer) < 0.3) steer = l < r ? 1 : -1;
    }
    // A Basalt fighting slows down to shoot.
    if (st.target.soldier || st.target.vehicle) throttle = Math.min(throttle, v.kind === 'basalt' ? 0.45 : 0.8);
    // Stuck: reverse out with the wheel turned the other way.
    if (st.reverseT > 0) {
      st.reverseT -= dt;
      inp.moveZ = -1;
      inp.moveX = diff > 0 ? 1 : -1;
      return;
    }
    // Stuck: too little progress over a window while trying to move.
    if (throttle > 0.3) st.stuckT += dt;
    if (st.stuckT > C.stuckSeconds) {
      st.stuckT = 0;
      if (st.stuckRef.distanceTo(v.pos) < C.stuckDistance) {
        st.stuckCount++;
        st.reverseT = C.reverseSeconds;
        // Skip the waypoint that got us stuck.
        if (b.pathIdx < b.path.length - 1) b.pathIdx++;
      }
      st.stuckRef.copy(v.pos);
    }
    inp.moveZ = brake ? 0 : throttle;
    inp.jumpHeld = brake && speed > 4;
    inp.moveX = steer;
  }

  /** Pilot: take off, orbit the objective, dive on targets, pull out and extend. */
  private pilot(b: BotBrain, st: CrewState, v: Vehicle, dt: number, obj: { pos: THREE.Vector3; radius: number } | null): void {
    const s = b.s;
    const h = this.host;
    const inp = s.input;
    const T = v.kind === 'condor' ? V.condor : V.midge;
    const groundHere = h.groundHeight(v.pos.x, v.pos.z);
    const alt = v.pos.y - groundHere;
    const fwd = viewDir(v.yaw, 0, _dir);
    const [a1, a2] = C.terrainAhead;
    const groundAhead = Math.max(groundHere, h.groundHeight(v.pos.x + fwd.x * a1, v.pos.z + fwd.z * a1), h.groundHeight(v.pos.x + fwd.x * a2, v.pos.z + fwd.z * a2));
    const center = obj?.pos ?? _v2.set(0, 0, 0);
    st.attackCd = Math.max(0, st.attackCd - dt);
    st.phaseT += dt;
    let heading = v.yaw;
    let wantAlt = C.flightAltitude;
    let throttle = C.cruiseThrottle;
    // Targets.
    st.retargetT -= dt;
    if (st.retargetT <= 0) {
      st.retargetT = C.retarget;
      if (st.phase === 'patrol' && st.attackCd <= 0) {
        const t = this.pickTarget(s, v, v.mounts[0]?.kind ?? 'rockets', v.pos, C.searchRange, st.target);
        if (t.soldier || t.vehicle) {
          st.target = t;
          st.phase = 'attack';
          st.phaseT = 0;
          st.aim.acquire((t.soldier ?? t.vehicle)!.id, 100, h.profile, () => h.rng.next());
        }
      }
    }
    if (st.phase === 'climb') {
      wantAlt = C.takeoffAltitude + 4;
      throttle = C.takeoffThrottle;
      if (obj) heading = yawOf(center.x - v.pos.x, center.z - v.pos.z);
      if (alt > C.takeoffAltitude) {
        st.phase = 'patrol';
        st.phaseT = 0;
      }
    } else if (st.phase === 'patrol') {
      orbitPoint(center.x, center.z, v.pos.x, v.pos.z, C.orbitRadius, C.orbitLead, st.orbitDir, _v);
      heading = yawOf(_v.x - v.pos.x, _v.z - v.pos.z);
    } else if (st.phase === 'attack') {
      const t = st.target.vehicle ?? st.target.soldier;
      const alive = st.target.vehicle ? st.target.vehicle.alive && st.target.vehicle.crewCount > 0 : !!st.target.soldier?.alive;
      if (!t || !alive || st.phaseT > C.attackTimeout) {
        this.endAttack(st);
      } else {
        this.aimPoint(st.target, v.mounts[0]?.kind ?? 'rockets', v.pos, _aimPt);
        const dh = Math.hypot(_aimPt.x - v.pos.x, _aimPt.z - v.pos.z);
        heading = yawOf(_aimPt.x - v.pos.x, _aimPt.z - v.pos.z);
        wantAlt = C.attackAltitude;
        const depress = Math.atan2(v.pos.y - _aimPt.y, dh);
        throttle = clamp(depress / T.maxPitch, 0.25, 1);
        // Weapons along the nose (rockets) or the chin-mounted minigun with some depression.
        const m = v.mounts[0];
        st.aim.update(dt, dh, 0, 0, h.profile, () => h.rng.next());
        if (m?.kind === 'minigun') inp.pitch = clamp(-2 * depress - 2 * v.pitch, -1.2, 0.6) + v.pitch;
        else inp.pitch = -depress;
        if (m) {
          h.vehicles.muzzle(v, m, _mz, _md);
          _v.subVectors(_aimPt, _mz);
          const d = _v.length();
          const off = Math.acos(clamp(_v.dot(_md) / Math.max(1e-6, d), -1, 1));
          const tol = Math.atan((m.kind === 'rockets' ? C.fireToleranceAuto * 2 : C.fireToleranceAuto * 1.5) / Math.max(5, d));
          if (off < tol && st.aim.reactLeft <= 0 && d < C.gunnerRange[m.kind ?? 'rockets'] * 1.2) {
            if (m.kind === 'rockets') inp.firePressed = true;
            else this.autoFire(inp, m, st);
          }
        }
        if (dh < C.pullUpDistance || alt < C.pullUpAltitude) this.endAttack(st);
      }
    } else {
      // Extend: straight out and up, then back to the orbit.
      wantAlt = C.flightAltitude;
      throttle = 1;
      if (st.phaseT > C.extendSeconds) {
        st.phase = 'patrol';
        st.phaseT = 0;
      }
    }
    // Give the storm a wide berth.
    for (const hz of h.hazards) {
      if (hz.label !== 'Ion storm') continue;
      if (Math.hypot(v.pos.x - hz.x, v.pos.z - hz.z) < hz.r * C.stormAvoidMul) {
        heading = yawOf(v.pos.x - hz.x, v.pos.z - hz.z);
        if (st.phase === 'attack') this.endAttack(st);
      }
    }
    // Stay inside the combat area.
    const lim = h.mapLimit - C.mapMargin;
    if (Math.abs(v.pos.x) > lim || Math.abs(v.pos.z) > lim) heading = yawOf(-v.pos.x, -v.pos.z);
    // Obstacles ahead: climb over them.
    _v.copy(v.pos).setY(v.pos.y + 1);
    const blocked = h.probe(_v, viewDir(heading, -0.08, _md), C.obstacleProbe, v) < C.obstacleProbe;
    const above = v.pos.y - groundAhead;
    inp.yaw = heading;
    if (st.phase !== 'attack') inp.pitch = -0.15;
    inp.moveZ = blocked ? 0.1 : throttle;
    inp.moveX = 0;
    inp.jumpHeld = blocked || above < wantAlt - C.altitudeBand[0];
    inp.sprint = !blocked && above > wantAlt + C.altitudeBand[1];
  }

  private endAttack(st: CrewState): void {
    st.phase = 'extend';
    st.phaseT = 0;
    st.attackCd = C.attackCooldown;
    st.target = { soldier: null, vehicle: null };
  }

  /** Mount gunner: pick a target, lead it, traverse, fire with heat discipline. */
  private gunner(b: BotBrain, st: CrewState, v: Vehicle, m: Mount, dt: number): void {
    const s = b.s;
    const h = this.host;
    const inp = s.input;
    h.vehicles.muzzle(v, m, _mz, _md);
    st.retargetT -= dt;
    if (st.retargetT <= 0) {
      st.retargetT = C.retarget;
      const prev = st.target.soldier ?? st.target.vehicle;
      st.target = this.pickTarget(s, v, m.kind, _mz, C.gunnerRange[m.kind ?? 'coax'] ?? 120, st.target);
      const now = st.target.soldier ?? st.target.vehicle;
      if (now && now !== prev) st.aim.acquire(now.id, now.pos.distanceTo(_mz), h.profile, () => h.rng.next());
    }
    const t = st.target;
    if (!t.soldier && !t.vehicle) {
      // Watch ahead.
      const [y, p] = turnToward(s.yaw, s.pitch, v.yaw, 0, 1.5 * dt);
      inp.yaw = y;
      inp.pitch = p;
      return;
    }
    this.aimPoint(t, m.kind, _mz, _aimPt);
    const d = _mz.distanceTo(_aimPt);
    const tSpeed = t.soldier ? Math.hypot(t.soldier.vel.x, t.soldier.vel.z) : Math.hypot(t.vehicle!.vel.x, t.vehicle!.vel.z);
    st.aim.update(dt, d, tSpeed, 0, h.profile, () => h.rng.next());
    const dx = _aimPt.x - _mz.x, dy = _aimPt.y - _mz.y, dz = _aimPt.z - _mz.z;
    const gy = yawOf(dx, dz), gp = Math.atan2(dy, Math.hypot(dx, dz));
    [inp.yaw, inp.pitch] = turnToward(s.yaw, s.pitch, gy + st.aim.errYaw, gp + st.aim.errPitch, h.profile.turnSpeed * DEG * dt);
    // Fire when the real muzzle direction is on target.
    _v.subVectors(_aimPt, _mz).normalize();
    const off = Math.acos(clamp(_v.dot(_md), -1, 1));
    const tolM = m.kind === 'cannon' ? C.fireToleranceCannon : C.fireToleranceAuto;
    const tol = Math.atan((tolM * (t.vehicle ? 1.6 : 1)) / Math.max(4, d)) + st.aim.magnitude;
    if (off > tol || st.aim.reactLeft > 0) {
      if (m.heat < C.heatResume) st.heatHold = false;
      return;
    }
    if (m.kind === 'cannon') {
      if (m.ammo > 0 && m.cooldown <= 0) inp.firePressed = true;
      return;
    }
    this.autoFire(inp, m, st);
  }

  private autoFire(inp: Soldier['input'], m: Mount, st: CrewState): void {
    if (m.heat > C.heatRelease) st.heatHold = true;
    if (st.heatHold && m.heat < C.heatResume) st.heatHold = false;
    if (!st.heatHold && m.overheatT <= 0) inp.fire = true;
  }

  /** Aim point with lead and drop for a mount's projectile. */
  private aimPoint(t: Target, kind: Mount['kind'], from: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    let vel: THREE.Vector3;
    if (t.vehicle) {
      out.copy(t.vehicle.pos).setY(t.vehicle.pos.y + t.vehicle.model.centerY);
      vel = t.vehicle.vel;
    } else {
      chestPoint(t.soldier!, out);
      vel = t.soldier!.vel;
    }
    const [speed, gm] = ballistics(kind);
    const tof = from.distanceTo(out) / speed;
    out.addScaledVector(vel, tof);
    out.y += 0.5 * TUNING.weapons.gravity * gm * tof * tof;
    return out;
  }

  /** Best visible target for a mount: enemy soldiers in the open, enemy vehicles with a crew. */
  private pickTarget(s: Soldier, v: Vehicle, kind: Mount['kind'], from: THREE.Vector3, range: number, current: Target): Target {
    const h = this.host;
    const heavy = kind === 'cannon' || kind === 'rockets' || kind === 'chin';
    const cands: { soldier: Soldier | null; vehicle: Vehicle | null; score: number; pt: THREE.Vector3 }[] = [];
    for (const e of h.soldiers) {
      if (!e.alive || e.team === s.team || e.enclosed) continue;
      const d = e.pos.distanceTo(from);
      if (d > range) continue;
      let sc = 100 / (d + 10);
      if (e === current.soldier) sc *= 1.5;
      if (e.downed) sc *= 0.3;
      cands.push({ soldier: e, vehicle: null, score: sc, pt: chestPoint(e, new THREE.Vector3()) });
    }
    for (const o of h.vehicles.list) {
      if (o === v || !o.alive || o.crewCount === 0 || o.team === s.team) continue;
      const d = o.pos.distanceTo(from);
      if (d > range) continue;
      let sc = ((heavy ? 3 : 0.5) * 100) / (d + 10);
      if (o === current.vehicle) sc *= 1.5;
      cands.push({ soldier: null, vehicle: o, score: sc, pt: o.pos.clone().setY(o.pos.y + o.model.centerY) });
    }
    cands.sort((a, c) => c.score - a.score);
    for (let i = 0; i < Math.min(4, cands.length); i++) {
      const c = cands[i];
      if (h.canSee(from, c.pt)) return { soldier: c.soldier, vehicle: c.vehicle };
    }
    return { soldier: null, vehicle: null };
  }

  /** One line per crewed vehicle for debug readouts and automated runs. */
  debugLine(brains: ReadonlyMap<number, BotBrain>): string {
    const out: string[] = [];
    for (const v of this.host.vehicles.list) {
      const d = v.driver;
      if (!v.alive || !d) continue;
      const st = this.states.get(d.id);
      const b = brains.get(d.id);
      const i = d.input;
      out.push(`${v.kind}${v.team} ${st?.phase ?? '-'} in=${i.moveZ.toFixed(1)},${i.moveX.toFixed(1)}${i.jumpHeld ? 'B' : ''} v=${Math.hypot(v.vel.x, v.vel.z).toFixed(1)} st=${st?.stuckCount ?? 0}${(st?.reverseT ?? 0) > 0 ? 'R' : ''} p=${b?.pathIdx ?? 0}/${b?.path.length ?? 0}${b?.pathPending ? '?' : ''} w=${(st?.waitT ?? 0).toFixed(1)} c=${this.claims.get(v.id) ?? 0}`);
    }
    return out.join(' | ');
  }

  clear(): void {
    this.states.clear();
    this.claims.clear();
  }
}
