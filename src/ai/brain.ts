// Soldier-level bot AI. Each sim tick the brain writes the soldier's command (the same input a
// human produces): perception and decisions run at a level-of-detail rate, while steering and aim
// run every tick so movement and tracking stay smooth.
//
// Modes: objective (follow the squad order), combat (engage a visible enemy, with cover, peeking,
// strafing, bursts and grenades), search (push or suppress a last known position), revive,
// evade (live grenade nearby). Paths come from the navmesh through the director's request queue,
// including ladder, zipline and elevator links.
import * as THREE from 'three';
import { TUNING } from '../config/tuning';
import { AimState, turnToward, throwPitch, type AimProfile } from './aim';
import { yawOf, wrapAngle, clamp } from '../core/math';
import { chestPoint, headPoint } from '../weapons/hitboxes';
import { fireInterval } from '../weapons/stats';
import { dropAt } from '../weapons/ballistics';
import type { Rng } from '../core/rng';
import type { Soldier, Stance } from '../player/soldier';
import type { CoverPoint } from '../world/builder';
import type { Interactives, Ladder, Zipline, Elevator } from '../world/interactives';
import type { Squad } from './squad';

const A = TUNING.ai;
const B = TUNING.ai.brain;
const DEG = Math.PI / 180;

export interface BotWorld {
  readonly time: number;
  readonly soldiers: readonly Soldier[];
  readonly interactives: Interactives;
  readonly profile: AimProfile;
  readonly rng: Rng;
  /** Clear sight line (world geometry, opaque boxes, smoke). */
  canSee(from: THREE.Vector3, to: THREE.Vector3): boolean;
  coversNear(p: THREE.Vector3, r: number): readonly CoverPoint[];
  coverOwner(c: CoverPoint): number;
  claimCover(c: CoverPoint | null, prev: CoverPoint | null, by: Soldier): void;
  fragsNear(p: THREE.Vector3, r: number): readonly { pos: THREE.Vector3 }[];
  requestPath(b: BotBrain, to: THREE.Vector3): void;
  randomNavPoint(around: THREE.Vector3, r: number, out: THREE.Vector3): boolean;
  spot(by: Soldier, target: Soldier): void;
  ping(by: Soldier, pos: THREE.Vector3, kind: string, follow?: Soldier | null): void;
  /** Direction enemies come from for a team (toward their HQ), for defenders to watch. */
  threatBearing(team: number, from: THREE.Vector3): number;
}

export type BotMode = 'objective' | 'combat' | 'search' | 'revive' | 'evade';

type Link =
  | { kind: 'ladder'; ladder: Ladder; up: boolean; t: number; engaged: boolean }
  | { kind: 'zip'; line: Zipline; t: number; engaged: boolean }
  | { kind: 'elevator'; e: Elevator; targetY: number; t: number; boarded: boolean };

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _aimPt = new THREE.Vector3();
const _eye = new THREE.Vector3();

export class BotBrain {
  squad: Squad | null = null;
  mode: BotMode = 'objective';

  // ---- Navigation
  readonly goal = new THREE.Vector3();
  hasGoal = false;
  path: THREE.Vector3[] = [];
  pathIdx = 0;
  pathPending = false;
  /** Goal the current path was computed for. */
  readonly pathGoal = new THREE.Vector3();
  private pathAge = 0;
  private link: Link | null = null;
  private holdT = 0;
  arrived = false;
  private stuckT = 0;
  private stuckCount = 0;
  private readonly stuckRef = new THREE.Vector3();
  private stanceT = 0;
  private lookYaw = 0;
  private lookT = 0;

  // ---- Perception and combat
  target: Soldier | null = null;
  targetVisible = false;
  lastSeenT = -999;
  readonly lastKnown = new THREE.Vector3();
  readonly aim = new AimState();
  suppression = 0;
  private perceiveT = 0;
  private thinkT = 0;
  private burstShots = 0;
  private burstLen = 0;
  private pauseT = 0;
  private semiT = 0;
  private lastShotSeen = -1;
  private strafeDir = 0;
  private strafeT = 0;
  private spotT = 0;
  private grenadeT = 0;
  private throwT = -1;
  private throwYaw = 0;
  private throwPitch = 0;
  private wantStance: Stance = 'stand';
  private reactedTo = -1;

  // ---- Cover
  cover: CoverPoint | null = null;
  private coverPhase: 'move' | 'hide' | 'peek' = 'move';
  private coverT = 0;
  private coverHold = 0;
  private peekSide = 1;

  // ---- Revive and evade
  reviveTarget: Soldier | null = null;

  // ---- Overrides from the crew and gadget planners
  /** Walk here instead of the objective (a vehicle to board, a vehicle to repair). */
  detour: THREE.Vector3 | null = null;
  /** Another planner drives aim and trigger this tick (launcher on a vehicle). */
  aimOverride = false;
  /** In an open vehicle seat with a personal weapon: perceive and shoot from the seat. */
  seatCombat = false;
  private readonly evadeDir = new THREE.Vector3();
  private evadeT = 0;

  constructor(readonly s: Soldier) {
    this.lookYaw = s.yaw;
  }

