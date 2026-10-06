// Reusable structure builders for the battlefield: multi-floor buildings with doors, shoot-through
// window bands, stairwells and roof access; bunkers; lattice towers; gantry cranes; a cargo ship;
// berms; fence and wall runs. Everything is primitive boxes in the shared style.
import * as THREE from 'three';
import { box, cyl, cone, prism } from '../render/toon';
import { container, containerDoor, fencePanel, wallPanel, sandbags, CONTAINER_COLORS, xf } from '../art/props';
import type { WorldBuilder } from './builder';
import type { Surface } from './surface';

/** Local-to-world helper for a frame at (cx, cy, cz) rotated by `rot` about Y. */
export class Frame {
  private c: number;
  private s: number;
  constructor(
    readonly cx: number,
    readonly cy: number,
    readonly cz: number,
    readonly rot = 0,
  ) {
    this.c = Math.cos(rot);
    this.s = Math.sin(rot);
  }
  p(x: number, y: number, z: number): THREE.Vector3 {
    return new THREE.Vector3(this.cx + x * this.c + z * this.s, this.cy + y, this.cz - x * this.s + z * this.c);
  }
  /** Solid box in local coordinates (center, half extents). */
  solid(b: WorldBuilder, x: number, y: number, z: number, hx: number, hy: number, hz: number, color: number, surface: Surface, opts: { thin?: boolean; nav?: boolean; visible?: boolean } = {}): void {
    b.solid(this.p(x, y, z), new THREE.Vector3(hx, hy, hz), this.rot, color, surface, opts);
  }
  deco(b: WorldBuilder, g: THREE.BufferGeometry): void {
    g.applyMatrix4(new THREE.Matrix4().makeRotationY(this.rot).setPosition(this.cx, this.cy, this.cz));
    b.deco(g);
  }
  glow(b: WorldBuilder, g: THREE.BufferGeometry, lamp = false): void {
    g.applyMatrix4(new THREE.Matrix4().makeRotationY(this.rot).setPosition(this.cx, this.cy, this.cz));
    b.glow(g, lamp);
  }
  matrix(x: number, y: number, z: number, ry = 0): THREE.Matrix4 {
    const p = this.p(x, y, z);
    return xf({ x: p.x, y: p.y, z: p.z, ry: this.rot + ry });
  }
}

export interface BuildingOpts {
  w: number;
  d: number;
  floors: number;
  floorH?: number;
  wall: number;
  trim: number;
  glow: number;
  /** Door x-offsets on the front (+z) and back (-z) walls of the ground floor. */
  doorsFront?: number[];
  doorsBack?: number[];
  doorsSide?: number[];
  windows?: boolean;
  /** Roof parapet height. */
  parapet?: number;
  stairs?: boolean;
  surface?: Surface;
}

const DOOR_W = 2.4;
const DOOR_H = 2.8;
const WALL_T = 0.35;

/** Splits a wall span [-L/2, L/2] around openings of width `ow` centered at `xs`. */
function spans(L: number, xs: number[], ow: number): [number, number][] {
  const out: [number, number][] = [];
  let start = -L / 2;
  for (const x of [...xs].sort((a, c) => a - c)) {
    const a = x - ow / 2, c = x + ow / 2;
    if (a > start + 0.05) out.push([start, a]);
    start = Math.max(start, c);
  }
  if (L / 2 > start + 0.05) out.push([start, L / 2]);
  return out;
}

