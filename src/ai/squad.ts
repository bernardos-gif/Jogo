// Squads of four: shared order (attack, defend or regroup on a zone), a flank point for some
// members, and the utility evaluation that picks the squad's objective.
import * as THREE from 'three';
import { TUNING } from '../config/tuning';
import { chooseObjective, type ObjectiveView, type OrderKind } from './utility';
import type { Soldier } from '../player/soldier';
import type { TeamId, ZoneId } from '../config/content';

export const SQUAD_NAMES = ['Aster', 'Bastion', 'Cinder', 'Drift', 'Ember', 'Flux', 'Gale', 'Halo', 'Ion', 'Juniper', 'Kite', 'Lumen'];

export interface SquadOrder {
  kind: OrderKind | 'regroup' | 'roam';
  zone: ZoneId | null;
  /** Zone center (or rally point) and the radius to spread within. */
  pos: THREE.Vector3;
  radius: number;
  /** Approach waypoint for flankers (null when the squad attacks head-on). */
  flank: THREE.Vector3 | null;
  score: number;
}

export class Squad {
  readonly members: Soldier[] = [];
  order: SquadOrder = { kind: 'roam', zone: null, pos: new THREE.Vector3(), radius: 20, flank: null, score: 0 };
  evalT = 0;
  /** Members (by id) assigned to take the flank route this order. */
  readonly flankers = new Set<number>();

  constructor(
    readonly id: number,
    readonly team: TeamId,
    readonly name: string,
  ) {}

  leader(): Soldier | null {
    for (const m of this.members) if (m.alive && !m.downed) return m;
    return null;
  }

  aliveCount(): number {
    let n = 0;
    for (const m of this.members) if (m.alive) n++;
    return n;
  }

  centroid(out: THREE.Vector3): THREE.Vector3 | null {
    out.set(0, 0, 0);
    let n = 0;
    for (const m of this.members)
      if (m.alive) {
        out.add(m.pos);
        n++;
      }
    return n ? out.multiplyScalar(1 / n) : null;
  }

  /**
   * Re-evaluates the objective. `assigned` counts other squads per zone; `rnd` decides flanking.
   * `regroupFrom` is the squad spread (max member distance from the leader).
   */
  evaluate(zones: readonly ObjectiveView[], tickets: [number, number], assigned: ReadonlyMap<ZoneId, number>, rnd: () => number, flankChance: number): void {
    const W = TUNING.ai.squad;
    const lead = this.leader();
    if (!lead) return;
    // Regroup when the squad is badly spread out and not under an urgent defend order.
    let spread = 0;
    for (const m of this.members) if (m.alive && m !== lead) spread = Math.max(spread, m.pos.distanceTo(lead.pos));
    const choice = chooseObjective({ team: this.team, x: lead.pos.x, z: lead.pos.z, squadSize: this.aliveCount(), tickets, zones, assigned }, this.order.zone);
    if (!choice) {
      this.order = { kind: 'roam', zone: null, pos: lead.pos.clone(), radius: 40, flank: null, score: 0 };
      return;
    }
    const z = zones.find((o) => o.id === choice.zone)!;
    const changed = choice.zone !== this.order.zone || choice.kind !== this.order.kind;
    if (spread > W.regroupDistance && choice.kind !== 'defend' && rnd() < W.regroupChance) {
      this.order = { kind: 'regroup', zone: choice.zone, pos: lead.pos.clone(), radius: 8, flank: null, score: choice.score };
      return;
    }
    if (!changed && this.order.kind !== 'regroup') {
      this.order.score = choice.score;
      return;
    }
    const pos = new THREE.Vector3(z.x, 0, z.z);
    let flank: THREE.Vector3 | null = null;
    this.flankers.clear();
    if (choice.kind === 'attack' && rnd() < flankChance) {
      // Flank point: off to one side of the approach line, short of the zone.
      const dx = z.x - lead.pos.x, dz = z.z - lead.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      if (d > W.flankOffset * 1.5) {
        const side = rnd() < 0.5 ? -1 : 1;
        flank = new THREE.Vector3(z.x - (dx / d) * W.flankOffset * 0.6 + (-dz / d) * W.flankOffset * side, 0, z.z - (dz / d) * W.flankOffset * 0.6 + (dx / d) * W.flankOffset * side);
        // Half the squad (rounded up) takes the flank.
        let k = 0;
        for (const m of this.members) if (m.alive && k++ % 2 === 0) this.flankers.add(m.id);
      }
    }
    this.order = { kind: choice.kind, zone: choice.zone, pos, radius: z.radius * (choice.kind === 'defend' ? W.defendRadius : 0.6), flank, score: choice.score };
  }
}