  /** Called on death or respawn: clears every transient state. */
  reset(w: BotWorld): void {
    this.mode = 'objective';
    this.path.length = 0;
    this.pathIdx = 0;
    this.pathPending = false;
    this.hasGoal = false;
    this.link = null;
    this.target = null;
    this.targetVisible = false;
    this.suppression = 0;
    this.reviveTarget = null;
    this.throwT = -1;
    this.arrived = false;
    this.stuckCount = 0;
    this.lookYaw = this.s.yaw;
    if (this.cover) w.claimCover(null, this.cover, this.s);
    this.cover = null;
    this.thinkT = 0;
    this.perceiveT = 0;
    this.detour = null;
    this.aimOverride = false;
    this.seatCombat = false;
  }

  setPath(points: THREE.Vector3[]): void {
    this.path = points;
    this.pathIdx = 0;
    this.pathPending = false;
    this.pathAge = 0;
    this.link = null;
  }

  /** Awareness from an incoming shot or hit (the director routes these). */
  onThreat(from: Soldier, amount: number, w: BotWorld): void {
    this.suppression = Math.min(1, this.suppression + amount);
    if (!this.target || !this.targetVisible) {
      this.target = from;
      this.lastKnown.copy(from.pos);
      this.lastSeenT = w.time;
      if (this.mode !== 'combat') this.mode = 'search';
      // Snap attention toward the threat (look, not aim).
      this.lookYaw = yawOf(from.pos.x - this.s.pos.x, from.pos.z - this.s.pos.z);
    }
  }

  /** Runs away from a hazard (storm, launch blast) for a few seconds. */
  evadeFrom(x: number, z: number, seconds: number, w: BotWorld): void {
    if (this.s.inVehicle) return;
    this.evadeDir.set(this.s.pos.x - x, 0, this.s.pos.z - z);
    if (this.evadeDir.lengthSq() < 0.01) this.evadeDir.set(w.rng.range(-1, 1), 0, w.rng.range(-1, 1));
    this.evadeDir.normalize();
    this.evadeT = seconds;
    this.mode = 'evade';
    this.leaveCover(w);
  }

  // ------------------------------------------------------------------------------------------
  tick(dt: number, w: BotWorld): void {
    const s = this.s;
    const inp = s.input;
    inp.moveX = 0;
    inp.moveZ = 0;
    inp.fire = false;
    inp.aim = false;
    inp.sprint = false;
    inp.jumpHeld = false;
    inp.interactHeld = false;
    if (!s.alive || s.downed) return;
    if (s.inVehicle) {
      if (this.seatCombat) {
        this.perceiveT -= dt;
        if (this.perceiveT <= 0) {
          this.perceiveT = A.lod.perceive[0];
          this.perceive(w);
        }
        this.mode = this.target && this.targetVisible ? 'combat' : 'objective';
        this.aimAndFire(dt, w);
      }
      return;
    }
    this.suppression = Math.max(0, this.suppression - A.suppression.decay * dt);
    this.spotT -= dt;
    this.grenadeT -= dt;
    this.stanceT -= dt;
    this.pathAge += dt;

    const lod = s.lod;
    this.perceiveT -= dt;
    if (this.perceiveT <= 0) {
      this.perceiveT = A.lod.perceive[lod] * (1 - B.intervalJitter / 2 + w.rng.next() * B.intervalJitter);
      this.perceive(w);
    }
    this.thinkT -= dt;
    if (this.thinkT <= 0) {
      this.thinkT = A.lod.think[lod] * (1 - B.intervalJitter / 2 + w.rng.next() * B.intervalJitter);
      this.think(w);
    }
    this.steer(dt, w);
    if (!this.aimOverride) this.aimAndFire(dt, w);
    this.applyStance();
  }

  // ------------------------------------------------------------------------------------------
  // Perception: pick the most relevant visible enemy.
  private perceive(w: BotWorld): void {
    const s = this.s;
    const P = A.perception;
    const p = w.profile;
    const eye = _eye.copy(s.eyePos);
    const cands: { e: Soldier; score: number }[] = [];
    const halfFov = (p.fov * DEG) / 2;
    for (const e of w.soldiers) {
      if (e.team === s.team || !e.alive || e.enclosed) continue;
      const dx = e.pos.x - s.pos.x, dz = e.pos.z - s.pos.z;
      const d = Math.hypot(dx, dz);
      const spotted = e.spottedUntil > w.time && e.spottedByTeam === s.team;
      const range = p.viewDistance * (spotted ? P.spottedRangeMul : 1);
      if (d > range) continue;
      const inFov = Math.abs(wrapAngle(yawOf(dx, dz) - s.yaw)) < halfFov;
      const heard = e.firedUntil > w.time && d < (e.arsenal?.current.stats.suppressed ? P.hearSuppressed : P.hearShots);
      const attacker = s.lastAttacker === e.id && w.time - s.lastDamageT < 3;
      if (!(inFov || d < P.closeAwareness || heard || attacker || spotted)) continue;
      let score = 100 / (d + 8);
      if (e === this.target) score *= P.targetKeep;
      if (attacker) score *= B.targetAttackerMul;
      if (e.downed) score *= B.targetDownedMul;
      if (e.isPlayer) score *= B.targetPlayerMul;
      cands.push({ e, score });
    }
    cands.sort((a, b) => b.score - a.score);
    let found: Soldier | null = null;
    for (let i = 0; i < Math.min(P.losChecks, cands.length); i++) {
      const e = cands[i].e;
      if (w.canSee(eye, chestPoint(e, _v))) {
        found = e;
        break;
      }
    }
    if (found) {
      if (found !== this.target || !this.targetVisible) {
        if (found.id !== this.aim.targetId || w.time - this.lastSeenT > B.reacquireAfter) this.aim.acquire(found.id, s.pos.distanceTo(found.pos), p, () => w.rng.next());
      }
      this.target = found;
      this.targetVisible = true;
      this.lastSeenT = w.time;
      this.lastKnown.copy(found.pos);
      if (this.spotT <= 0 && !(found.spottedUntil > w.time && found.spottedByTeam === s.team)) {
        this.spotT = A.spotting.cooldown;
        w.spot(s, found);
        if (w.rng.next() < A.spotting.pingChance) w.ping(s, found.pos, 'enemy', found);
      }
    } else {
      this.targetVisible = false;
      if (this.target && (!this.target.alive || w.time - this.lastSeenT > P.forgetAfter)) this.target = null;
    }
  }