/** Multi-floor building. Front faces +z in the frame. Returns the roof height (local). */
export function building(b: WorldBuilder, f: Frame, o: BuildingOpts): number {
  const fh = o.floorH ?? 4;
  const surf = o.surface ?? 'concrete';
  const W = o.w, D = o.d;
  const H = o.floors * fh;
  // Wall builder for one side (axis 'x' runs along local x at z = zpos; 'z' runs along z at x = xpos).
  const wallRun = (axis: 'x' | 'z', pos: number, L: number, floor: number, doors: number[]) => {
    const y0 = floor * fh;
    const seg = (a: number, c: number, ya: number, yb: number) => {
      const mid = (a + c) / 2, len = c - a, hh = (yb - ya) / 2;
      if (len <= 0.05 || hh <= 0.02) return;
      if (axis === 'x') f.solid(b, mid, ya + hh, pos, len / 2, hh, WALL_T / 2, o.wall, surf);
      else f.solid(b, pos, ya + hh, mid, WALL_T / 2, hh, len / 2, o.wall, surf);
    };
    if (floor === 0 && doors.length) {
      for (const [a, c] of spans(L, doors, DOOR_W)) seg(a, c, y0, y0 + fh);
      for (const x of doors) seg(x - DOOR_W / 2, x + DOOR_W / 2, y0 + DOOR_H, y0 + fh);
    } else if (o.windows !== false && floor > 0) {
      // Below and above the window band, with pillars between openings.
      seg(-L / 2, L / 2, y0, y0 + 1.1);
      seg(-L / 2, L / 2, y0 + 2.3, y0 + fh);
      const n = Math.max(1, Math.floor(L / 4));
      const step = L / n;
      for (let i = 0; i <= n; i++) {
        const x = -L / 2 + i * step;
        seg(Math.max(-L / 2, x - 0.4), Math.min(L / 2, x + 0.4), y0 + 1.1, y0 + 2.3);
      }
    } else seg(-L / 2, L / 2, y0, y0 + fh);
  };
  for (let fl = 0; fl < o.floors; fl++) {
    wallRun('x', D / 2, W, fl, o.doorsFront ?? []);
    wallRun('x', -D / 2, W, fl, o.doorsBack ?? []);
    wallRun('z', W / 2, D - WALL_T * 2, fl, o.doorsSide ?? []);
    wallRun('z', -W / 2, D - WALL_T * 2, fl, fl === 0 ? (o.doorsSide ?? []) : []);
    // Trim band and window glow.
    f.deco(b, box(W + 0.12, 0.18, D + 0.12, o.trim, { y: fl * fh + fh - 0.09 }));
    if (fl > 0 && o.windows !== false) {
      f.glow(b, box(W - 0.6, 0.05, 0.05, o.glow, { y: fl * fh + 2.32, z: D / 2 + 0.2 }));
      f.glow(b, box(W - 0.6, 0.05, 0.05, o.glow, { y: fl * fh + 2.32, z: -D / 2 - 0.2 }));
    }
  }
  // Floors with a stairwell opening along the -x wall (4 m wide, 9 m long).
  const stairs = o.stairs !== false && o.floors > 0;
  const sw = 3.4, sl = 9.5;
  const sx = -W / 2 + WALL_T + sw / 2;
  for (let fl = 1; fl <= o.floors; fl++) {
    const y = fl * fh;
    const top = fl === o.floors;
    if (stairs) {
      // Slab around the opening: the strip beside the stairwell, and the parts before / after it.
      const restW = W - WALL_T * 2 - sw;
      f.solid(b, sx + sw / 2 + restW / 2, y - 0.15, 0, restW / 2, 0.15, D / 2 - WALL_T, top ? o.trim : 0xa8957e, surf);
      const restL = D - WALL_T * 2 - sl;
      if (restL > 0.2) f.solid(b, sx, y - 0.15, -D / 2 + WALL_T + restL / 2, sw / 2, 0.15, restL / 2, top ? o.trim : 0xa8957e, surf);
    } else f.solid(b, 0, y - 0.15, 0, W / 2, 0.15, D / 2, top ? o.trim : 0xa8957e, surf);
  }
  if (stairs) {
    // Switchback ramps in two side-by-side lanes: same-lane ramps are two floors apart, so there
    // is full headroom everywhere and the ends meet at landings.
    const laneW = sw / 2 - 0.05;
    for (let fl = 0; fl < o.floors; fl++) {
      const y0 = fl * fh, y1 = y0 + fh;
      const zA = D / 2 - WALL_T, zB = zA - sl;
      const up = fl % 2 === 0;
      const za = up ? zA : zB, zb = up ? zB : zA;
      const lx = sx + (up ? -1 : 1) * (sw / 4);
      const len = Math.hypot(sl, fh);
      const ang = Math.atan2(fh, sl) * (up ? 1 : -1);
      const midLocal = [lx, (y0 + y1) / 2, (za + zb) / 2] as const;
      f.deco(b, box(laneW, 0.25, len, 0x8a7464, { x: midLocal[0], y: midLocal[1], z: midLocal[2], rx: ang }));
      b.colliderOriented(f.p(midLocal[0], midLocal[1], midLocal[2]), new THREE.Vector3(laneW / 2, 0.125, len / 2), new THREE.Euler(ang, f.rot, 0, 'YXZ'), surf);
      // Handrail on the open side.
      f.deco(b, box(0.06, 0.06, len, 0x5a5f6e, { x: lx + (up ? 1 : -1) * (laneW / 2), y: midLocal[1] + 0.9, z: midLocal[2], rx: ang }));
    }
  }
  // Roof parapet and a rooftop unit.
  const par = o.parapet ?? 1.0;
  if (par > 0) {
    f.solid(b, 0, H + par / 2, D / 2 - 0.15, W / 2, par / 2, 0.15, o.trim, surf);
    f.solid(b, 0, H + par / 2, -D / 2 + 0.15, W / 2, par / 2, 0.15, o.trim, surf);
    f.solid(b, W / 2 - 0.15, H + par / 2, 0, 0.15, par / 2, D / 2 - 0.3, o.trim, surf);
    f.solid(b, -W / 2 + 0.15, H + par / 2, 0, 0.15, par / 2, D / 2 - 0.3, o.trim, surf);
  }
  f.solid(b, W * 0.2, H + 0.9, -D * 0.15, 1.6, 0.9, 1.2, 0x8a90a0, 'metal');
  f.glow(b, box(0.4, 0.4, 0.4, 0xff4458, { x: W / 2 - 0.5, y: H + par + 0.3, z: D / 2 - 0.5 }), true);
  // Cover inside doorways and on the roof edge.
  b.cover(f.p(0, 0, D / 2 + 0.8), f.p(0, 0, 1).sub(f.p(0, 0, 0)), true);
  return H;
}

