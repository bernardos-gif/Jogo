// The AI director owns every bot brain and squad. Each sim tick it assigns AI level of detail by
// distance to the camera, re-evaluates squad objectives on a stagger, serves path requests within
// a per-tick budget, routes threat awareness (near misses and hits) to brains, and implements the
// world queries brains use (sight lines, cover lookup and claims, grenade evasion, spotting, pings).
import * as THREE from 'three';
import { TUNING } from '../config/tuning';
import { BotBrain, type BotWorld } from './brain';
import { Squad, SQUAD_NAMES } from './squad';
import { Rng } from '../core/rng';
import { yawOf } from '../core/math';
import { chestPoint } from '../weapons/hitboxes';
import type { AimProfile } from './aim';
import type { ObjectiveView } from './utility';
import type { Soldier } from '../player/soldier';
import type { CoverPoint } from '../world/builder';
import type { PathFinder } from '../world/nav';
import type { Interactives } from '../world/interactives';
import type { CollisionWorld } from '../physics/collision';
import type { EventBus } from '../core/events';
import type { Difficulty } from '../core/save';
import type { TeamId, ZoneId } from '../config/content';
import type { ZoneState } from '../modes/sector/logic';

const A = TUNING.ai;
const COVER_CELL = 16;

export interface AIHost {
  readonly time: number;
  readonly soldiers: readonly Soldier[];
  readonly interactives: Interactives;
  readonly nav: PathFinder | null;
  readonly collision: CollisionWorld;
  readonly events: EventBus;
  smokeBlocks(a: THREE.Vector3, b: THREE.Vector3): boolean;
  fragsNear(p: THREE.Vector3, r: number): readonly { pos: THREE.Vector3 }[];
  /** Where the camera is (AI level of detail). */
  cameraPos(): THREE.Vector3;
  /** Team HQ centers (team 0, team 1). */
  hqCenter(team: TeamId): THREE.Vector3;
}

export interface ObjectiveSource {
  zones: readonly ZoneState[];
  tickets: [number, number];
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _dir = new THREE.Vector3();

interface ZoneView extends ObjectiveView {
  /** Soldiers of each team near the zone. */
  n: [number, number];
}

export class AIDirector implements BotWorld {
  readonly brains = new Map<number, BotBrain>();
  readonly squads: Squad[] = [];
  readonly rng = new Rng(9001);
  profile: AimProfile;
  difficulty: Difficulty;
  objectives: (() => ObjectiveSource | null) | null = null;

  private coverGrid = new Map<number, CoverPoint[]>();
  private coverClaims = new Map<CoverPoint, number>();
  private pathQueue: { b: BotBrain; to: THREE.Vector3 }[] = [];
  private lodT = 0;
  private squadIdx = 0;
  private views: ZoneView[] = [];
  /** Stats for the debug readout. */
  pathsServed = 0;

  constructor(
    readonly host: AIHost,
    covers: readonly CoverPoint[],
    difficulty: Difficulty,
  ) {
    this.difficulty = difficulty;
    this.profile = A.difficulty[difficulty];
    for (const c of covers) {
      const k = this.cellKey(Math.floor(c.pos.x / COVER_CELL), Math.floor(c.pos.z / COVER_CELL));
      let l = this.coverGrid.get(k);
      if (!l) this.coverGrid.set(k, (l = []));
      l.push(c);
    }
    host.events.on('shot', (e) => this.onShot(e.soldier, e.pos, e.dir));
    host.events.on('damaged', (e) => {
      const b = this.brains.get(e.victim.id);
      if (b && e.attacker && e.attacker.team !== e.victim.team) b.onThreat(e.attacker, A.suppression.perHit, this);
    });
    host.events.on('death', (e) => {
      const b = this.brains.get(e.victim.id);
      if (b) b.reset(this);
      for (const o of this.brains.values()) if (o.target === e.victim) o.target = null;
    });
  }

  setDifficulty(d: Difficulty): void {
    this.difficulty = d;
    this.profile = A.difficulty[d];
  }

  // ---- BotWorld --------------------------------------------------------------------------------
  get time(): number {
    return this.host.time;
  }
  get soldiers(): readonly Soldier[] {
    return this.host.soldiers;
  }
  get interactives(): Interactives {
    return this.host.interactives;
  }

  canSee(from: THREE.Vector3, to: THREE.Vector3): boolean {
    _dir.subVectors(to, from);
    const d = _dir.length();
    if (d < 0.01) return true;
    _dir.multiplyScalar(1 / d);
    const h = this.host.collision.raycast(from, _dir, d - 0.3, { worldOnly: true, sight: true });
    if (h) return false;
    return !this.host.smokeBlocks(from, to);
  }