  // ------------------------------------------------------------------------------------------
  // Decisions.
  private think(w: BotWorld): void {
    const s = this.s;
    const p = w.profile;
    const a = s.arsenal;
    // Live grenade nearby: get away from it.
    const frags = w.fragsNear(s.pos, A.grenades.evadeRadius);
    if (frags.length && this.mode !== 'evade') {
      this.evadeDir.subVectors(s.pos, frags[0].pos).setY(0);
      if (this.evadeDir.lengthSq() < 0.01) this.evadeDir.set(w.rng.range(-1, 1), 0, w.rng.range(-1, 1));
      this.evadeDir.normalize();
      this.evadeT = B.evadeSeconds;
      this.mode = 'evade';
      this.leaveCover(w);
      return;
    }
    if (this.mode === 'evade' && this.evadeT > 0) return;

    // Out of primary ammo entirely: the sidearm.
    const prim = a.slots[0];
    if (a.slot === 0 && !prim.usesHeat && prim.mag === 0 && prim.reserve === 0) s.input.slot = 1;
    if (a.slot === 2 && !this.aimOverride) s.input.slot = 0;

    if (this.target && this.targetVisible) {
      this.mode = 'combat';
      this.reviveTarget = null;
      const d = s.pos.distanceTo(this.target.pos);
      // Cover when suppressed or hurt.
      if (!this.cover && (this.suppression > A.cover.seekSuppression || s.health < A.cover.seekHealth) && w.rng.next() < p.coverChance) this.findCover(w, this.target.pos);
      if (this.cover && this.coverInvalid(this.target.pos)) this.leaveCover(w);
      // Grenade at a target in range, mostly when it sits behind cover or in a group.
      this.considerGrenade(w, d);
      // Strafing rhythm and stance at range.
      this.wantStance = !this.cover && d > A.combat.crouchBeyond && this.strafeDir === 0 && w.rng.next() < B.crouchChance ? 'crouch' : this.cover ? this.wantStance : 'stand';
      // Push toward the target when beyond the weapon's effective range.
      const engage = A.combat.engageRange[a.current.stats.category] ?? 80;
      if (!this.cover && d > engage * B.approachBeyond) this.setGoal(w, this.target.pos, 2.5);
      return;
    }
    if (this.cover) this.leaveCover(w);
    this.wantStance = 'stand';

    if (this.target && w.time - this.lastSeenT < A.perception.forgetAfter) {
      // Search: push the last known position (a grenade first, sometimes).
      this.mode = 'search';
      this.considerGrenade(w, s.pos.distanceTo(this.lastKnown));
      this.setGoal(w, this.lastKnown, 3);
      return;
    }
    this.target = null;

    // Revive a downed teammate.
    const rv = this.findRevive(w);
    if (rv) {
      this.mode = 'revive';
      this.reviveTarget = rv;
      this.setGoal(w, rv.pos, 1.2);
      return;
    }
    this.reviveTarget = null;
    this.mode = 'objective';
    // Reload between fights.
    const cur = a.current;
    if (!cur.usesHeat && !cur.reloading && cur.mag < cur.stats.mag * A.combat.reloadBelow && cur.reserve > 0) s.input.reload = true;
    this.objectiveGoal(w);
  }

