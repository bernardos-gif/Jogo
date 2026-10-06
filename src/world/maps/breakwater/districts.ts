// District builders for Breakwater Launch Port (A Gantry, B Moorings, C Core Plaza, D Sunfield,
// E Ridgeline), both HQs, road ribbons and scattered props.
import * as THREE from 'three';
import { box, cyl, dodeca, part } from '../../../render/toon';
import { crate, techCrate, barrier, lampPost, antenna, solarPanel, fuelTank, sandbags, container, CONTAINER_COLORS, xf } from '../../../art/props';
import { Frame, building, bunker, latticeTower, gantryCrane, cargoShip, sandbagLine, fenceRun, wallPanelRun, containerWithDoor } from '../../structures';
import { ZONE_DEFS, HQS, ROADS, ROAD_HALF_WIDTH, WATER_LEVEL, HQ_RADIUS } from './layout';
import { terrainHeight } from './terrainFns';
import { FACTION_PALETTES } from '../../../art/palette';
import { Rng } from '../../../core/rng';
import type { WorldBuilder } from '../../builder';
import type { TeamId } from '../../../config/content';

const g = terrainHeight;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const zc = (id: string) => ZONE_DEFS.find((z) => z.id === id)!;

export interface RocketSpec {
  base: THREE.Vector3;
  height: number;
  radius: number;
}

// ---------------------------------------------------------------------------------------------------
export function buildGantry(b: WorldBuilder): RocketSpec {
  const z = zc('A');
  const ph = z.padHeight;
  // Launch pad: raised slab with two ramps.
  const P = V(-372, ph, 196);
  const padTop = ph + 1.8;
  b.solid(V(P.x, ph + 0.9, P.z), V(27, 0.9, 27), 0, 0xa8957e, 'concrete');
  b.deco(box(54.4, 0.3, 54.4, 0x8a7464, { x: P.x, y: padTop + 0.05, z: P.z }));
  for (const s of [-1, 1]) {
    const ang = Math.atan2(1.8, 10);
    b.colliderOriented(V(P.x + s * 32, ph + 0.9, P.z), V(5, 0.15, 6), new THREE.Euler(0, Math.PI / 2, s * ang, 'YXZ'), 'concrete');
    b.deco(box(10.2, 0.3, 12, 0x8a7464, { x: P.x + s * 32, y: ph + 0.9, z: P.z, rz: s * ang }));
  }
  // Flame trench grates and hazard stripes.
  b.deco(box(10, 0.1, 54, 0x2e3038, { x: P.x, y: padTop + 0.12, z: P.z }));
  for (let i = -6; i <= 6; i++) b.deco(box(0.6, 0.12, 2, 0xe0a020, { x: P.x + i * 1.6, y: padTop + 0.13, z: P.z + 27.2 }));
  // Gantry tower with service arms and an elevator.
  const T = new Frame(P.x + 14, padTop, P.z, 0);
  const top = latticeTower(b, T, 56, 8, 0xc04a3a, { step: 10 });
  b.elevator(V(T.cx, padTop + 0.3, T.cz + 6.2), top - 0.1, V(1.8, 0.3, 1.6), 0x5a5f6e, 0x7cf0ff);
  for (const y of [30, 50]) {
    b.solid(V(P.x + 7.5, padTop + y, P.z), V(3.5, 0.15, 1.5), 0, 0x8a90a0, 'sheet', { thin: true });
    b.solid(V(P.x + 7.5, padTop + y + 0.6, P.z + 1.5), V(3.5, 0.45, 0.04), 0, 0xe0a020, 'sheet', { thin: true });
  }
  // Fuel tank cluster (explosive, linked to the launch event).
  const F = V(P.x - 34, ph, P.z + 26);
  for (const [dx, dz] of [[0, 0], [5, 0], [0, 5], [5, 5]]) {
    b.destructible({ kind: 'fuelTank', geo: fuelTank(), matrix: xf({ x: F.x + dx, y: g(F.x + dx, F.z + dz), z: F.z + dz }), hp: 220, surface: 'metal', explosive: true, debris: true, tag: 'rocketFuel' });
  }
  b.solid(V(F.x + 2.5, ph + 0.1, F.z + 2.5), V(6, 0.1, 6), 0, 0x8a7464, 'concrete');
  // Pipes from the tanks to the pad.
  b.deco(part(new THREE.CylinderGeometry(0.25, 0.25, 30, 6), 0x5a5f6e, { x: F.x + 18, y: ph + 0.5, z: F.z - 6, rz: Math.PI / 2, ry: 0.5 }));
  // Blast trenches: paired sandbag lines radiating from the pad.
  for (const a of [0.6, 1.4, 2.4]) {
    const dx = Math.cos(a), dz = Math.sin(a);
    for (const off of [-2.2, 2.2]) {
      const nx = -dz * off, nz = dx * off;
      sandbagLine(b, V(P.x + dx * 32 + nx, 0, P.z + dz * 32 + nz), V(P.x + dx * 64 + nx, 0, P.z + dz * 64 + nz), g);
    }
  }
  // Control bunker and launch control building near the capture zone.
  bunker(b, new Frame(z.center.x + 22, g(z.center.x + 22, z.center.z + 20), z.center.z + 20, Math.PI * 0.85));
  building(b, new Frame(-300, g(-300, 262), 262, Math.PI), { w: 16, d: 12, floors: 2, wall: 0xd8d2c4, trim: 0xc04a3a, glow: 0x7cf0ff, doorsFront: [-3, 4], doorsBack: [0], windows: true });
  // Cover around the capture point.
  zoneCover(b, z.center.x, z.center.z, 7);
  return { base: V(P.x, padTop, P.z), height: 54, radius: 4.4 };
}