  private cellKey(cx: number, cz: number): number {
    return (cx + 1000) * 4096 + (cz + 1000);
  }

  coversNear(p: THREE.Vector3, r: number): readonly CoverPoint[] {
    const out: CoverPoint[] = [];
    const c0x = Math.floor((p.x - r) / COVER_CELL), c1x = Math.floor((p.x + r) / COVER_CELL);
    const c0z = Math.floor((p.z - r) / COVER_CELL), c1z = Math.floor((p.z + r) / COVER_CELL);
    for (let cx = c0x; cx <= c1x; cx++)
      for (let cz = c0z; cz <= c1z; cz++) {
        const l = this.coverGrid.get(this.cellKey(cx, cz));
        if (!l) continue;
        for (const c of l) if (Math.hypot(c.pos.x - p.x, c.pos.z - p.z) <= r) out.push(c);
      }
    return out;
  }

  coverOwner(c: CoverPoint): number {
    return this.coverClaims.get(c) ?? -1;
  }

  claimCover(c: CoverPoint | null, prev: CoverPoint | null, by: Soldier): void {
    if (prev && this.coverClaims.get(prev) === by.id) this.coverClaims.delete(prev);
    if (c) this.coverClaims.set(c, by.id);
  }

  fragsNear(p: THREE.Vector3, r: number): readonly { pos: THREE.Vector3 }[] {
    return this.host.fragsNear(p, r);
  }

  requestPath(b: BotBrain, to: THREE.Vector3): void {
    const i = this.pathQueue.findIndex((q) => q.b === b);
    if (i >= 0) this.pathQueue[i].to.copy(to);
    else this.pathQueue.push({ b, to: to.clone() });
  }

  randomNavPoint(around: THREE.Vector3, r: number, out: THREE.Vector3): boolean {
    const nav = this.host.nav;
    if (nav && nav.randomAround(around, r, out, () => this.rng.next())) return true;
    const a = this.rng.next() * Math.PI * 2, d = Math.sqrt(this.rng.next()) * r;
    out.set(around.x + Math.cos(a) * d, around.y, around.z + Math.sin(a) * d);
    return true;
  }

  spot(by: Soldier, target: Soldier): void {
    target.spottedUntil = this.time + A.spotting.duration;
    target.spottedByTeam = by.team;
    by.stats.spots++;
    this.host.events.emit('spotted', { soldier: target, by });
  }

  ping(by: Soldier, pos: THREE.Vector3, kind: string): void {
    this.host.events.emit('ping', { soldier: by, pos: pos.clone(), kind });
  }

  threatBearing(team: number, from: THREE.Vector3): number {
    const hq = this.host.hqCenter(team === 0 ? 1 : 0);
    return yawOf(hq.x - from.x, hq.z - from.z);
  }

  /** Compact state summary for debug readouts and automated runs. */
  summary(): Record<string, unknown> {
    const modes: Record<string, number> = {};
    for (const b of this.brains.values()) {
      const k = !b.s.alive ? 'dead' : b.s.downed ? 'downed' : b.mode;
      modes[k] = (modes[k] ?? 0) + 1;
    }
    const orders = this.squads.map((q) => `${q.team}${q.order.kind[0]}${q.order.zone ?? '-'}`).join(' ');
    return { modes, orders, paths: this.pathsServed, queue: this.pathQueue.length };
  }

  // ---- Roster ----------------------------------------------------------------------------------
  addBot(s: Soldier): BotBrain {
    const b = new BotBrain(s);
    this.brains.set(s.id, b);
    return b;
  }

  brain(s: Soldier): BotBrain | undefined {
    return this.brains.get(s.id);
  }

  /** Builds squads of four per team (the player joins the first squad of team 0). */
  buildSquads(): void {
    this.squads.length = 0;
    const size = TUNING.sector.squadSize;
    for (const team of [0, 1] as TeamId[]) {
      const members = this.soldiers.filter((s) => s.team === team && !s.dummy);
      members.sort((a, b) => (a.isPlayer ? -1 : b.isPlayer ? 1 : a.id - b.id));
      for (let i = 0; i < members.length; i += size) {
        const sq = new Squad(this.squads.length, team, SQUAD_NAMES[Math.floor(i / size) % SQUAD_NAMES.length]);
        for (const m of members.slice(i, i + size)) {
          sq.members.push(m);
          m.squadId = sq.id;
          const b = this.brains.get(m.id);
          if (b) b.squad = sq;
        }
        this.squads.push(sq);
      }
    }
  }