/** Low concrete bunker with firing slits and a door; the roof is walkable. */
export function bunker(b: WorldBuilder, f: Frame, w = 8, d = 6, color = 0xa8957e): void {
  const h = 2.6;
  const t = 0.6;
  // Front wall with a slit.
  f.solid(b, 0, 0.55, d / 2 - t / 2, w / 2, 0.55, t / 2, color, 'concrete');
  f.solid(b, 0, h - 0.5, d / 2 - t / 2, w / 2, 0.5, t / 2, color, 'concrete');
  f.solid(b, -w / 2 + 0.4, 1.6, d / 2 - t / 2, 0.4, 0.5, t / 2, color, 'concrete');
  f.solid(b, w / 2 - 0.4, 1.6, d / 2 - t / 2, 0.4, 0.5, t / 2, color, 'concrete');
  // Back wall with a door.
  for (const [a, c] of spans(w, [0], DOOR_W)) f.solid(b, (a + c) / 2, h / 2, -d / 2 + t / 2, (c - a) / 2, h / 2, t / 2, color, 'concrete');
  f.solid(b, 0, h - 0.15, -d / 2 + t / 2, DOOR_W / 2, 0.15, t / 2, color, 'concrete');
  f.solid(b, w / 2 - t / 2, h / 2, 0, t / 2, h / 2, d / 2 - t, color, 'concrete');
  f.solid(b, -w / 2 + t / 2, h / 2, 0, t / 2, h / 2, d / 2 - t, color, 'concrete');
  f.solid(b, 0, h + 0.2, 0, w / 2 + 0.3, 0.2, d / 2 + 0.3, 0x8a7464, 'concrete');
  f.glow(b, box(0.8, 0.08, 0.08, 0xffcf6a, { y: h - 0.4, z: -d / 2 - 0.05 }), true);
  b.cover(f.p(0, 0, d / 2 + 0.9), f.p(0, 0, 1).sub(f.p(0, 0, 0)), true);
  b.cover(f.p(w / 2 + 0.9, 0, 0), f.p(1, 0, 0).sub(f.p(0, 0, 0)), true);
  b.cover(f.p(-w / 2 - 0.9, 0, 0), f.p(-1, 0, 0).sub(f.p(0, 0, 0)), true);
}

