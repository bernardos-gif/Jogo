// Training ground: a compact course for every movement mechanic (vault walls, mantle ledges, a
// slide lane, ladders, an elevator jump tower, a zipline) plus firing lanes with targets at
// measured ranges (targets are added by the range mode).
import * as THREE from 'three';
import { Terrain } from '../terrain';
import { WorldBuilder } from '../builder';
import { fbm } from '../noise';
import { barrier, crate, lampPost, sandbags, techCrate, container, CONTAINER_COLORS, xf, fuelTank, solarPanel, fencePanel, wallPanel } from '../../art/props';
import { box } from '../../render/toon';
import type { Surface } from '../surface';

export interface MapBuild {
  terrain: Terrain;
  builder: WorldBuilder;
  spawn: THREE.Vector3;
  spawnYaw: number;
  /** Firing lane origin and direction (training only). */
  laneOrigin: THREE.Vector3;
  water: number | null;
}

const PAD = 0xcdbba2;
const PAD2 = 0xc2ae95;
const STEEL = 0x5a5f6e;

export function buildTraining(): MapBuild {
  const size = 640;
  const height = (x: number, z: number): number => {
    const r = Math.max(Math.abs(x), Math.abs(z));
    const flat = Math.min(1, Math.max(0, (r - 120) / 120));
    return fbm(x * 0.008, z * 0.008, 4, 11) * 14 * flat + Math.max(0, r - 230) * 0.25;
  };
  const surface = (x: number, z: number): Surface => (Math.abs(x) < 110 && Math.abs(z) < 260 ? 'concrete' : 'sand');
  const terrain = new Terrain({
    size,
    cell: 4,
    height,
    chunkCells: 40,
    surface,
    color: (x, z, y, slope, out) => {
      if (Math.abs(x) < 110 && Math.abs(z) < 260) out.setHex(((Math.floor(x / 8) + Math.floor(z / 8)) & 1) ? PAD : PAD2);
      else if (slope > 0.35) out.setHex(0x8a7464);
      else if (y > 12) out.setHex(0x9a9a5a);
      else out.setHex(0xc9a77c);
    },
  });
  const b = new WorldBuilder();
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

  // ---- Spawn platform
  b.solid(v(0, 0.15, 30), v(6, 0.15, 6), 0, 0x8a90a0, 'metal');
  b.glow(box(12.1, 0.04, 0.1, 0x7cf0ff, { y: 0.31, z: 24 }));

  // ---- Vault and mantle course (x -60..-20, z 0..-60)
  const course = (z: number, h: number, w = 6) => b.solid(v(-40, h / 2, z), v(w / 2, h / 2, 0.4), 0, h > 1.5 ? 0xa8957e : PAD2, 'concrete');
  course(-10, 0.9);
  course(-20, 1.15);
  course(-30, 1.6);
  course(-40, 2.1);
  b.solid(v(-40, 1.2, -50), v(3, 1.2, 3), 0, 0xa8957e, 'concrete');
  // Slide lane under a low bar.
  b.solid(v(-60, 1.45, -30), v(2, 0.15, 0.3), 0, 0xe0a020, 'metal');
  b.collider(v(-61.9, 0.7, -30), v(0.1, 0.7, 0.1), 0, 'metal');
  b.collider(v(-58.1, 0.7, -30), v(0.1, 0.7, 0.1), 0, 'metal');
  b.deco(box(0.2, 1.4, 0.2, STEEL, { x: -61.9, y: 0.7, z: -30 }));
  b.deco(box(0.2, 1.4, 0.2, STEEL, { x: -58.1, y: 0.7, z: -30 }));

  // ---- Ladder tower (12 m) with a zipline down to a far platform
  const tower = v(30, 0, -40);
  const th = 12;
  for (const [dx, dz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) b.solid(v(tower.x + dx, th / 2, tower.z + dz), v(0.3, th / 2, 0.3), 0, STEEL, 'metal');
  b.solid(v(tower.x, th + 0.2, tower.z), v(3.6, 0.2, 3.6), 0, 0x8a90a0, 'metal');
  for (const [dx, dz, w, d] of [[0, -3.5, 3.6, 0.05], [0, 3.5, 3.6, 0.05], [-3.5, 0, 0.05, 3.6]]) b.solid(v(tower.x + dx, th + 0.9, tower.z + dz), v(w, 0.5, d), 0, 0xe0a020, 'sheet', { thin: true });
  b.ladder(v(tower.x + 3.6, 0, tower.z), th + 0.4, -Math.PI / 2);
  b.zipline(v(tower.x - 3, th + 2.4, tower.z), v(tower.x - 70, 4.2, tower.z + 10));
  b.solid(v(tower.x - 72, 1.0, tower.z + 10), v(3, 1.0, 3), 0, 0xa8957e, 'concrete');

  // ---- Jump tower (40 m) with an elevator: parachute and wingsuit practice
  const jt = v(70, 0, 40);
  const jh = 40;
  for (const [dx, dz] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) b.solid(v(jt.x + dx, jh / 2, jt.z + dz), v(0.45, jh / 2, 0.45), 0, STEEL, 'metal');
  for (let y = 8; y < jh; y += 8) {
    b.deco(box(8.9, 0.3, 0.3, STEEL, { x: jt.x, y, z: jt.z - 4 }));
    b.deco(box(8.9, 0.3, 0.3, STEEL, { x: jt.x, y, z: jt.z + 4 }));
  }
  b.solid(v(jt.x - 7, jh + 0.2, jt.z), v(3, 0.2, 5), 0, 0x8a90a0, 'metal');
  b.solid(v(jt.x - 9.8, jh + 0.8, jt.z), v(0.2, 0.6, 5), 0, 0xe0a020, 'sheet', { thin: true });
  b.elevator(v(jt.x, 0.3, jt.z), jh - 0.1, v(3, 0.3, 3));
  b.ladder(v(jt.x + 4.45, 0, jt.z + 2), jh, -Math.PI / 2);

  // ---- Rooftop block with ladder (mantle onto roof edges)
  b.solid(v(-20, 3, 60), v(8, 3, 6), 0, 0xb9a68e, 'concrete');
  b.solid(v(-20, 6.15, 60), v(8.3, 0.15, 6.3), 0, 0x8a7464, 'concrete');
  b.ladder(v(-28, 0, 60), 6.3, Math.PI / 2);
  b.solid(v(-2, 1.0, 60), v(2, 1.0, 4), 0, 0xa8957e, 'concrete');
  b.solid(v(-6, 2.0, 60), v(2, 2.0, 4), 0, 0xa8957e, 'concrete');
  b.solid(v(-10, 3.0, 60), v(2, 3.0, 4), 0, 0xa8957e, 'concrete');

  // ---- Firing lanes (z -80 .. -480), shooting position at z = -70
  const lane = v(0, 0, -70);
  b.solid(v(0, 0.5, -72), v(12, 0.5, 0.4), 0, PAD2, 'concrete');
  for (let i = -2; i <= 2; i++) b.deco(box(0.08, 0.02, 400, 0xe0a020, { x: i * 6, y: 0.02, z: -275 }));
  for (const d of [10, 25, 50, 100, 200, 400]) {
    b.deco(box(10, 0.05, 0.3, 0xffffff, { y: 0.03, z: -70 - d }));
    b.glow(box(0.6, 0.6, 0.05, 0xffcf6a, { x: -14, y: 1.2, z: -70 - d }), true);
  }
  // Cover set pieces along the lanes.
  const place = (p: ReturnType<typeof barrier>, x: number, z: number, ry: number, surf: Surface) => b.prop(p, xf({ x, z, ry }), surf);
  place(barrier(), -18, -95, 0, 'concrete');
  place(sandbags(), 18, -100, 0.2, 'dirt');
  place(crate(), 22, -120, 0.3, 'wood');
  place(techCrate(), -22, -130, 0, 'metal');
  place(container(CONTAINER_COLORS[1]), 30, -160, 0, 'metal');
  place(container(CONTAINER_COLORS[0], true), -30, -170, 0.2, 'metal');
  place(fuelTank(), 40, -200, 0, 'metal');
  for (let i = 0; i < 6; i++) place(solarPanel(), -40 + i * 4, -230, 0, 'glass');
  place(fencePanel(6), 0, -150, 0, 'sheet');
  place(wallPanel(5, 3), 14, -140, 0, 'concrete');
  for (let i = 0; i < 6; i++) b.prop(lampPost(), xf({ x: i % 2 ? 16 : -16, z: -20 - i * 30, ry: i % 2 ? Math.PI : 0 }), 'metal');
  for (let i = 0; i < 4; i++) b.prop(container(CONTAINER_COLORS[(i + 2) % 6]), xf({ x: 95, z: -60 + i * 30, ry: Math.PI / 2 }), 'metal');

  return { terrain, builder: b, spawn: v(0, 0.35, 30), spawnYaw: 0, laneOrigin: lane, water: null };
}
