// Gadget models built from primitives (toon parts plus glow parts), merged per piece so the gadget
// system can instance them: sentry base and head, shield emitter, supply cache, motion sensor,
// scout drone, healing dart.
import * as THREE from 'three';
import { ModelBuilder, box, cyl, cone, octa, torus, ico } from '../render/toon';
import { FACTION_PALETTES } from './palette';
import type { TeamId } from '../config/content';

export interface GadgetGeo {
  toon: THREE.BufferGeometry | null;
  glow: THREE.BufferGeometry | null;
}

const STEEL = 0x5a5f6e;
const DARK = 0x2e3038;

function done(b: ModelBuilder): GadgetGeo {
  return b.geometries(true);
}

/** Sentry tripod and pivot housing (origin at the ground). */
export function sentryBase(team: TeamId): GadgetGeo {
  const pal = FACTION_PALETTES[team];
  const b = new ModelBuilder();
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    b.add(box(0.07, 0.07, 0.78, STEEL, { x: Math.sin(a) * 0.26, y: 0.28, z: Math.cos(a) * 0.26, ry: a, rx: -0.75 }));
    b.add(box(0.12, 0.04, 0.16, DARK, { x: Math.sin(a) * 0.5, y: 0.02, z: Math.cos(a) * 0.5, ry: a }));
  }
  b.add(cyl(0.16, 0.2, 0.22, 8, pal.armor, { y: 0.62 }));
  b.add(cyl(0.21, 0.21, 0.05, 8, pal.secondary, { y: 0.52 }));
  b.addGlow(cyl(0.215, 0.215, 0.02, 8, pal.glow, { y: 0.69 }));
  return done(b);
}

/** Sentry head (origin at the pivot, barrel along -Z). */
export function sentryHead(team: TeamId): GadgetGeo {
  const pal = FACTION_PALETTES[team];
  const b = new ModelBuilder();
  b.add(box(0.34, 0.24, 0.42, pal.armor, { y: 0.1 }));
  b.add(box(0.36, 0.06, 0.44, pal.secondary, { y: 0.24 }));
  b.add(cyl(0.035, 0.035, 0.5, 6, DARK, { y: 0.08, z: -0.4, rx: Math.PI / 2 }));
  b.add(cyl(0.05, 0.05, 0.12, 6, DARK, { y: 0.08, z: -0.66, rx: Math.PI / 2 }));
  b.add(box(0.08, 0.16, 0.18, STEEL, { x: 0.21, y: 0.06, z: 0.04 }));
  b.addGlow(box(0.2, 0.05, 0.02, pal.glow, { y: 0.14, z: -0.22 }));
  b.addGlow(octa(0.03, pal.glow, { x: 0.12, y: 0.25, z: 0.16 }));
  return done(b);
}

/** Bulwark emitter (the hex wall itself uses the shield material). */
export function shieldEmitter(team: TeamId, width: number): GadgetGeo {
  const pal = FACTION_PALETTES[team];
  const b = new ModelBuilder();
  b.add(box(width, 0.12, 0.26, DARK, { y: 0.06 }));
  b.add(box(width * 0.98, 0.05, 0.3, pal.armor, { y: 0.13 }));
  for (const s of [-1, 1]) b.add(box(0.12, 0.34, 0.2, pal.secondary, { x: (s * width) / 2, y: 0.17 }));
  b.addGlow(box(width * 0.94, 0.03, 0.04, pal.glow, { y: 0.17, z: -0.12 }));
  return done(b);
}

/** Supply cache crate. */
export function supplyCache(team: TeamId): GadgetGeo {
  const pal = FACTION_PALETTES[team];
  const b = new ModelBuilder();
  b.add(box(0.95, 0.5, 0.6, pal.armor, { y: 0.25 }));
  b.add(box(0.99, 0.08, 0.64, DARK, { y: 0.52 }));
  b.add(box(0.99, 0.06, 0.64, DARK, { y: 0.04 }));
  for (const s of [-1, 1]) b.add(box(0.06, 0.3, 0.5, pal.secondary, { x: s * 0.49, y: 0.27 }));
  b.add(cyl(0.015, 0.015, 0.7, 4, STEEL, { x: 0.38, y: 0.9, z: 0.22 }));
  b.addGlow(box(0.6, 0.05, 0.02, 0x8dff7a, { y: 0.32, z: 0.31 }));
  b.addGlow(box(0.05, 0.22, 0.02, 0x8dff7a, { y: 0.32, z: 0.31 }));
  b.addGlow(octa(0.04, pal.glow, { x: 0.38, y: 1.27, z: 0.22 }));
  return done(b);
}

/** Echo motion sensor puck with a ground spike. */
export function motionSensor(team: TeamId): GadgetGeo {
  const pal = FACTION_PALETTES[team];
  const b = new ModelBuilder();
  b.add(cyl(0.12, 0.14, 0.07, 10, DARK, { y: 0.06 }));
  b.add(cone(0.04, 0.16, 6, STEEL, { y: -0.04, rx: Math.PI }));
  b.add(cyl(0.02, 0.02, 0.3, 4, STEEL, { y: 0.24 }));
  b.addGlow(torus(0.11, 0.012, 4, 14, pal.glow, { y: 0.1, rx: Math.PI / 2 }));
  b.addGlow(ico(0.03, pal.glow, { y: 0.41 }));
  return done(b);
}

/** Kestrel scout drone (origin at its center, nose toward -Z). */
export function scoutDrone(team: TeamId): GadgetGeo {
  const pal = FACTION_PALETTES[team];
  const b = new ModelBuilder();
  b.add(box(0.34, 0.12, 0.42, pal.armor));
  b.add(box(0.2, 0.08, 0.16, DARK, { y: -0.08, z: -0.1 }));
  for (const [x, z] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]] as const) {
    b.add(box(0.36, 0.03, 0.04, STEEL, { x: x / 2, z: z / 2, ry: Math.atan2(x, z) }));
    b.add(cyl(0.05, 0.05, 0.06, 6, DARK, { x, z }));
    b.addGlow(torus(0.12, 0.008, 3, 12, pal.glow, { x, y: 0.04, z, rx: Math.PI / 2 }));
  }
  b.addGlow(box(0.06, 0.04, 0.02, 0xff3040, { y: -0.08, z: -0.19 }));
  return done(b);
}

/** Mender dart (nose toward -Z). */
export function menderDart(): GadgetGeo {
  const b = new ModelBuilder();
  b.add(cyl(0.012, 0.012, 0.16, 5, 0xd8d2c4, { rx: Math.PI / 2 }));
  b.add(box(0.05, 0.002, 0.03, 0x3d6fa8, { z: 0.07 }));
  b.addGlow(cone(0.015, 0.04, 5, 0x8dff7a, { z: -0.1, rx: -Math.PI / 2 }));
  return done(b);
}