/** Lattice tower with platforms every `step` meters and a ladder. Returns the top height. */
export function latticeTower(b: WorldBuilder, f: Frame, h: number, w: number, color: number, opts: { step?: number; ladder?: boolean; platformTop?: boolean } = {}): number {
  const step = opts.step ?? 10;
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) f.solid(b, (x * w) / 2, h / 2, (z * w) / 2, 0.3, h / 2, 0.3, color, 'metal');
  for (let y = 3; y < h; y += 3) {
    const rz = (y / 3) % 2 ? 0.6 : -0.6;
    f.deco(b, box(w, 0.12, 0.12, color, { y, z: w / 2, rz }));
    f.deco(b, box(w, 0.12, 0.12, color, { y, z: -w / 2, rz: -rz }));
    f.deco(b, box(0.12, 0.12, w, color, { y, x: w / 2, rx: rz }));
    f.deco(b, box(0.12, 0.12, w, color, { y, x: -w / 2, rx: -rz }));
  }
  for (let y = step; y <= h; y += step) {
    f.solid(b, 0, y, 0, w / 2 + 0.6, 0.12, w / 2 + 0.6, 0x8a90a0, 'sheet', { thin: true });
    f.solid(b, 0, y + 0.6, w / 2 + 0.6, w / 2 + 0.6, 0.5, 0.04, 0xe0a020, 'sheet', { thin: true });
    f.solid(b, 0, y + 0.6, -w / 2 - 0.6, w / 2 + 0.6, 0.5, 0.04, 0xe0a020, 'sheet', { thin: true });
  }
  if (opts.ladder !== false) {
    const top = Math.floor(h / step) * step;
    b.ladder(f.p(w / 2 + 0.35, 0, 0), top + 0.12, f.rot - Math.PI / 2);
  }
  f.glow(b, box(0.4, 0.4, 0.4, 0xff4458, { y: h + 0.4 }), true);
  return Math.floor(h / step) * step;
}

/** Gantry crane straddling a lane: legs, top beam at `h`, cabin, ladder to the beam. */
export function gantryCrane(b: WorldBuilder, f: Frame, span: number, h: number, color: number): number {
  const legX = span / 2;
  for (const z of [-4, 4]) {
    for (const x of [-legX, legX]) f.solid(b, x, h / 2, z, 0.6, h / 2, 0.6, color, 'metal');
    f.deco(b, box(span + 1.2, 0.8, 0.8, color, { y: 2.5, z }));
  }
  f.solid(b, 0, h, 0, legX + 6, 1.0, 5, color, 'metal');
  f.solid(b, 0, h + 1.5, -4.6, legX + 6, 0.5, 0.1, 0xe0a020, 'sheet', { thin: true });
  f.solid(b, 0, h + 1.5, 4.6, legX + 6, 0.5, 0.1, 0xe0a020, 'sheet', { thin: true });
  f.deco(b, box(4, 3, 4, 0x5a5f6e, { x: legX - 6, y: h - 2.6 }));
  f.glow(b, box(3.6, 1.0, 0.05, 0x7cf0ff, { x: legX - 6, y: h - 2.3, z: 2.03 }));
  f.deco(b, box(0.2, h - 3, 0.2, 0x2e3038, { x: 0, y: (h - 3) / 2 + 3, z: 0 }));
  f.deco(b, box(2.4, 1.2, 3.0, 0x2e3038, { y: 3.2 }));
  b.ladder(f.p(legX + 0.95, 0, 4), h + 0.9, f.rot - Math.PI / 2);
  for (const x of [-legX - 5, legX + 5]) f.glow(b, box(0.4, 0.4, 0.4, 0xff4458, { x, y: h + 1.3 }), true);
  return h + 1;
}