// ---------------------------------------------------------------------------------------------------
export function buildMoorings(b: WorldBuilder): void {
  const z = zc('B');
  const ph = z.padHeight;
  // Quay deck along the sea.
  b.solid(V(422, ph - 2.5, 240), V(30, 2.5, 110), 0, 0xb9a68e, 'concrete');
  for (let zz = 135; zz <= 345; zz += 10) b.deco(cyl(0.35, 0.45, 0.8, 8, 0x2e3038, { x: 451, y: ph + 0.4, z: zz }));
  b.deco(box(0.3, 0.12, 220, 0xe0a020, { x: 450.5, y: ph + 0.06, z: 240 }));
  // Ship.
  const ship = new Frame(466, WATER_LEVEL, 240, 0);
  const { deckY } = cargoShip(b, ship, WATER_LEVEL);
  // Gangway ramp from the quay to the deck.
  const ga = V(445, ph, 312), gb = V(455.5, deckY + 0.3, 292);
  const gd = new THREE.Vector3().subVectors(gb, ga);
  const gl = gd.length();
  const yaw = Math.atan2(gd.x, gd.z);
  const pitch = -Math.asin(gd.y / gl);
  const mid = ga.clone().lerp(gb, 0.5);
  b.colliderOriented(mid, V(1.5, 0.12, gl / 2), new THREE.Euler(pitch, yaw, 0, 'YXZ'), 'sheet');
  const gm = box(3, 0.24, gl, 0x8a90a0);
  gm.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ')).setPosition(mid));
  b.deco(gm);
  // Container yard with alleys; leaves the capture area open.
  const rng = new Rng(77);
  for (let gx = 0; gx < 6; gx++) {
    for (let gz = 0; gz < 7; gz++) {
      const x = 306 + gx * 21;
      const zz = 168 + gz * 24;
      if (Math.hypot(x - z.center.x, zz - z.center.z) < 30) continue;
      if (rng.chance(0.18)) continue;
      const stack = 1 + rng.int(3);
      const ry = rng.chance(0.15) ? 0.08 : 0;
      for (let s = 0; s < stack; s++) {
        const color = CONTAINER_COLORS[rng.int(CONTAINER_COLORS.length)];
        const m = xf({ x, y: ph + s * 2.6, z: zz, ry: Math.PI / 2 + ry });
        if (s === 0 && rng.chance(0.25)) containerWithDoor(b, m, color);
        else b.prop(container(color), m, 'metal');
      }
      if (stack === 1) b.cover(V(x, ph, zz + 1.8), V(0, 0, 1), true);
    }
  }
  // Gantry cranes over the quay with a zipline to the ship.
  const c1 = gantryCrane(b, new Frame(422, ph, 196, 0), 22, 34, 0xe0a020);
  gantryCrane(b, new Frame(422, ph, 300, 0), 22, 34, 0xe0a020);
  b.zipline(V(432, ph + c1 + 1.2, 196), V(462, deckY + 2.2, 214));
  // Warehouse and harbor office.
  building(b, new Frame(300, ph, 312, Math.PI), { w: 30, d: 18, floors: 2, floorH: 5, wall: 0x8a90a0, trim: 0x3d6fa8, glow: 0xffcf6a, doorsFront: [-8, 0, 8], doorsBack: [-6, 6], doorsSide: [0], windows: true });
  building(b, new Frame(392, ph, 158, 0), { w: 12, d: 10, floors: 3, wall: 0xd8d2c4, trim: 0x5a5f6e, glow: 0x7cf0ff, doorsFront: [2], doorsBack: [-2], windows: true });
  zoneCover(b, z.center.x, z.center.z, 13);
}

