// Breakwater terrain: FBM rolling ground, a ridge hill under E, mountains at the north / west /
// south edges, a beach and shallow sea to the east, flattened district pads, HQ pads and roads.
import * as THREE from 'three';
import { fbm, ridged } from '../../noise';
import { smoothstep, lerp } from '../../../core/math';
import { ZONE_DEFS, HQS, HQ_RADIUS, ROADS, ROAD_HALF_WIDTH, SEA_X, WATER_LEVEL } from './layout';
import type { Surface } from '../../surface';

const SEED = 4242;

/** Large-scale terrain without pads and roads (roads follow this smoothed shape). */
function base(x: number, z: number): number {
  let h = fbm(x * 0.0022, z * 0.0022, 3, SEED) * 14 + 8;
  h += fbm(x * 0.009, z * 0.009, 4, SEED + 7) * 3.5;
  // Ridge hill beneath E.
  const e = ZONE_DEFS[4].center;
  const de = Math.hypot(x - e.x, z - e.z);
  h += 44 * Math.exp(-(de * de) / (2 * 95 * 95));
  // Edge mountains (not on the sea side).
  const edgeN = smoothstep(500, 600, -z);
  const edgeS = smoothstep(500, 600, z);
  const edgeW = smoothstep(480, 600, -x);
  const mount = Math.max(edgeN, edgeS, edgeW) * (1 - smoothstep(380, 470, x));
  h += mount * (30 + ridged(x * 0.006, z * 0.006, 4, SEED + 3) * 55);
  // Beach and seabed to the east.
  const shore = smoothstep(SEA_X - 40, SEA_X + 30, x);
  h = lerp(h, WATER_LEVEL - 1.4 + fbm(x * 0.02, z * 0.02, 2, SEED + 9) * 0.3, shore);
  return h;
}

function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

/** Distance to the nearest road centerline. */
export function roadDistance(x: number, z: number): number {
  let best = Infinity;
  for (const r of ROADS) for (let i = 0; i < r.length - 1; i++) best = Math.min(best, distToSegment(x, z, r[i][0], r[i][1], r[i + 1][0], r[i + 1][1]));
  return best;
}

/** Smoothed road surface height (averages the base terrain over a wide kernel). */
function roadHeight(x: number, z: number): number {
  let s = 0;
  const k = 14;
  for (const [ox, oz] of [[0, 0], [k, 0], [-k, 0], [0, k], [0, -k]]) s += base(x + ox, z + oz);
  return s / 5;
}

export function terrainHeight(x: number, z: number): number {
  let h = base(x, z);
  // District pads.
  for (const zd of ZONE_DEFS) {
    const d = Math.hypot(x - zd.center.x, z - zd.center.z);
    const w = 1 - smoothstep(zd.padRadius * 0.75, zd.padRadius, d);
    if (w > 0) h = lerp(h, zd.padHeight, w);
  }
  // HQ pads.
  for (const hq of HQS) {
    const d = Math.hypot(x - hq.center.x, z - hq.center.z);
    const w = 1 - smoothstep(HQ_RADIUS * 0.9, HQ_RADIUS * 1.5, d);
    if (w > 0) h = lerp(h, 6, w);
  }
  // Roads.
  const rd = roadDistance(x, z);
  if (rd < ROAD_HALF_WIDTH + 10) {
    const w = 1 - smoothstep(ROAD_HALF_WIDTH, ROAD_HALF_WIDTH + 10, rd);
    let target = roadHeight(x, z);
    for (const zd of ZONE_DEFS) {
      const d = Math.hypot(x - zd.center.x, z - zd.center.z);
      target = lerp(target, zd.padHeight, 1 - smoothstep(zd.padRadius * 0.75, zd.padRadius, d));
    }
    for (const hq of HQS) target = lerp(target, 6, 1 - smoothstep(HQ_RADIUS * 0.9, HQ_RADIUS * 1.5, Math.hypot(x - hq.center.x, z - hq.center.z)));
    h = lerp(h, target, w);
  }
  return h;
}

const SAND = new THREE.Color(0xc9a77c);
const SAND_WET = new THREE.Color(0x9a8470);
const GRASS = new THREE.Color(0x9a9a5a);
const GRASS2 = new THREE.Color(0x8a8e50);
const DIRT = new THREE.Color(0xa08868);
const ROCK = new THREE.Color(0x8a7464);
const ROCK_D = new THREE.Color(0x6a5a52);
const PAD = new THREE.Color(0xcdbba2);
const PAD2 = new THREE.Color(0xc2ae95);
const ROAD = new THREE.Color(0x8a7c6e);
const _c = new THREE.Color();

function inPad(x: number, z: number): boolean {
  for (const zd of ZONE_DEFS) if (Math.hypot(x - zd.center.x, z - zd.center.z) < zd.padRadius * 0.72) return true;
  for (const hq of HQS) if (Math.hypot(x - hq.center.x, z - hq.center.z) < HQ_RADIUS * 0.85) return true;
  return false;
}

export function terrainColor(x: number, z: number, y: number, slope: number, out: THREE.Color): void {
  const n = fbm(x * 0.03, z * 0.03, 2, SEED + 11);
  if (x > SEA_X - 30 && y < WATER_LEVEL + 1.5) out.copy(y < WATER_LEVEL ? SAND_WET : SAND);
  else if (inPad(x, z) && slope < 0.2) out.copy(((Math.floor(x / 8) + Math.floor(z / 8)) & 1) ? PAD : PAD2);
  else if (roadDistance(x, z) < ROAD_HALF_WIDTH + 1.5) out.copy(ROAD);
  else if (slope > 0.45) out.copy(n > 0 ? ROCK : ROCK_D);
  else if (y > 30) out.copy(_c.copy(GRASS2).lerp(ROCK, smoothstep(30, 70, y)));
  else if (n > 0.25) out.copy(DIRT);
  else out.copy(n > -0.2 ? GRASS : GRASS2);
  out.offsetHSL(0, 0, n * 0.03);
}

export function terrainSurface(x: number, z: number): Surface {
  const y = terrainHeight(x, z);
  if (x > SEA_X - 20 && y < WATER_LEVEL) return 'water';
  if (x > SEA_X - 30) return 'sand';
  if (inPad(x, z)) return 'concrete';
  if (roadDistance(x, z) < ROAD_HALF_WIDTH) return 'concrete';
  return y > 30 ? 'dirt' : 'grass';
}