/** Docked cargo ship along the quay: hull, walkable deck, bridge tower, deck containers, gangway. */
export function cargoShip(b: WorldBuilder, f: Frame, waterY: number): { deckY: number } {
  const L = 150, W = 24;
  const deck = waterY + 11;
  const hull = 0x3a4a6a, hullTop = 0x8a2a2a;
  // Hull body (solid down to the seabed).
  f.solid(b, 0, (deck + waterY - 3) / 2, 0, W / 2, (deck - (waterY - 3)) / 2, L / 2 - 8, hull, 'metal');
  // Bow and stern tapers (decorative prisms plus colliders).
  f.deco(b, prism([[-W / 2, 0], [W / 2, 0], [0, 18]], deck - waterY + 3, hull, { y: (deck + waterY - 3) / 2, z: -L / 2 + 8, rx: Math.PI / 2, ry: Math.PI }));
  b.collider(f.p(0, (deck + waterY - 3) / 2, -L / 2 + 2), new THREE.Vector3(W / 4, (deck - waterY + 3) / 2, 6), f.rot, 'metal');
  f.deco(b, box(W, deck - waterY + 3, 8, hull, { y: (deck + waterY - 3) / 2, z: L / 2 - 4 }));
  b.collider(f.p(0, (deck + waterY - 3) / 2, L / 2 - 4), new THREE.Vector3(W / 2, (deck - waterY + 3) / 2, 4), f.rot, 'metal');
  f.deco(b, box(W + 0.2, 1.2, L - 14, hullTop, { y: waterY + 0.4 }));
  // Deck and railings.
  f.solid(b, 0, deck + 0.15, 0, W / 2, 0.15, L / 2 - 4, 0x6a6a70, 'metal');
  f.solid(b, W / 2 - 0.1, deck + 0.8, 0, 0.1, 0.5, L / 2 - 6, 0xe0a020, 'sheet', { thin: true });
  f.solid(b, -W / 2 + 0.1, deck + 0.8, 0, 0.1, 0.5, L / 2 - 6, 0xe0a020, 'sheet', { thin: true });
  // Bridge tower at the stern (+z).
  const bf = new Frame(f.p(0, 0, L / 2 - 16).x, deck + 0.3, f.p(0, 0, L / 2 - 16).z, f.rot);
  building(b, bf, { w: 18, d: 12, floors: 3, wall: 0xd8d2c4, trim: 0x5a5f6e, glow: 0x7cf0ff, doorsFront: [-4], doorsBack: [4], parapet: 1.1 });
  // Deck container stacks with gaps (cover lanes).
  for (let row = 0; row < 5; row++) {
    const z = -L / 2 + 22 + row * 18;
    for (let col = 0; col < 3; col++) {
      if ((row + col) % 3 === 2) continue;
      const x = -7 + col * 7;
      const stack = 1 + ((row * 3 + col) % 2);
      for (let s = 0; s < stack; s++) b.prop(container(CONTAINER_COLORS[(row + col + s) % 6]), f.matrix(x, deck + 0.3 + s * 2.6, z, 0), 'metal');
    }
  }
  // Cranes on deck.
  for (const z of [-20, 25]) {
    f.solid(b, W / 2 - 3, deck + 6, z, 0.6, 6, 0.6, 0xe0a020, 'metal');
    f.deco(b, box(1, 1, 18, 0xe0a020, { x: W / 2 - 3, y: deck + 12, z: z - 6, rx: -0.3 }));
  }
  return { deckY: deck };
}

/** Line of sandbag segments between two points (trench walls, berms). */
export function sandbagLine(b: WorldBuilder, a: THREE.Vector3, c: THREE.Vector3, groundAt: (x: number, z: number) => number): void {
  const d = new THREE.Vector3().subVectors(c, a);
  const len = d.length();
  const n = Math.max(1, Math.floor(len / 2.6));
  const yaw = Math.atan2(d.x, d.z) + Math.PI / 2;
  for (let i = 0; i < n; i++) {
    const p = a.clone().addScaledVector(d, (i + 0.5) / n);
    b.prop(sandbags(2.4), xf({ x: p.x, y: groundAt(p.x, p.z), z: p.z, ry: yaw }), 'dirt');
    if (i % 2 === 0) b.cover(p, new THREE.Vector3(-d.z, 0, d.x).normalize(), false);
  }
}