// ---------------------------------------------------------------------------------------------------
export function buildCorePlaza(b: WorldBuilder): void {
  const z = zc('C');
  const ph = z.padHeight;
  const towers = [
    { x: -36, z: -26, w: 16, d: 16, floors: 6, rot: 0 },
    { x: 38, z: -22, w: 18, d: 14, floors: 5, rot: Math.PI },
    { x: 4, z: 38, w: 16, d: 16, floors: 4, rot: Math.PI / 2 },
  ];
  const roofs: THREE.Vector3[] = [];
  for (const t of towers) {
    const f = new Frame(t.x, ph, t.z, t.rot);
    const H = building(b, f, { w: t.w, d: t.d, floors: t.floors, wall: 0x6a7088, trim: 0x2e3038, glow: 0x7cf0ff, doorsFront: [-3, 3], doorsBack: [0], doorsSide: [2], windows: true, parapet: 1.1 });
    roofs.push(f.p(t.w * 0.3, H + 1.6, -t.d * 0.3));
    // Data pillars glowing on the facade.
    for (const sx of [-1, 1]) f.glow(b, box(0.15, H - 1, 0.15, 0x7cf0ff, { x: (sx * t.w) / 2, y: H / 2 + 0.5, z: t.d / 2 + 0.05 }));
  }
  // External elevator on tower 1.
  const t1 = towers[0];
  b.elevator(V(t1.x + t1.w / 2 + 2.2, ph + 0.3, t1.z - 4), t1.floors * 4 + 0.1, V(1.8, 0.3, 1.8), 0x5a5f6e, 0x7cf0ff);
  for (const [dx, dz] of [[-1.9, -1.9], [1.9, -1.9], [1.9, 1.9]]) b.deco(box(0.2, t1.floors * 4 + 3, 0.2, 0x2e3038, { x: t1.x + t1.w / 2 + 2.2 + dx, y: ph + (t1.floors * 4 + 3) / 2, z: t1.z - 4 + dz }));
  // Rooftop ziplines between towers.
  b.zipline(roofs[0], roofs[1]);
  b.zipline(roofs[1], roofs[2]);
  b.zipline(roofs[2], roofs[0]);
  // Covered arcade: pillars and a roof between the towers.
  for (let i = 0; i < 9; i++) {
    const x = -24 + i * 6;
    b.solid(V(x, ph + 2, 8), V(0.4, 2, 0.4), 0, 0x8a90a0, 'concrete');
  }
  b.solid(V(0, ph + 4.2, 8), V(28, 0.2, 3.2), 0, 0x5a5f6e, 'metal');
  b.glow(box(56, 0.06, 0.06, 0x7cf0ff, { y: ph + 4.0, z: 11.2 }));
  // Holo plinths, planters and barriers.
  const rng = new Rng(9);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const r = 22 + rng.range(-3, 4);
    const x = Math.cos(a) * r, zz = Math.sin(a) * r;
    if (i % 2) {
      b.solid(V(x, ph + 0.5, zz), V(1.6, 0.5, 1.6), a, 0x8a7464, 'concrete');
      b.deco(dodeca(1.1, 0x6a9a48, { x, y: ph + 1.4, z: zz }));
    } else {
      b.solid(V(x, ph + 0.6, zz), V(0.6, 0.6, 0.6), a, 0x2e3038, 'metal');
      b.glow(box(1.2, 1.6, 0.05, 0x7cf0ff, { x, y: ph + 2.1, z: zz, ry: a }));
    }
    b.cover(V(x * 1.06, ph, zz * 1.06), V(x, 0, zz).normalize(), i % 2 === 1);
  }
  zoneCover(b, z.center.x, z.center.z, 21);
}

