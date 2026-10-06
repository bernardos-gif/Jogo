// What a map hands to the battle runtime.
import type * as THREE from 'three';
import type { Terrain } from '../terrain';
import type { WorldBuilder } from '../builder';
import type { ZoneDef, HqDef } from './breakwater/layout';
import type { RocketSpec } from './breakwater/districts';

export interface MapBuild {
  id: 'training' | 'breakwater';
  terrain: Terrain;
  builder: WorldBuilder;
  /** Default spawn (training, or fallback). */
  spawn: THREE.Vector3;
  spawnYaw: number;
  /** Firing-lane origin (training only). */
  laneOrigin: THREE.Vector3;
  /** Sea level, or null when the map has no water. */
  water: number | null;
  seaX?: number;
  zones?: ZoneDef[];
  hqs?: HqDef[];
  rocket?: RocketSpec;
  /** Soldiers beyond this half-extent are out of bounds. */
  combatLimit: number;
  /** Road polylines (x, z) and full width, for the tactical map. */
  roads?: [number, number][][];
  roadWidth?: number;
  /** Skirmish arena (a fenced district). */
  skirmish?: { center: THREE.Vector3; radius: number };
}