  private objectiveGoal(w: BotWorld): void {
    const s = this.s;
    if (this.detour) {
      this.setGoal(w, this.detour, 2);
      return;
    }
    const sq = this.squad;
    const o = sq?.order;
    if (!o) {
      if (!this.hasGoal || this.arrived) {
        if (w.randomNavPoint(s.pos, 60, _v)) this.setGoal(w, _v, 3);
      }
      return;
    }
    // Flank waypoint first.
    if (o.flank && sq.flankers.has(s.id) && s.pos.distanceTo(o.flank) > B.flankArrive && Math.hypot(s.pos.x - o.pos.x, s.pos.z - o.pos.z) > o.radius * 2.5) {
      if (!this.hasGoal || this.goal.distanceTo(o.flank) > 6) this.setGoal(w, o.flank, 6);
      return;
    }
    if (o.kind === 'regroup') {
      // Members close on the leader; the leader keeps moving toward the objective zone.
      const lead = sq.leader();
      if (lead && lead !== s) {
        if (s.pos.distanceTo(lead.pos) > 10) this.setGoal(w, lead.pos, 4);
        return;
      }
    }
    const inZone = Math.hypot(s.pos.x - o.pos.x, s.pos.z - o.pos.z) < o.radius;
    const goalInZone = this.hasGoal && Math.hypot(this.goal.x - o.pos.x, this.goal.z - o.pos.z) < o.radius * 1.05;
    if (!goalInZone || (this.arrived && this.holdT <= 0)) {
      // A spot in the zone: cover facing the enemy when defending, otherwise any reachable point.
      let picked = false;
      if (o.kind === 'defend' && inZone) {
        const threat = w.threatBearing(s.team, o.pos);
        const tx = -Math.sin(threat), tz = -Math.cos(threat);
        let best: CoverPoint | null = null;
        let bs = -Infinity;
        for (const c of w.coversNear(o.pos, o.radius)) {
          const own = w.coverOwner(c);
          if (own !== -1 && own !== s.id) continue;
          const sc = c.normal.x * tx + c.normal.z * tz + w.rng.next() * 0.6;
          if (sc > bs) {
            bs = sc;
            best = c;
          }
        }
        if (best && bs > B.defendCoverMin) {
          this.setGoal(w, best.pos, 0.8);
          picked = true;
        }
      }
      if (!picked && w.randomNavPoint(o.pos, Math.max(4, o.radius * 0.8), _v)) this.setGoal(w, _v, 2);
      else if (!picked) this.setGoal(w, _v.copy(o.pos).add(_v2.set(w.rng.range(-1, 1) * o.radius * 0.5, 0, w.rng.range(-1, 1) * o.radius * 0.5)), 2);
      this.holdT = w.rng.range(A.cover.holdSeconds[0], A.cover.holdSeconds[1]);
    }
  }

  private setGoal(w: BotWorld, p: THREE.Vector3, tolerance: number): void {
    const moved = !this.hasGoal || this.goal.distanceTo(p) > tolerance;
    if (moved) {
      this.goal.copy(p);
      this.hasGoal = true;
      this.arrived = false;
    }
    const stale = this.pathAge > A.movement.repathEvery || this.pathGoal.distanceTo(this.goal) > tolerance;
    if ((moved || stale || (!this.path.length && !this.arrived)) && !this.pathPending) {
      this.pathPending = true;
      this.pathGoal.copy(this.goal);
      w.requestPath(this, this.goal);
    }
  }