// ---------------------------------------------------------------------------------------------------
export function buildSunfield(b: WorldBuilder): void {
  const z = zc('D');
  const ph = z.padHeight;
  // Solar rows (destructible), with gaps around the capture point.
  for (let row = 0; row < 10; row++) {
    const zz = z.center.z - 85 + row * 17;
    for (let i = 0; i < 20; i++) {
      const x = z.center.x - 95 + i * 10;
      if (Math.hypot(x - z.center.x, zz - z.center.z) < 22) continue;
      b.destructible({ kind: 'solar', geo: solarPanel(), matrix: xf({ x, y: g(x, zz), z: zz, ry: Math.PI }), hp: 70, surface: 'glass', explosive: false, debris: true });
    }
  }
  // Inverter huts.
  for (const [x, zz, r] of [[-410, -200, 0], [-250, -330, Math.PI], [-405, -330, Math.PI / 2]] as const) building(b, new Frame(x, g(x, zz), zz, r), { w: 8, d: 6, floors: 1, wall: 0xd8d2c4, trim: 0x3d6fa8, glow: 0xffcf6a, doorsFront: [0], doorsBack: [], windows: false, stairs: false, parapet: 0.6 });
  // Substation with a destructible fence.
  const S = V(-262, ph, -205);
  const corners = [V(S.x - 14, 0, S.z - 10), V(S.x + 14, 0, S.z - 10), V(S.x + 14, 0, S.z + 10), V(S.x - 14, 0, S.z + 10)];
  for (let i = 0; i < 4; i++) {
    const a = corners[i], c = corners[(i + 1) % 4];
    if (i === 2) {
      fenceRun(b, a, a.clone().lerp(c, 0.4), g);
      fenceRun(b, a.clone().lerp(c, 0.6), c, g);
    } else fenceRun(b, a, c, g);
  }
  for (const [dx, dz] of [[-6, -3], [0, -3], [6, -3], [-3, 4], [5, 4]]) {
    b.solid(V(S.x + dx, ph + 1.4, S.z + dz), V(1.4, 1.4, 1.0), 0, 0x5a5f6e, 'metal');
    b.glow(box(0.2, 0.2, 0.2, 0xffcf6a, { x: S.x + dx, y: ph + 3.0, z: S.z + dz }), true);
  }
  // Kiosk at the point.
  b.solid(V(z.center.x, ph + 1.2, z.center.z), V(1.5, 1.2, 1.5), 0, 0x8a90a0, 'metal');
  b.glow(box(2, 0.1, 2, 0x7cf0ff, { x: z.center.x, y: ph + 2.45, z: z.center.z }));
  zoneCover(b, z.center.x, z.center.z, 31);
}

