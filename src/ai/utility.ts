// Squad objective utility: scores each capture zone for a squad from ownership, contest state,
// distance, known threat, the ticket situation and how many friendly squads already go there.
import { TUNING } from '../config/tuning';
import type { TeamId, ZoneId } from '../config/content';
import type { Owner } from '../modes/sector/logic';

export interface ObjectiveView {
  id: ZoneId;
  x: number;
  z: number;
  radius: number;
  owner: Owner;
  contested: boolean;
  /** Team currently moving the zone's control (-1 when idle). */
  capturing: Owner;
  /** Known enemies of the scoring team near the zone. */
  enemiesNear: number;
}

export type OrderKind = 'attack' | 'defend';

export interface UtilityInput {
  team: TeamId;
  /** Squad position (leader or centroid). */
  x: number;
  z: number;
  squadSize: number;
  tickets: [number, number];
  zones: readonly ObjectiveView[];
  /** Other friendly squads already assigned to each zone. */
  assigned: ReadonlyMap<ZoneId, number>;
}

export interface ObjectiveChoice {
  zone: ZoneId;
  kind: OrderKind;
  score: number;
}

/** Utility of one zone for a squad (higher is better). */
export function zoneUtility(inp: UtilityInput, z: ObjectiveView, W = TUNING.ai.squad): number {
  const enemy: TeamId = inp.team === 0 ? 1 : 0;
  const own = z.owner === inp.team;
  let value: number;
  if (z.owner === -1) value = W.neutral;
  else if (!own) value = W.enemyOwned;
  else if (z.contested || z.capturing === enemy) value = W.ownContested;
  else if (z.enemiesNear > 0) value = W.ownThreatened;
  else value = W.ownSafe;

  // Losing on tickets or zones: zones we do not hold matter more.
  if (!own) {
    const ticketGap = Math.max(0, (inp.tickets[enemy] - inp.tickets[inp.team]) / 200);
    let ownedUs = 0, ownedThem = 0;
    for (const o of inp.zones) {
      if (o.owner === inp.team) ownedUs++;
      else if (o.owner === enemy) ownedThem++;
    }
    const bleedGap = ownedThem >= ownedUs ? 0.5 : 0;
    value += W.ticketPressure * Math.min(1, ticketGap + bleedGap);
  }

  // Overwhelming known threat lowers the value (beyond what the squad can take on).
  const excess = z.enemiesNear - inp.squadSize;
  if (excess > 0) value -= W.threatPerEnemy * excess;

  // Distance cost (per 400 m).
  const d = Math.hypot(z.x - inp.x, z.z - inp.z);
  value -= W.distanceWeight * (d / 400);

  // Spread squads across objectives.
  value -= W.crowding * (inp.assigned.get(z.id) ?? 0);
  return value;
}

/** Picks the best zone, keeping the current one unless another beats it by the hysteresis margin. */
export function chooseObjective(inp: UtilityInput, current: ZoneId | null, W = TUNING.ai.squad): ObjectiveChoice | null {
  let best: ObjectiveChoice | null = null;
  let cur: ObjectiveChoice | null = null;
  for (const z of inp.zones) {
    const score = zoneUtility(inp, z, W);
    const c: ObjectiveChoice = { zone: z.id, kind: z.owner === inp.team ? 'defend' : 'attack', score };
    if (!best || score > best.score) best = c;
    if (z.id === current) cur = c;
  }
  if (cur && best && best.zone !== cur.zone && best.score < cur.score + W.hysteresis) return cur;
  return best;
}
