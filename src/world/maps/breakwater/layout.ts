// Breakwater Launch Port layout: zone anchors, HQs, the sea line, the road network and vehicle
// pads. North is -Z. Halcyon Accord (team 0) holds the south, Korvath Pact (team 1) the north.
import * as THREE from 'three';
import { TUNING } from '../../../config/tuning';
import type { ZoneId, TeamId, VehicleKind } from '../../../config/content';

export const MAP_SIZE = 1200;
export const SEA_X = 470;
export const WATER_LEVEL = 0.4;

export interface ZoneDef {
  id: ZoneId;
  center: THREE.Vector3;
  radius: number;
  /** Flattened pad radius and target height. */
  padRadius: number;
  padHeight: number;
}

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export const ZONE_DEFS: ZoneDef[] = [
  { id: 'A', center: v(-340, 0, 230), radius: 34, padRadius: 95, padHeight: 6 },
  { id: 'B', center: v(352, 0, 238), radius: 34, padRadius: 105, padHeight: 3.2 },
  { id: 'C', center: v(0, 0, 0), radius: 32, padRadius: 95, padHeight: 8 },
  { id: 'D', center: v(-330, 0, -265), radius: 38, padRadius: 120, padHeight: 7 },
  { id: 'E', center: v(330, 0, -275), radius: 32, padRadius: 70, padHeight: 46 },
];

export interface HqDef {
  team: TeamId;
  center: THREE.Vector3;
  facing: number;
  /** Vehicle pads: kind, position, yaw. */
  pads: { kind: VehicleKind; pos: THREE.Vector3; yaw: number }[];
}

export const HQS: HqDef[] = [
  {
    team: 0,
    center: v(0, 0, 525),
    facing: 0,
    pads: [
      { kind: 'basalt', pos: v(-40, 0, 515), yaw: 0 },
      { kind: 'wisp', pos: v(-18, 0, 500), yaw: 0 },
      { kind: 'wisp', pos: v(18, 0, 500), yaw: 0 },
      { kind: 'midge', pos: v(45, 0, 530), yaw: 0 },
      { kind: 'condor', pos: v(75, 0, 540), yaw: 0 },
    ],
  },
  {
    team: 1,
    center: v(0, 0, -525),
    facing: Math.PI,
    pads: [
      { kind: 'basalt', pos: v(40, 0, -515), yaw: Math.PI },
      { kind: 'wisp', pos: v(18, 0, -500), yaw: Math.PI },
      { kind: 'wisp', pos: v(-18, 0, -500), yaw: Math.PI },
      { kind: 'midge', pos: v(-45, 0, -530), yaw: Math.PI },
      { kind: 'condor', pos: v(-75, 0, -540), yaw: Math.PI },
    ],
  },
];

export const HQ_RADIUS = 70;

/** Road polylines (x, z). Heights follow the smoothed terrain. */
export const ROADS: [number, number][][] = [
  // South HQ to A and B.
  [[0, 520], [-60, 420], [-200, 330], [-300, 250]],
  [[0, 520], [70, 430], [220, 330], [320, 260]],
  // North HQ to D and E.
  [[0, -520], [-70, -430], [-210, -340], [-300, -280]],
  [[0, -520], [60, -440], [170, -380], [250, -360]],
  // Ring: A - D (west), B - E (east), A - B (south), D - E (north).
  [[-345, 200], [-380, 80], [-385, -60], [-350, -200]],
  [[355, 205], [400, 90], [410, -40], [380, -150], [300, -200]],
  [[-300, 250], [-150, 200], [0, 170], [150, 200], [320, 250]],
  [[-300, -280], [-150, -230], [0, -210], [150, -260], [250, -330]],
  // Spokes to the core plaza.
  [[0, 170], [10, 90], [0, 45]],
  [[0, -210], [-10, -110], [0, -45]],
  [[-385, -10], [-220, -5], [-60, 0]],
  [[410, -20], [240, 10], [60, 0]],
  // Ridge switchbacks up to E.
  [[250, -360], [210, -300], [260, -250], [300, -300], [330, -275]],
];
export const ROAD_HALF_WIDTH = 5;

/** Map limit (soldiers outside get an out-of-bounds warning). */
export const COMBAT_LIMIT = TUNING.movement.mapLimit;