// ---------------------------------------------------------------------------------------------------
export function buildRidgeline(b: WorldBuilder): void {
  const z = zc('E');
  const rng = new Rng(55);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    const r = 26 + rng.range(-3, 4);
    const x = z.center.x + Math.cos(a) * r, zz = z.center.z + Math.sin(a) * r;
    b.prop(antenna(18 + rng.int(13)), xf({ x, y: g(x, zz), z: zz }), 'metal');
  }
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 1.1;
    const r = 44;
    const x = z.center.x + Math.cos(a) * r, zz = z.center.z + Math.sin(a) * r;
    bunker(b, new Frame(x, g(x, zz), zz, -a + Math.PI / 2));
  }
  // Trench ring of sandbags.
  for (let i = 0; i < 12; i++) {
    if (i % 4 === 1) continue;
    const a0 = (i / 12) * Math.PI * 2, a1 = ((i + 1) / 12) * Math.PI * 2;
    const r = 58;
    sandbagLine(b, V(z.center.x + Math.cos(a0) * r, 0, z.center.z + Math.sin(a0) * r), V(z.center.x + Math.cos(a1) * r, 0, z.center.z + Math.sin(a1) * r), g);
  }
  building(b, new Frame(z.center.x - 8, g(z.center.x - 8, z.center.z - 14), z.center.z - 14, 0.4), { w: 14, d: 10, floors: 2, wall: 0x8a90a0, trim: 0xc04a3a, glow: 0x7cf0ff, doorsFront: [0], doorsBack: [3], windows: true });
  zoneCover(b, z.center.x, z.center.z, 41);
}

// ---------------------------------------------------------------------------------------------------
export function buildHq(b: WorldBuilder, team: TeamId): void {
  const hq = HQS[team];
  const c = hq.center;
  const y = 6;
  const pal = FACTION_PALETTES[team];
  const f = new Frame(c.x, y, c.z, hq.facing);
  // Perimeter walls with a wide front gate.
  const R = HQ_RADIUS - 6;
  for (const [x0, z0, x1, z1] of [[-R, -R, R, -R], [R, -R, R, R], [-R, R, -R, -R]] as const) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
    // Gates in the middle of the side walls.
    const half = len / 2;
    for (const [a, cc] of [[-half, -9], [9, half]]) {
      const seg = (cc - a) / 2;
      const mid = (a + cc) / 2;
      if (alongX) f.solid(b, mx + mid, 2, mz, seg, 2, 0.6, pal.armorShade, 'concrete');
      else f.solid(b, mx, 2, mz + mid, 0.6, 2, seg, pal.armorShade, 'concrete');
    }
  }
  // Front wall (toward the battlefield, -z in frame) with the big gate.
  for (const [a, cc] of [[-R, -14], [14, R]]) f.solid(b, (a + cc) / 2, 2, -R, (cc - a) / 2, 2, 0.6, pal.armorShade, 'concrete');
  for (const x of [-14, 14]) {
    f.solid(b, x, 4, -R, 1.2, 4, 1.2, pal.secondary, 'concrete');
    f.glow(b, box(0.3, 6, 0.3, pal.glow, { x: x * 1.0, y: 4, z: -R - 1.3 }));
  }
  // Command building and spawn plaza.
  building(b, new Frame(f.p(0, 0, 22).x, y, f.p(0, 0, 22).z, hq.facing + Math.PI), { w: 24, d: 14, floors: 2, wall: pal.armor, trim: pal.secondary, glow: pal.glow, doorsFront: [-6, 0, 6], doorsBack: [0], windows: true });
  for (const p of hq.pads) {
    const py = y + 0.05;
    b.deco(cyl(p.kind === 'condor' ? 9 : p.kind === 'midge' ? 6.5 : 5, p.kind === 'condor' ? 9 : p.kind === 'midge' ? 6.5 : 5, 0.15, 24, 0x5a5f6e, { x: p.pos.x, y: py, z: p.pos.z }));
    b.glow(part(new THREE.TorusGeometry(p.kind === 'condor' ? 8.5 : p.kind === 'midge' ? 6 : 4.6, 0.08, 4, 32), pal.glow, { x: p.pos.x, y: py + 0.1, z: p.pos.z, rx: Math.PI / 2 }));
  }
  for (const [x, zz] of [[-30, -30], [30, -30], [-30, 30], [30, 30]]) b.prop(lampPost(), f.matrix(x, 0, zz, 0), 'metal');
  for (let i = 0; i < 6; i++) b.prop(techCrate(), f.matrix(-20 + i * 2.2, 0, 10, 0), 'metal');
  // Faction banners.
  for (const x of [-8, 8]) {
    f.solid(b, x, 5, -R - 2, 0.25, 5, 0.25, 0x2e3038, 'metal');
    f.deco(b, box(2.6, 4, 0.08, pal.secondary, { x: x + 1.45, y: 7.6, z: -R - 2 }));
    f.glow(b, box(0.6, 0.6, 0.1, pal.glow, { x: x + 1.45, y: 8.4, z: -R - 2.06 }));
  }
}

