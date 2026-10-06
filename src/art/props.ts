// Code-built props shared by the map and the style scene. Each returns toon parts and glow parts
// in local space (origin at the base center), plus the collision half-extents.
import * as THREE from 'three';
import { box, cyl, cone, type Xform } from '../render/toon';

export interface PropGeo {
  toon: THREE.BufferGeometry[];
  glow: THREE.BufferGeometry[];
  half: THREE.Vector3;
  center: THREE.Vector3;
  /** Debris colors when destroyed. */
  colors: number[];
}

const P = {
  concrete: 0xcdbba2,
  concreteD: 0xa8957e,
  gunmetal: 0x5a5f6e,
  steel: 0x8a90a0,
  dark: 0x2e3038,
  hazard: 0xe0a020,
  warn: 0xc04a3a,
  lampWarm: 0xffcf6a,
  tech: 0x7cf0ff,
  wood: 0xa8733f,
  woodD: 0x6b4423,
  panel: 0x2a4058,
  glass: 0x6ab0c8,
};
export const PROP_COLORS = P;
export const CONTAINER_COLORS = [0xc0503a, 0x2f8fb0, 0xe0a020, 0x3a9a5a, 0x8a6ab0, 0xb8b0a0];

function pg(toon: THREE.BufferGeometry[], glow: THREE.BufferGeometry[], half: THREE.Vector3, center: THREE.Vector3, colors: number[]): PropGeo {
  return { toon, glow, half, center, colors };
}

/** 12 m shipping container (6 m with `short`). Door end at +Z. */
export function container(color: number, short = false, doorOpen = false): PropGeo {
  const L = short ? 6.0 : 12.0;
  const W = 2.44, H = 2.6;
  const t: THREE.BufferGeometry[] = [];
  const shadeC = new THREE.Color(color).multiplyScalar(0.78).getHex();
  t.push(box(W, H, L, color, { y: H / 2 }));
  // Corrugation ribs.
  const ribs = Math.floor(L / 0.6);
  for (let i = 0; i < ribs; i++) {
    const z = -L / 2 + 0.3 + i * 0.6;
    t.push(box(W + 0.06, H - 0.3, 0.12, shadeC, { y: H / 2, z }));
  }
  // Frame corners.
  for (const x of [-W / 2, W / 2]) for (const z of [-L / 2, L / 2]) t.push(box(0.16, H + 0.04, 0.16, P.dark, { x, y: H / 2, z }));
  t.push(box(W + 0.1, 0.14, L + 0.1, P.dark, { y: H - 0.05 }));
  t.push(box(W + 0.1, 0.14, L + 0.1, P.dark, { y: 0.07 }));
  if (!doorOpen) {
    t.push(box(W - 0.2, H - 0.3, 0.06, shadeC, { y: H / 2, z: L / 2 + 0.04 }));
    t.push(box(0.05, H - 0.4, 0.04, P.steel, { x: -0.3, y: H / 2, z: L / 2 + 0.09 }));
    t.push(box(0.05, H - 0.4, 0.04, P.steel, { x: 0.3, y: H / 2, z: L / 2 + 0.09 }));
  }
  return pg(t, [], new THREE.Vector3(W / 2, H / 2, L / 2), new THREE.Vector3(0, H / 2, 0), [color, shadeC, P.dark]);
}

/** Container door panel (destructible on its own). Local origin at the door base center. */
export function containerDoor(color: number): PropGeo {
  const shadeC = new THREE.Color(color).multiplyScalar(0.78).getHex();
  const t = [box(2.24, 2.3, 0.08, shadeC, { y: 1.3 }), box(0.05, 2.2, 0.05, P.steel, { x: -0.3, y: 1.3, z: 0.06 }), box(0.05, 2.2, 0.05, P.steel, { x: 0.3, y: 1.3, z: 0.06 })];
  return pg(t, [], new THREE.Vector3(1.12, 1.15, 0.06), new THREE.Vector3(0, 1.3, 0), [shadeC, P.steel]);
}