  private findRevive(w: BotWorld): Soldier | null {
    const s = this.s;
    const R = A.revive;
    const range = s.cls === 'support' ? R.medicSearchRange : R.searchRange;
    let best: Soldier | null = null;
    let bd = range;
    for (const t of w.soldiers) {
      if (t === s || t.team !== s.team || !t.alive || !t.downed) continue;
      if (t.reviverId !== -1 && t.reviverId !== s.id) continue;
      let d = t.pos.distanceTo(s.pos);
      if (this.squad && t.squadId === this.squad.id) d *= B.squadReviveBias;
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    return best;
  }

  private considerGrenade(w: BotWorld, d: number): void {
    const s = this.s;
    const a = s.arsenal;
    const G = A.grenades;
    if (this.grenadeT > 0 || this.throwT >= 0 || a.throwables <= 0 || a.throwable !== 'frag') return;
    if (d < G.minRange || d > G.maxRange) return;
    const hidden = !this.targetVisible || (this.target && this.target.stance !== 'stand');
    if (!hidden && w.rng.next() > B.grenadeExposedChance) return;
    if (w.rng.next() > w.profile.grenadeChance) {
      this.grenadeT = G.cooldown * B.grenadeRetryMul;
      return;
    }
    this.grenadeT = G.cooldown;
    const tgt = this.targetVisible && this.target ? this.target.pos : this.lastKnown;
    const dx = tgt.x - s.pos.x, dz = tgt.z - s.pos.z;
    const T = TUNING.throwables;
    this.throwYaw = yawOf(dx, dz);
    this.throwPitch = throwPitch(Math.hypot(dx, dz), tgt.y - (s.pos.y + s.eye), T.throwSpeed, T.throwUp, 0.12, TUNING.weapons.gravity);
    this.throwT = 0;
  }

  // ------------------------------------------------------------------------------------------
  // Cover.
  private findCover(w: BotWorld, threat: THREE.Vector3): void {
    const s = this.s;
    let best: CoverPoint | null = null;
    let bs = -Infinity;
    for (const c of w.coversNear(s.pos, A.cover.searchRadius)) {
      const own = w.coverOwner(c);
      if (own !== -1 && own !== s.id) continue;
      const tx = threat.x - c.pos.x, tz = threat.z - c.pos.z;
      const td = Math.hypot(tx, tz);
      if (td < B.coverMinThreatDist) continue;
      const facing = (c.normal.x * tx + c.normal.z * tz) / td;
      if (facing < B.coverFacingMin) continue;
      const sc = facing * B.coverFacingWeight - c.pos.distanceTo(s.pos) * B.coverDistanceWeight + (c.tall ? B.coverTallBonus : 0);
      if (sc > bs) {
        bs = sc;
        best = c;
      }
    }
    if (!best) return;
    w.claimCover(best, this.cover, s);
    this.cover = best;
    this.coverPhase = 'move';
    this.coverT = 0;
    this.coverHold = w.rng.range(A.cover.holdSeconds[0], A.cover.holdSeconds[1]);
    this.peekSide = w.rng.next() < 0.5 ? -1 : 1;
    this.setGoal(w, best.pos, 0.5);
  }

  private coverInvalid(threat: THREE.Vector3): boolean {
    const c = this.cover!;
    const tx = threat.x - c.pos.x, tz = threat.z - c.pos.z;
    const td = Math.hypot(tx, tz) || 1;
    return (c.normal.x * tx + c.normal.z * tz) / td < B.coverInvalidFacing || this.coverHold <= 0;
  }

  private leaveCover(w: BotWorld): void {
    if (!this.cover) return;
    w.claimCover(null, this.cover, this.s);
    this.cover = null;
    this.wantStance = 'stand';
  }

  // ------------------------------------------------------------------------------------------
  // Steering: writes moveX / moveZ (relative to the current yaw), sprint and interact.
  private steer(dt: number, w: BotWorld): void {
    const s = this.s;
    const inp = s.input;
    const M = A.movement;
    let dirX = 0, dirZ = 0, speed = 1;
    let faceMove = false;

    if (this.link) {
      this.steerLink(dt, w);
      return;
    }

    switch (this.mode) {
      case 'evade': {
        this.evadeT -= dt;
        dirX = this.evadeDir.x;
        dirZ = this.evadeDir.z;
        faceMove = !this.target || !this.targetVisible;
        inp.sprint = faceMove;
        if (this.evadeT <= 0) this.mode = 'objective';
        break;
      }
      case 'revive': {
        const t = this.reviveTarget;
        if (!t || !t.downed || !t.alive) {
          this.reviveTarget = null;
          this.mode = 'objective';
          break;
        }
        const d = Math.hypot(t.pos.x - s.pos.x, t.pos.z - s.pos.z);
        if (d < TUNING.health.reviveRange * 0.75) {
          inp.interactHeld = true;
          this.wantStance = 'crouch';
          this.lookYaw = yawOf(t.pos.x - s.pos.x, t.pos.z - s.pos.z);
        } else {
          [dirX, dirZ] = this.followPath(dt, w);
          faceMove = true;
          inp.sprint = d > M.sprintBeyond;
        }
        break;
      }
      case 'combat': {
        if (this.cover) {
          [dirX, dirZ] = this.steerCover(dt, w);
          break;
        }
        // Approach along the path when out of range, plus a strafe rhythm.
        const t = this.target;
        if (t) {
          const engage = A.combat.engageRange[s.arsenal.current.stats.category] ?? 80;
          const d = s.pos.distanceTo(t.pos);
          if (d > engage * B.approachBeyond && this.path.length) [dirX, dirZ] = this.followPath(dt, w);
          else if (d < engage * B.backOffWithin && (s.arsenal.current.stats.category === 'sniper' || s.arsenal.current.stats.category === 'dmr')) {
            dirX = s.pos.x - t.pos.x;
            dirZ = s.pos.z - t.pos.z;
            const l = Math.hypot(dirX, dirZ) || 1;
            dirX /= l;
            dirZ /= l;
          }
          this.strafeT -= dt;
          if (this.strafeT <= 0) {
            const p = w.profile;
            this.strafeT = w.rng.range(A.combat.strafeInterval[0], A.combat.strafeInterval[1]);
            const r = w.rng.next();
            this.strafeDir = r < p.strafe * 0.5 ? -1 : r < p.strafe ? 1 : 0;
          }
          if (this.strafeDir !== 0) {
            const ry = yawOf(t.pos.x - s.pos.x, t.pos.z - s.pos.z);
            // Right vector of the facing toward the target.
            dirX += Math.cos(ry) * this.strafeDir * B.strafeWeight;
            dirZ += -Math.sin(ry) * this.strafeDir * B.strafeWeight;
          }
          speed = 1;
        }
        break;
      }
      case 'search':
      case 'objective': {
        if (this.hasGoal && !this.arrived) {
          [dirX, dirZ] = this.followPath(dt, w);
          faceMove = this.mode === 'objective' || !this.target;
          const gd = Math.hypot(this.goal.x - s.pos.x, this.goal.z - s.pos.z);
          inp.sprint = faceMove && gd > M.sprintBeyond && this.mode === 'objective';
          if (inp.sprint && !s.tacSprint && s.tacCooldown <= 0 && w.rng.next() < A.movement.tacSprintChance * dt) inp.tacSprint = true;
          if (gd < M.arriveRadius && Math.abs(this.goal.y - s.pos.y) < 3) this.arrive();
        } else {
          this.holdT -= dt;
          if (this.mode === 'search') this.mode = 'objective';
        }
        break;
      }
    }

    // Stuck detection while trying to move.
    const moving = Math.abs(dirX) + Math.abs(dirZ) > 0.1;
    if (moving) {
      this.stuckT += dt;
      if (this.stuckT > M.stuckSeconds) {
        const moved = Math.hypot(s.pos.x - this.stuckRef.x, s.pos.z - this.stuckRef.z);
        if (moved < M.stuckMinMove) this.unstick(w);
        else this.stuckCount = 0;
        this.stuckRef.copy(s.pos);
        this.stuckT = 0;
      }
    } else {
      this.stuckT = 0;
      this.stuckRef.copy(s.pos);
    }

    const len = Math.hypot(dirX, dirZ);
    if (len > 1e-4) {
      dirX /= len;
      dirZ /= len;
      if (faceMove) this.lookYaw = yawOf(dirX, dirZ);
      // World direction to local input around the current yaw.
      const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
      const rx = Math.cos(s.yaw), rz = -Math.sin(s.yaw);
      inp.moveZ = (dirX * fx + dirZ * fz) * speed;
      inp.moveX = (dirX * rx + dirZ * rz) * speed;
    } else if (!this.target || !this.targetVisible) {
      // Idle: look around now and then (toward the expected threat when defending).
      this.lookT -= dt;
      if (this.lookT <= 0) {
        this.lookT = w.rng.range(A.movement.lookAround[0], A.movement.lookAround[1]);
        const base = w.threatBearing(s.team, s.pos);
        this.lookYaw = base + w.rng.range(-B.lookSpread, B.lookSpread);
      }
    }
  }

  private arrive(): void {
    this.arrived = true;
    this.path.length = 0;
    this.pathIdx = 0;
  }

  private unstick(w: BotWorld): void {
    const s = this.s;
    this.stuckCount++;
    s.input.jump = true;
    if (this.stuckCount === 2 || this.stuckCount === 4) {
      // Repath to a jittered point.
      if (w.randomNavPoint(this.hasGoal ? this.goal : s.pos, 6, _v)) {
        this.goal.copy(_v);
        this.pathPending = true;
        this.pathGoal.copy(_v);
        w.requestPath(this, _v);
      }
    } else if (this.stuckCount >= 6) {
      // Give up on this goal.
      this.stuckCount = 0;
      this.hasGoal = false;
      this.path.length = 0;
      this.arrived = true;
      this.holdT = 0;
      this.leaveCover(w);
    }
  }

  /** Direction toward the next waypoint (world xz, unnormalized); advances through links. */
  private followPath(_dt: number, w: BotWorld): [number, number] {
    const s = this.s;
    const M = A.movement;
    const path = this.path;
    if (!path.length) {
      if (!this.hasGoal) return [0, 0];
      return [this.goal.x - s.pos.x, this.goal.z - s.pos.z];
    }
    while (this.pathIdx < path.length) {
      const wp = path[this.pathIdx];
      const hd = Math.hypot(wp.x - s.pos.x, wp.z - s.pos.z);
      if (hd < M.waypointRadius && Math.abs(wp.y - s.pos.y) < 2.6) {
        const next = path[this.pathIdx + 1];
        this.pathIdx++;
        if (next && this.detectLink(wp, next, w)) return [0, 0];
        continue;
      }
      break;
    }
    if (this.pathIdx >= path.length) {
      return [this.goal.x - s.pos.x, this.goal.z - s.pos.z];
    }
    const wp = path[this.pathIdx];
    return [wp.x - s.pos.x, wp.z - s.pos.z];
  }

  /** Recognizes an off-mesh link (ladder, zipline, elevator) between two path points. */
  private detectLink(a: THREE.Vector3, b: THREE.Vector3, w: BotWorld): boolean {
    const near = (p: THREE.Vector3, q: THREE.Vector3, r: number) => Math.hypot(p.x - q.x, p.z - q.z) < r && Math.abs(p.y - q.y) < 2;
    const I = w.interactives;
    for (const l of I.ladders) {
      if (near(a, l.base, 1.6) && near(b, l.exit, 2)) {
        this.link = { kind: 'ladder', ladder: l, up: true, t: 0, engaged: false };
        return true;
      }
      if (near(a, l.exit, 2) && near(b, l.base, 1.6)) {
        this.link = { kind: 'ladder', ladder: l, up: false, t: 0, engaged: false };
        return true;
      }
    }
    for (const z of I.ziplines) {
      const hi = z.a.y >= z.b.y ? z.a : z.b, lo = z.a.y >= z.b.y ? z.b : z.a;
      if (Math.hypot(a.x - hi.x, a.z - hi.z) < 2.5 && Math.hypot(b.x - lo.x, b.z - lo.z) < 3) {
        this.link = { kind: 'zip', line: z, t: 0, engaged: false };
        return true;
      }
    }
    for (const e of I.elevators) {
      if (Math.hypot(a.x - e.base.x, a.z - e.base.z) < 2.5 && Math.hypot(b.x - e.base.x, b.z - e.base.z) < 2.5 && Math.abs(a.y - b.y) > 3) {
        this.link = { kind: 'elevator', e, targetY: b.y, t: 0, boarded: false };
        return true;
      }
    }
    return false;
  }

  private steerLink(dt: number, w: BotWorld): void {
    const s = this.s;
    const inp = s.input;
    const L = this.link!;
    L.t += dt;
    const done = () => {
      this.link = null;
    };
    if (L.t > 25) {
      done();
      this.pathPending = true;
      w.requestPath(this, this.goal);
      return;
    }
    const toward = (p: THREE.Vector3) => {
      const dx = p.x - s.pos.x, dz = p.z - s.pos.z;
      const l = Math.hypot(dx, dz);
      if (l < 0.05) return;
      this.lookYaw = yawOf(dx, dz);
      const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
      const rx = Math.cos(s.yaw), rz = -Math.sin(s.yaw);
      inp.moveZ = ((dx * fx + dz * fz) / l) * Math.min(1, l * 2);
      inp.moveX = ((dx * rx + dz * rz) / l) * Math.min(1, l * 2);
    };
    if (L.kind === 'ladder') {
      if (s.state === 'ladder') {
        L.engaged = true;
        this.lookYaw = L.ladder.yaw;
        inp.moveZ = L.up ? 1 : -1;
      } else if (L.engaged) done();
      else {
        toward(L.up ? L.ladder.base : L.ladder.exit);
        if (L.t > 0.2) inp.interact = true;
        if (L.t > 6) done();
      }
      return;
    }
    if (L.kind === 'zip') {
      if (s.state === 'zipline') L.engaged = true;
      else if (L.engaged) done();
      else {
        const hi = L.line.a.y >= L.line.b.y ? L.line.a : L.line.b;
        toward(hi);
        inp.interact = true;
        if (L.t > 6) done();
      }
      return;
    }
    // Elevator: board when the platform is level with us, ride, step off at the target level.
    const e = L.e;
    if (!L.boarded) {
      if (Math.abs(e.floorY - s.pos.y) < 0.4) {
        toward(e.base);
        if (e.contains(s.pos, -0.3)) L.boarded = true;
      }
    } else {
      toward(e.base);
      if (Math.abs(e.floorY - L.targetY) < 0.3 && e.delta === 0) done();
      else if (!e.contains(s.pos, 0.6)) L.boarded = false;
    }
  }

  private steerCover(dt: number, w: BotWorld): [number, number] {
    const s = this.s;
    const c = this.cover!;
    this.coverT -= dt;
    this.coverHold -= dt;
    const dx = c.pos.x - s.pos.x, dz = c.pos.z - s.pos.z;
    const d = Math.hypot(dx, dz);
    if (this.coverPhase === 'move') {
      if (d < 0.8) {
        this.coverPhase = 'hide';
        this.coverT = w.rng.range(A.cover.hide[0], A.cover.hide[1]);
        this.arrive();
      } else return this.path.length ? this.followPath(dt, w) : [dx, dz];
    }
    if (this.coverPhase === 'hide') {
      this.wantStance = c.tall ? 'stand' : 'crouch';
      if (this.coverT <= 0) {
        this.coverPhase = 'peek';
        this.coverT = w.rng.range(A.cover.peek[0], A.cover.peek[1]);
        this.peekSide = -this.peekSide;
      }
      return d > 0.3 ? [dx, dz] : [0, 0];
    }
    // Peek: stand up over low cover, side-step out of tall cover.
    if (this.coverT <= 0) {
      this.coverPhase = 'hide';
      this.coverT = w.rng.range(A.cover.hide[0], A.cover.hide[1]) * (1 + this.suppression);
    }
    if (!c.tall) {
      this.wantStance = 'stand';
      return d > 0.3 ? [dx, dz] : [0, 0];
    }
    const tx = -c.normal.z * this.peekSide, tz = c.normal.x * this.peekSide;
    const px = c.pos.x + tx * A.cover.tallSideStep - s.pos.x, pz = c.pos.z + tz * A.cover.tallSideStep - s.pos.z;
    return Math.hypot(px, pz) > 0.2 ? [px, pz] : [0, 0];
  }

  /** True while the bot's body is exposed (fire is only allowed then when in cover). */
  private exposed(): boolean {
    return !this.cover || this.coverPhase === 'peek';
  }

  // ------------------------------------------------------------------------------------------
  // Aim and trigger.
  private aimAndFire(dt: number, w: BotWorld): void {
    const s = this.s;
    const inp = s.input;
    const p = w.profile;
    const a = s.arsenal;
    const wpn = a.current;
    const st = wpn.stats;
    const turn = p.turnSpeed * DEG * dt;

    // Scripted grenade throw: hold the throw aim until the release point.
    if (this.throwT >= 0) {
      this.throwT += dt;
      [inp.yaw, inp.pitch] = turnToward(s.yaw, s.pitch, this.throwYaw, this.throwPitch, turn * B.throwTurnMul);
      if (this.throwT > B.throwRelease && this.throwT - dt <= B.throwRelease) inp.grenade = true;
      if (this.throwT > B.throwHold) this.throwT = -1;
      return;
    }

    const t = this.target;
    const suppressing = !!t && !this.targetVisible && w.time - this.lastSeenT < A.combat.suppressFor && (st.category === 'lmg' || st.category === 'ar');
    if (t && (this.targetVisible || suppressing) && this.mode !== 'revive' && this.mode !== 'evade') {
      // Aim point: chest or head, with lead for travel time and drop compensation.
      if (this.targetVisible && this.aim.head) headPoint(t, _aimPt);
      else if (this.targetVisible) chestPoint(t, _aimPt);
      else _aimPt.copy(this.lastKnown).setY(this.lastKnown.y + 1.1);
      const eye = s.eyePos;
      const dist = eye.distanceTo(_aimPt);
      const speed = st.velocity > 0 ? st.velocity : 300;
      const tof = dist / speed;
      if (this.targetVisible) _aimPt.addScaledVector(t.vel, tof * B.leadFactor);
      _aimPt.y += dropAt(dist, speed, TUNING.weapons.gravity * st.gravityMul);
      const dx = _aimPt.x - eye.x, dy = _aimPt.y - eye.y, dz = _aimPt.z - eye.z;
      const hd = Math.hypot(dx, dz);
      const goalYaw = yawOf(dx, dz);
      const goalPitch = Math.atan2(dy, hd);
      const tSpeed = Math.hypot(t.vel.x, t.vel.z);
      this.aim.update(dt, dist, tSpeed, this.suppression, p, () => w.rng.next());
      [inp.yaw, inp.pitch] = turnToward(s.yaw, s.pitch, goalYaw + this.aim.errYaw, goalPitch + this.aim.errPitch, turn);
      inp.pitch = clamp(inp.pitch, -TUNING.camera.pitchLimit, TUNING.camera.pitchLimit);
      // Fire when settled on target, exposed and the weapon is ready.
      const off = Math.hypot(wrapAngle(inp.yaw - goalYaw), inp.pitch - goalPitch);
      const tol = Math.max(Math.atan(0.3 / Math.max(1, dist)) * A.combat.fireTolerance, this.aim.floor(dist, tSpeed, this.suppression, p) * B.settleMul);
      const ready = this.aim.reactLeft <= 0 && off < tol && this.exposed() && !wpn.reloading && a.equipT <= 0 && s.state !== 'ladder' && s.state !== 'zipline';
      inp.aim = dist > A.combat.adsBeyond && !s.sprinting && this.exposed();
      if (ready && !(t.downed && w.rng.next() > A.combat.finishDownedChance && this.targetVisible)) this.trigger(dt, w, dist);
      else this.pauseT = Math.max(0, this.pauseT - dt);
      if (this.reactedTo !== t.id) {
        this.reactedTo = t.id;
        this.burstShots = 0;
        this.burstLen = 0;
      }
      return;
    }
    // Not engaging: look where we move or around.
    const goalPitch = this.mode === 'objective' && this.arrived ? B.idlePitch : 0;
    [inp.yaw, inp.pitch] = turnToward(s.yaw, s.pitch, this.lookYaw, goalPitch, turn * B.lookTurnMul);
  }

  /** Burst discipline for automatics, a cadence for semi-auto and bolt weapons. */
  private trigger(dt: number, w: BotWorld, dist: number): void {
    const s = this.s;
    const inp = s.input;
    const p = w.profile;
    const C = A.combat;
    const wpn = s.arsenal.current;
    const st = wpn.stats;
    if (wpn.mode === 'auto') {
      if (this.pauseT > 0) {
        this.pauseT -= dt;
        return;
      }
      if (this.burstLen <= 0) {
        const b = C.burst[st.category] ?? [3, 6];
        this.burstLen = Math.max(1, Math.round(w.rng.range(b[0], b[1]) * p.burstMul * (1 - Math.min(B.burstMaxShrink, dist / B.burstRangeShrink))));
        this.burstShots = 0;
      }
      inp.fire = true;
      if (wpn.lastShotT !== this.lastShotSeen) {
        this.lastShotSeen = wpn.lastShotT;
        this.burstShots++;
        if (this.burstShots >= this.burstLen) {
          this.burstLen = 0;
          this.pauseT = w.rng.range(C.pause[0], C.pause[1]) * (1 + (dist / 100) * C.pausePer100m) * p.pauseMul;
        }
      }
      return;
    }
    this.semiT -= dt;
    if (this.semiT <= 0) {
      inp.fire = true;
      inp.firePressed = true;
      const base = Math.max(fireInterval(st), w.rng.range(C.semiInterval[0], C.semiInterval[1]));
      this.semiT = base * (1 + dist / B.semiRangeStretch) * p.pauseMul * (wpn.mode === 'burst' ? B.burstModeMul : 1);
    }
  }

  private applyStance(): void {
    const s = this.s;
    if (this.stanceT > 0 || s.state !== 'ground') return;
    const want = s.input.sprint ? 'stand' : this.wantStance;
    if (s.stance === want) return;
    this.stanceT = B.stanceInterval;
    if (want === 'prone' || s.stance === 'prone') s.input.prone = true;
    else s.input.crouch = true;
  }
}