// ---------------------------------------------------------------------------------------------------
/** Road ribbons following the terrain, with center dashes. */
export function buildRoads(b: WorldBuilder, meshHeight: (x: number, z: number) => number = g): void {
  // Ribbons follow the rendered terrain mesh: dense samples, three points across, each lifted to
  // the highest nearby mesh point so no terrain facet pokes through.
  const lift = (x: number, z: number) => {
    let m = meshHeight(x, z);
    for (const [ox, oz] of [[1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2]]) m = Math.max(m, meshHeight(x + ox, z + oz));
    return m + 0.1;
  };
  const W = ROAD_HALF_WIDTH;
  const asphalt = new THREE.Color(0x6a6470);
  const kerb = new THREE.Color(0x9a8e84);
  for (const r of ROADS) {
    for (let i = 0; i < r.length - 1; i++) {
      const [ax, az] = r[i];
      const [bx, bz] = r[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.ceil(len / 2.5));
      const dx = (bx - ax) / len, dz = (bz - az) / len;
      const nx = -dz, nz = dx;
      // Rows of 4 points across: kerb, lane, lane, kerb (kerbs are a slim lighter band).
      const across = [-W - 0.5, -W + 0.4, W - 0.4, W + 0.5];
      const rows: number[][] = [];
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        const cx = ax + (bx - ax) * t, cz = az + (bz - az) * t;
        const row: number[] = [];
        for (const o of across) {
          const x = cx + nx * o, z = cz + nz * o;
          row.push(x, lift(x, z), z);
        }
        rows.push(row);
        if (k < n && k % 3 === 0) b.deco(box(0.25, 0.04, 2.6, 0xe0c060, { x: cx + dx * 1.25, y: lift(cx + dx * 1.25, cz + dz * 1.25) + 0.03, z: cz + dz * 1.25, ry: Math.atan2(dx, dz) }));
      }
      const pos: number[] = [];
      const col: number[] = [];
      const pushV = (row: number[], j: number, c: THREE.Color) => {
        pos.push(row[j * 3], row[j * 3 + 1], row[j * 3 + 2]);
        col.push(c.r, c.g, c.b);
      };
      for (let k = 0; k < n; k++) {
        const r0 = rows[k], r1 = rows[k + 1];
        for (let j = 0; j < 3; j++) {
          const c = j === 1 ? asphalt : kerb;
          // Counter-clockwise from above (normals up).
          pushV(r0, j, c); pushV(r0, j + 1, c); pushV(r1, j + 1, c);
          pushV(r0, j, c); pushV(r1, j + 1, c); pushV(r1, j, c);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      geo.computeVertexNormals();
      b.deco(geo);
    }
  }
  // Lamp posts along the roads.
  let k = 0;
  for (const r of ROADS)
    for (let i = 0; i < r.length - 1; i++) {
      const [ax, az] = r[i];
      const [bx, bz] = r[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      for (let t = 30; t < len; t += 60) {
        const x = ax + ((bx - ax) * t) / len, z = az + ((bz - az) * t) / len;
        const side = k++ % 2 ? 1 : -1;
        const nx = (-(bz - az) / len) * (ROAD_HALF_WIDTH + 1.5) * side, nz = ((bx - ax) / len) * (ROAD_HALF_WIDTH + 1.5) * side;
        b.prop(lampPost(), xf({ x: x + nx, y: g(x + nx, z + nz), z: z + nz, ry: Math.atan2(-nx, -nz) + Math.PI / 2 }), 'metal');
      }
    }
}

/** Scattered rocks, crates and cover across the open ground. */
export function buildScatter(b: WorldBuilder): void {
  const rng = new Rng(3131);
  for (let i = 0; i < 420; i++) {
    const x = rng.range(-560, 450), z = rng.range(-560, 560);
    if (ZONE_DEFS.some((zd) => Math.hypot(x - zd.center.x, z - zd.center.z) < zd.padRadius * 0.8)) continue;
    if (HQS.some((h) => Math.hypot(x - h.center.x, z - h.center.z) < HQ_RADIUS)) continue;
    const y = g(x, z);
    const kind = rng.next();
    if (kind < 0.55) {
      const s = rng.range(0.8, 2.6);
      b.deco(dodeca(s, rng.chance(0.5) ? 0x8a7464 : 0x7a6658, { x, y: y + s * 0.3, z, rx: rng.range(0, 3), ry: rng.range(0, 3) }));
      if (s > 1.2) {
        b.collider(V(x, y + s * 0.35, z), V(s * 0.7, s * 0.55, s * 0.7), 0, 'dirt');
        b.cover(V(x + s + 0.6, y, z), V(1, 0, 0), s > 1.8);
      }
    } else if (kind < 0.7) {
      b.prop(crate(rng.range(0.9, 1.3)), xf({ x, y, z, ry: rng.range(0, 3) }), 'wood');
    } else if (kind < 0.82) {
      b.prop(barrier(), xf({ x, y, z, ry: rng.range(0, 3) }), 'concrete');
      b.cover(V(x + 0.9, y, z), V(1, 0, 0), false);
    } else if (kind < 0.9) {
      b.prop(sandbags(), xf({ x, y, z, ry: rng.range(0, 3) }), 'dirt');
    } else if (kind < 0.95) {
      b.destructible({ kind: 'crate', geo: crate(1.1), matrix: xf({ x, y, z, ry: rng.range(0, 3) }), hp: 50, surface: 'wood', explosive: false, debris: true });
    } else {
      b.prop(container(CONTAINER_COLORS[rng.int(6)], rng.chance(0.5)), xf({ x, y, z, ry: rng.range(0, 3) }), 'metal');
    }
  }
}

/** Low cover ring around a capture point (barriers and destructible wall panels). */
function zoneCover(b: WorldBuilder, cx: number, cz: number, seed: number): void {
  const rng = new Rng(seed);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + rng.range(-0.2, 0.2);
    const r = rng.range(10, 18);
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    const y = g(x, z);
    const tangent = a + Math.PI / 2;
    if (i % 3 === 0) wallPanelRun(b, V(x - Math.cos(tangent) * 4, 0, z - Math.sin(tangent) * 4), V(x + Math.cos(tangent) * 4, 0, z + Math.sin(tangent) * 4), g);
    else {
      b.prop(barrier(), xf({ x, y, z, ry: -tangent + Math.PI / 2 }), 'concrete');
      b.cover(V(x + Math.cos(a) * 0.9, y, z + Math.sin(a) * 0.9), V(Math.cos(a), 0, Math.sin(a)), false);
      b.cover(V(x - Math.cos(a) * 0.9, y, z - Math.sin(a) * 0.9), V(-Math.cos(a), 0, -Math.sin(a)), false);
    }
  }
  for (let i = 0; i < 4; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(4, 9);
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    b.destructible({ kind: 'crate', geo: crate(1.1), matrix: xf({ x, y: g(x, z), z, ry: rng.range(0, 3) }), hp: 50, surface: 'wood', explosive: false, debris: true });
  }
}