/** Pressurized fuel tank (chain-reacts when destroyed). */
export function fuelTank(): PropGeo {
  const t: THREE.BufferGeometry[] = [];
  const g: THREE.BufferGeometry[] = [];
  t.push(cyl(1.6, 1.6, 4.2, 14, 0xd8d2c4, { y: 2.5 }));
  t.push(cyl(1.0, 1.6, 0.6, 14, 0xd8d2c4, { y: 4.9 }));
  t.push(cyl(1.65, 1.65, 0.25, 14, P.warn, { y: 3.4 }));
  t.push(cyl(1.65, 1.65, 0.25, 14, P.warn, { y: 1.6 }));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    t.push(box(0.25, 0.8, 0.25, P.gunmetal, { x: Math.cos(a) * 1.3, y: 0.4, z: Math.sin(a) * 1.3 }));
  }
  t.push(cyl(0.12, 0.12, 2.5, 6, P.gunmetal, { x: 1.7, y: 1.4, z: 0 }));
  g.push(box(0.2, 0.2, 0.2, P.warn, { y: 5.25 }));
  g.push(box(0.04, 0.6, 0.4, P.lampWarm, { x: 1.62, y: 2.5 }));
  return pg(t, g, new THREE.Vector3(1.6, 2.6, 1.6), new THREE.Vector3(0, 2.6, 0), [0xd8d2c4, P.warn, P.gunmetal]);
}

/** Solar panel on a pivot post, tilted toward the sun. */
export function solarPanel(): PropGeo {
  const t: THREE.BufferGeometry[] = [];
  const g: THREE.BufferGeometry[] = [];
  t.push(box(0.2, 1.2, 0.2, P.gunmetal, { y: 0.6 }));
  t.push(box(3.2, 0.08, 2.0, P.dark, { y: 1.35, rx: -0.45 }));
  for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) t.push(box(0.72, 0.04, 0.88, P.panel, { x: -1.17 + i * 0.78, y: 1.4 + (j - 0.5) * -0.4, z: (j - 0.5) * 0.85, rx: -0.45 }));
  g.push(box(3.0, 0.02, 0.03, P.tech, { y: 1.4, z: 0.0, rx: -0.45 }));
  return pg(t, g, new THREE.Vector3(1.6, 0.8, 1.0), new THREE.Vector3(0, 1.0, 0), [P.panel, P.dark, P.gunmetal]);
}

export function crate(size = 1.1): PropGeo {
  const s = size;
  const t = [box(s, s, s, P.wood, { y: s / 2 }), box(s + 0.04, 0.1, s + 0.04, P.woodD, { y: s * 0.15 }), box(s + 0.04, 0.1, s + 0.04, P.woodD, { y: s * 0.85 })];
  t.push(box(0.1, s, s + 0.04, P.woodD, { x: s * 0.36, y: s / 2 }));
  t.push(box(0.1, s, s + 0.04, P.woodD, { x: -s * 0.36, y: s / 2 }));
  return pg(t, [], new THREE.Vector3(s / 2, s / 2, s / 2), new THREE.Vector3(0, s / 2, 0), [P.wood, P.woodD]);
}

/** Tech supply crate (sci-fi hard case). */
export function techCrate(): PropGeo {
  const t = [box(1.4, 0.8, 0.9, P.gunmetal, { y: 0.4 }), box(1.46, 0.12, 0.96, P.dark, { y: 0.76 }), box(1.2, 0.06, 0.06, P.hazard, { y: 0.5, z: 0.46 })];
  const g = [box(0.3, 0.05, 0.02, P.tech, { y: 0.6, z: 0.46 })];
  return pg(t, g, new THREE.Vector3(0.73, 0.42, 0.48), new THREE.Vector3(0, 0.42, 0), [P.gunmetal, P.dark, P.hazard]);
}

/** Concrete jersey barrier (low cover). */
export function barrier(len = 3): PropGeo {
  const t = [box(0.7, 0.35, len, P.concrete, { y: 0.175 }), box(0.4, 0.6, len, P.concrete, { y: 0.65 }), box(0.42, 0.08, len + 0.02, P.hazard, { y: 0.8 })];
  return pg(t, [], new THREE.Vector3(0.35, 0.5, len / 2), new THREE.Vector3(0, 0.5, 0), [P.concrete, P.concreteD]);
}

/** Lamp post with a warm glowing head. */
export function lampPost(): PropGeo {
  const t = [box(0.4, 0.3, 0.4, P.dark, { y: 0.15 }), box(0.16, 6, 0.16, P.gunmetal, { y: 3.1 }), box(1.2, 0.12, 0.2, P.gunmetal, { x: 0.5, y: 6.05 }), box(0.5, 0.25, 0.4, P.dark, { x: 1.0, y: 5.9 })];
  const g = [box(0.42, 0.06, 0.32, P.lampWarm, { x: 1.0, y: 5.76 })];
  return pg(t, g, new THREE.Vector3(0.2, 3, 0.2), new THREE.Vector3(0, 3, 0), [P.gunmetal, P.dark]);
}

