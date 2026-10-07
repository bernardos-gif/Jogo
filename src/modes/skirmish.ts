// Skirmish: 8 v 8 infantry in the middle of Breakwater. No capture, no vehicles: the first team to
// the kill target (or the team ahead when the clock runs out) wins. Squads roam between the middle
// sectors, which double as drop points: you deploy beside a sector with no enemies near it, or on a
// squadmate, and respawns are quick.
import * as THREE from 'three';
import { TUNING } from '../config/tuning';
import type { TeamId, ZoneId } from '../config/content';
import { SectorMode } from './sector/sectorMode';
import { squadmateSpawnable, type SpawnOption } from './sector/spawns';
import type { Battle } from './battle';
import type { ModeHudInfo } from './mode';
import { newZone, type Owner, type ZoneState } from './sector/logic';
import type { Soldier } from '../player/soldier';

const K = TUNING.skirmish;

/** Kill tally for a death: the killer's team scores, or the other team when nobody (or a teammate) did it. */
export function scoringTeam(victimTeam: TeamId, killerTeam: TeamId | null): TeamId {
  if (killerTeam !== null && killerTeam !== victimTeam) return killerTeam;
  return victimTeam === 0 ? 1 : 0;
}

/** Winner from the tally: the leader, or -1 for a draw. */
export function skirmishWinner(kills: readonly [number, number]): Owner {
  return kills[0] === kills[1] ? -1 : kills[0] > kills[1] ? 0 : 1;
}

export class SkirmishMode extends SectorMode {
  override readonly id: string = 'skirmish';
  override readonly modeName: string = 'Skirmish';
  readonly kills: [number, number] = [0, 0];
  timeLeft: number = K.timeLimit;
  private arena: ZoneState[] = [];
  private labels = new Map<ZoneId, string>();
  private presenceT = 0;

  /** Five drop points in and around Core Plaza: the arena, built once the map's zones exist. */
  private get hotspots(): ZoneState[] {
    if (!this.arena.length && this.zones.length) {
      const c = this.zones.find((z) => z.id === 'C') ?? this.zones[0];
      const R = K.arenaRing;
      const pts: [ZoneId, number, number, string][] = [
        ['C', 0, 0, 'Plaza'],
        ['A', 0, R, 'Plaza south'],
        ['B', R, 0, 'Plaza east'],
        ['D', 0, -R, 'Plaza north'],
        ['E', -R, 0, 'Plaza west'],
      ];
      for (const [id, dx, dz, label] of pts) {
        const x = c.x + dx, z = c.z + dz;
        this.arena.push(newZone(id, x, z, K.hotspotRadius, -1, this.b.terrain.heightAt(x, z)));
        this.labels.set(id, label);
      }
    }
    return this.arena;
  }

  constructor(opts: { managedPlayer?: boolean } = {}) {
    super({ teamSize: K.teamSize, managedPlayer: opts.managedPlayer });
    this.vehiclesEnabled = false;
    this.respawnDelay = K.respawnDelay;
  }

  override setup(b: Battle): void {
    this.arena = [];
    super.setup(b);
    // Squads roam between the middle sectors (nobody can own them).
    b.ai.objectives = () => ({ zones: this.hotspots, tickets: [K.killTarget - this.kills[0], K.killTarget - this.kills[1]] });
  }

  protected override watchDeaths(): void {
    this.off.push(
      this.b.events.on('kill', (e) => {
        if (this.state !== 'playing') return;
        const t = scoringTeam(e.victim.team, e.killer ? e.killer.team : null);
        this.kills[t]++;
        if (this.kills[t] >= K.killTarget) this.end();
      }),
    );
  }

  override scores(): [number, number] {
    return [this.kills[0], this.kills[1]];
  }

  override get scoreLabel(): string {
    return 'Kills';
  }

  override get scoreMax(): number {
    return K.killTarget;
  }

  protected override decideWinner(): Owner {
    return skirmishWinner(this.kills);
  }

  protected override resetScores(): void {
    this.kills[0] = 0;
    this.kills[1] = 0;
    this.timeLeft = K.timeLimit;
    for (const z of this.arena) {
      z.owner = -1;
      z.contested = false;
    }
  }

  /** No capture: hotspots belong to whoever stands at them (bots chase that), and the clock runs. */
  protected override stepObjectives(dt: number): boolean {
    this.presenceT -= dt;
    if (this.presenceT <= 0) {
      this.presenceT = 1;
      for (const z of this.hotspots) {
        const n = [0, 0];
        for (const s of this.b.soldiers) if (s.active && Math.hypot(s.pos.x - z.x, s.pos.z - z.z) < z.radius * K.presenceRadiusMul) n[s.team]++;
        z.contested = n[0] > 0 && n[1] > 0;
        if (n[0] !== n[1]) z.owner = n[0] > n[1] ? 0 : 1;
      }
    }
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      this.end();
      return true;
    }
    return false;
  }

  /** Drop points beside the middle sectors with no enemy close, plus squadmates out of combat. */
  override options(s: Soldier): SpawnOption[] {
    const b = this.b;
    const r2 = K.dropEnemyRadius * K.dropEnemyRadius;
    const out: SpawnOption[] = [];
    let safest: ZoneState | null = null;
    let safestD = -1;
    for (const z of this.hotspots) {
      let nearest = Infinity;
      for (const e of b.soldiers) if (e.team !== s.team && e.alive) nearest = Math.min(nearest, (e.pos.x - z.x) ** 2 + (e.pos.z - z.z) ** 2);
      if (nearest > safestD) {
        safestD = nearest;
        safest = z;
      }
      if (nearest > r2) out.push({ kind: 'zone', key: z.id, label: this.labels.get(z.id) ?? z.id, pos: new THREE.Vector3(z.x, 0, z.z), zone: z.id });
    }
    if (!out.length && safest) out.push({ kind: 'zone', key: safest.id, label: this.labels.get(safest.id) ?? safest.id, pos: new THREE.Vector3(safest.x, 0, safest.z), zone: safest.id });
    const sq = b.ai.squadOf(s);
    if (sq) for (const m of sq.members) if (m !== s && squadmateSpawnable(m, b.soldiers, b.time)) out.push({ kind: 'squad', key: `s${m.id}`, label: m.name, pos: m.pos.clone(), mate: m });
    return out;
  }

  protected override chooseBotSpawn(s: Soldier): SpawnOption {
    const opts = this.options(s);
    const mates = opts.filter((o) => o.kind === 'squad');
    if (mates.length && this.b.rng.next() < TUNING.ai.squad.squadSpawnChance) return mates[Math.floor(this.b.rng.next() * mates.length)];
    const drops = opts.filter((o) => o.kind === 'zone');
    return drops[Math.floor(this.b.rng.next() * drops.length)] ?? opts[0];
  }

  /** The round starts with each team at the drop points on its own side. */
  protected override deployAll(): void {
    for (const s of this.b.soldiers) {
      if (s.dummy) continue;
      if (s.isPlayer && !this.autoDeployPlayer) {
        this.b.park(s, this.hqCenter(s.team));
        continue;
      }
      this.deploy(s, this.chooseBotSpawn(s));
    }
  }

  override hudInfo(): ModeHudInfo {
    return { modeName: this.modeName, zones: [], tickets: null, ticketMax: 1, bleed: [0, 0], kills: this.kills, killTarget: K.killTarget, roundT: this.roundT, timeLeft: this.timeLeft };
  }
}
