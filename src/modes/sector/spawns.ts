// Spawn rules: HQ always; owned zones that are not contested or under capture; squadmates who
// are alive, on their feet, out of combat and have no enemy close by.
import * as THREE from 'three';
import { TUNING } from '../../config/tuning';
import type { Soldier } from '../../player/soldier';
import type { TeamId, ZoneId } from '../../config/content';
import type { ZoneState } from './logic';

export type SpawnKind = 'hq' | 'zone' | 'squad';

export interface SpawnOption {
  kind: SpawnKind;
  /** HQ: 'hq'; zone: its id; squad: the squadmate's soldier id. */
  key: string;
  label: string;
  pos: THREE.Vector3;
  zone?: ZoneId;
  mate?: Soldier;
}

/** True when the squadmate is a valid spawn beacon at `time`. */
export function squadmateSpawnable(m: Soldier, soldiers: readonly Soldier[], time: number, S = TUNING.sector): boolean {
  if (!m.alive || m.downed || m.inVehicle) return false;
  if (m.state !== 'ground' && m.state !== 'slide') return false;
  if (time - m.lastCombatT < S.squadSpawnCombatSeconds) return false;
  const r2 = S.squadSpawnEnemyRadius * S.squadSpawnEnemyRadius;
  for (const e of soldiers) if (e.team !== m.team && e.alive && e.pos.distanceToSquared(m.pos) < r2) return false;
  return true;
}

/** A zone can be spawned on when the team owns it and nobody is taking it. */
export function zoneSpawnable(z: ZoneState, team: TeamId): boolean {
  return z.owner === team && !z.contested && (z.capturing === -1 || z.capturing === team);
}

export function spawnOptions(team: TeamId, zones: readonly ZoneState[], hq: THREE.Vector3, squad: readonly Soldier[], self: Soldier | null, soldiers: readonly Soldier[], time: number): SpawnOption[] {
  const out: SpawnOption[] = [{ kind: 'hq', key: 'hq', label: 'HQ', pos: hq.clone() }];
  for (const z of zones) if (zoneSpawnable(z, team)) out.push({ kind: 'zone', key: z.id, label: z.id, pos: new THREE.Vector3(z.x, 0, z.z), zone: z.id });
  for (const m of squad) if (m !== self && squadmateSpawnable(m, soldiers, time)) out.push({ kind: 'squad', key: `s${m.id}`, label: m.name, pos: m.pos.clone(), mate: m });
  return out;
}