/** Chain-link-style fence panel (thin, penetrable). */
export function fencePanel(len = 4): PropGeo {
  const t: THREE.BufferGeometry[] = [];
  t.push(box(0.1, 2.2, 0.1, P.gunmetal, { x: -len / 2, y: 1.1 }));
  t.push(box(0.1, 2.2, 0.1, P.gunmetal, { x: len / 2, y: 1.1 }));
  t.push(box(len, 0.06, 0.06, P.gunmetal, { y: 2.15 }));
  t.push(box(len, 0.06, 0.06, P.gunmetal, { y: 0.15 }));
  for (let i = 0; i < Math.round(len * 3); i++) t.push(box(0.025, 2.0, 0.025, P.steel, { x: -len / 2 + 0.15 + i * (len / Math.round(len * 3)), y: 1.15, rz: 0.5 }));
  return pg(t, [], new THREE.Vector3(len / 2, 1.1, 0.08), new THREE.Vector3(0, 1.1, 0), [P.gunmetal, P.steel]);
}

/** Prefab wall panel (destructible cover / building walls). */
export function wallPanel(w = 4, h = 3, color: number = P.concrete): PropGeo {
  const shadeC = new THREE.Color(color).multiplyScalar(0.85).getHex();
  const t = [box(w, h, 0.3, color, { y: h / 2 }), box(w + 0.04, 0.16, 0.34, shadeC, { y: h - 0.08 }), box(0.12, h, 0.34, shadeC, { x: -w / 2 + 0.06, y: h / 2 })];
  return pg(t, [], new THREE.Vector3(w / 2, h / 2, 0.15), new THREE.Vector3(0, h / 2, 0), [color, shadeC, P.dark]);
}

/** Antenna mast with blinking beacon. */
export function antenna(h = 18): PropGeo {
  const t: THREE.BufferGeometry[] = [];
  const g: THREE.BufferGeometry[] = [];
  t.push(box(1.4, 0.4, 1.4, P.concreteD, { y: 0.2 }));
  for (const [x, z] of [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]]) t.push(box(0.1, h, 0.1, P.gunmetal, { x: x * 0.6, y: h / 2, z: z * 0.6 }));
  for (let y = 2; y < h; y += 2) t.push(box(0.6, 0.06, 0.6, P.gunmetal, { y }));
  t.push(cone(0.9, 1.4, 8, P.steel, { y: h * 0.7, rx: Math.PI }));
  t.push(cyl(1.2, 1.2, 0.12, 12, P.steel, { y: h * 0.82, rx: 0.4 }));
  g.push(box(0.3, 0.3, 0.3, P.warn, { y: h + 0.2 }));
  return pg(t, g, new THREE.Vector3(0.6, h / 2, 0.6), new THREE.Vector3(0, h / 2, 0), [P.gunmetal, P.steel]);
}

/** Sandbag / energy-barricade low cover. */
export function sandbags(len = 2.4): PropGeo {
  const t: THREE.BufferGeometry[] = [];
  const n = Math.round(len / 0.6);
  for (let row = 0; row < 3; row++) for (let i = 0; i < n - (row % 2); i++) t.push(box(0.56, 0.26, 0.5, row % 2 ? 0xa89070 : 0xb8a080, { x: -len / 2 + 0.3 + i * 0.6 + (row % 2) * 0.3, y: 0.13 + row * 0.25 }));
  return pg(t, [], new THREE.Vector3(len / 2, 0.38, 0.25), new THREE.Vector3(0, 0.38, 0), [0xb8a080, 0xa89070]);
}

/** Applies a transform to every part of a prop (for baking into merged world geometry). */
export function transformProp(p: PropGeo, m: THREE.Matrix4): { toon: THREE.BufferGeometry[]; glow: THREE.BufferGeometry[] } {
  return { toon: p.toon.map((g) => g.applyMatrix4(m)), glow: p.glow.map((g) => g.applyMatrix4(m)) };
}

export function xf(t: Xform): THREE.Matrix4 {
  const e = new THREE.Euler(t.rx ?? 0, t.ry ?? 0, t.rz ?? 0);
  return new THREE.Matrix4().compose(new THREE.Vector3(t.x ?? 0, t.y ?? 0, t.z ?? 0), new THREE.Quaternion().setFromEuler(e), new THREE.Vector3(t.sx ?? 1, t.sy ?? 1, t.sz ?? 1));
}