/** Destructible fence run between two points. */
export function fenceRun(b: WorldBuilder, a: THREE.Vector3, c: THREE.Vector3, groundAt: (x: number, z: number) => number, tag?: string): void {
  const d = new THREE.Vector3().subVectors(c, a);
  const len = d.length();
  const n = Math.max(1, Math.round(len / 4));
  const yaw = Math.atan2(d.x, d.z) + Math.PI / 2;
  for (let i = 0; i < n; i++) {
    const p = a.clone().addScaledVector(d, (i + 0.5) / n);
    b.destructible({ kind: 'fence4', geo: fencePanel(4), matrix: xf({ x: p.x, y: groundAt(p.x, p.z), z: p.z, ry: yaw }), hp: 60, surface: 'sheet', explosive: false, debris: true, tag });
  }
}

/** Destructible wall panels (cover) along a line. */
export function wallPanelRun(b: WorldBuilder, a: THREE.Vector3, c: THREE.Vector3, groundAt: (x: number, z: number) => number, color = 0xcdbba2): void {
  const d = new THREE.Vector3().subVectors(c, a);
  const len = d.length();
  const n = Math.max(1, Math.round(len / 4));
  const yaw = Math.atan2(d.x, d.z) + Math.PI / 2;
  for (let i = 0; i < n; i++) {
    const p = a.clone().addScaledVector(d, (i + 0.5) / n);
    b.destructible({ kind: `wall-${color.toString(16)}`, geo: wallPanel(4, 2.4, color), matrix: xf({ x: p.x, y: groundAt(p.x, p.z), z: p.z, ry: yaw }), hp: 260, surface: 'concrete', explosive: false, debris: true });
    b.cover(p, new THREE.Vector3(-d.z, 0, d.x).normalize(), true);
    b.cover(p, new THREE.Vector3(d.z, 0, -d.x).normalize(), true);
  }
}

/** Container with a destructible door. */
export function containerWithDoor(b: WorldBuilder, m: THREE.Matrix4, color: number): void {
  b.prop(container(color, false, true), m, 'metal');
  const door = m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, 6.04));
  b.destructible({ kind: `cdoor-${color.toString(16)}`, geo: containerDoor(color), matrix: door, hp: 180, surface: 'sheet', explosive: false, debris: true });
}

/** Rocket on the launch pad (visual parts are returned separately so the launch event can move them). */
export function rocketParts(height: number, radius: number): { toon: THREE.BufferGeometry[]; glow: THREE.BufferGeometry[] } {
  const toon: THREE.BufferGeometry[] = [];
  const glow: THREE.BufferGeometry[] = [];
  const stages = [0.42, 0.33, 0.25];
  let y = 0;
  const colors = [0xe8e2d4, 0xd8d2c4, 0xe8e2d4];
  stages.forEach((frac, i) => {
    const h = height * frac * 0.86;
    const r = radius * (1 - i * 0.14);
    toon.push(cyl(r, r, h, 16, colors[i], { y: y + h / 2 }));
    toon.push(cyl(r * 1.02, r * 1.02, 1.0, 16, i === 0 ? 0xc04a3a : 0x2e3038, { y: y + h - 0.6 }));
    glow.push(cyl(r * 1.03, r * 1.03, 0.25, 16, 0x7cf0ff, { y: y + h * 0.5 }));
    y += h;
  });
  toon.push(cone(radius * 0.72, height * 0.14, 16, 0xe8e2d4, { y: y + height * 0.07 }));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    toon.push(prism([[0, 0], [radius * 1.2, 0], [0, radius * 2.4]], 0.3, 0x2e3038, { x: Math.cos(a) * radius, y: 0.2, z: Math.sin(a) * radius, ry: -a }));
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    toon.push(cyl(radius * 0.3, radius * 0.38, 2.4, 10, 0x2e3038, { x: Math.cos(a) * radius * 0.5, y: -0.6, z: Math.sin(a) * radius * 0.5 }));
  }
  return { toon, glow };
}