  squadOf(s: Soldier): Squad | null {
    return s.squadId >= 0 ? (this.squads[s.squadId] ?? null) : null;
  }

  // ---- Update ----------------------------------------------------------------------------------
  update(dt: number): void {
    // Level of detail by distance to the camera.
    this.lodT -= dt;
    if (this.lodT <= 0) {
      this.lodT = A.lod.refresh;
      const cam = this.host.cameraPos();
      const L = A.lod;
      for (const s of this.soldiers) {
        if (s.isPlayer) {
          s.lod = 0;
          continue;
        }
        const d = s.pos.distanceTo(cam);
        s.lod = d < L.nearRange ? 0 : d < L.midRange ? 1 : 2;
      }
    }
    // Squad objectives: at most a few evaluations per tick, each squad every evalEvery seconds.
    const obj = this.objectives?.() ?? null;
    if (obj && this.squads.length) {
      let budget = A.squad.evalsPerTick;
      let viewsBuilt = false;
      for (let k = 0; k < this.squads.length && budget > 0; k++) {
        const sq = this.squads[this.squadIdx++ % this.squads.length];
        if (this.time < sq.evalT && sq.order.kind !== 'roam') continue;
        if (!sq.leader()) continue;
        if (!viewsBuilt) {
          this.buildViews(obj);
          viewsBuilt = true;
        }
        budget--;
        sq.evalT = this.time + A.squad.evalEvery * (0.8 + this.rng.next() * 0.4);
        const assigned = new Map<ZoneId, number>();
        for (const o of this.squads) if (o !== sq && o.team === sq.team && o.order.zone && o.order.kind !== 'regroup') assigned.set(o.order.zone, (assigned.get(o.order.zone) ?? 0) + 1);
        sq.evaluate(this.viewsFor(sq.team), obj.tickets, assigned, () => this.rng.next(), this.profile.flankChance);
      }
    }
    // Path requests within budget.
    const nav = this.host.nav;
    for (let k = 0; k < A.lod.pathBudget && this.pathQueue.length; k++) {
      const q = this.pathQueue.shift()!;
      const s = q.b.s;
      if (!s.alive) {
        q.b.pathPending = false;
        continue;
      }
      const out: THREE.Vector3[] = [];
      if (nav && nav.findPath(s.pos, q.to, out) && out.length) q.b.setPath(out);
      else q.b.setPath([q.to.clone()]);
      this.pathsServed++;
    }
    for (const b of this.brains.values()) b.tick(dt, this);
  }

  private viewsFor(team: TeamId): ObjectiveView[] {
    const enemy = team === 0 ? 1 : 0;
    for (const v of this.views) v.enemiesNear = v.n[enemy];
    return this.views;
  }

  private buildViews(obj: ObjectiveSource): void {
    if (this.views.length !== obj.zones.length) {
      this.views = obj.zones.map((z) => ({ id: z.id, x: z.x, z: z.z, radius: z.radius, owner: z.owner, contested: z.contested, capturing: z.capturing, enemiesNear: 0, n: [0, 0] as [number, number] }));
    }
    for (let i = 0; i < obj.zones.length; i++) {
      const z = obj.zones[i];
      const v = this.views[i];
      v.owner = z.owner;
      v.contested = z.contested;
      v.capturing = z.capturing;
      v.n[0] = 0;
      v.n[1] = 0;
    }
    // Known enemies: soldiers within 1.6 zone radii (a team "knows" about bodies near its zones).
    for (const s of this.soldiers) {
      if (!s.alive) continue;
      for (const v of this.views) {
        if (Math.hypot(s.pos.x - v.x, s.pos.z - v.z) < v.radius * 1.6) v.n[s.team]++;
      }
    }
  }

  /** Near misses suppress enemies close to the shot line and alert them to the shooter. */
  private onShot(shooter: Soldier, pos: THREE.Vector3, dir: THREE.Vector3): void {
    const S = A.suppression;
    for (const b of this.brains.values()) {
      const s = b.s;
      if (s.team === shooter.team || !s.alive) continue;
      chestPoint(s, _v);
      _v2.subVectors(_v, pos);
      const t = _v2.dot(dir);
      if (t <= 0 || t > S.maxShotRange) continue;
      _v2.addScaledVector(dir, -t);
      const perp = _v2.length();
      if (perp < S.nearMissRadius) b.onThreat(shooter, S.perNearMiss * (1 - perp / S.nearMissRadius), this);
    }
  }
}
