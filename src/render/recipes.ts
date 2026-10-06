// Effect recipes: how game events look, built only from the VFX primitives so every effect
// shares Elemental Brawl's vocabulary (flash + spark burst + lit chunks, rings, blast spheres,
// bolts, trails). Colors per STYLE_GUIDE.md section 7.
import * as THREE from 'three';
import { GLOW, randomUnit, type VFX } from './vfx';
import type { Surface } from '../world/surface';
import type { EnergyFamily } from '../config/content';
import { fxRng } from '../core/rng';

export const FX_COLORS = {
  kinetic: { main: 0xffb52e, light: 0xfff4c8 },
  cyan: { main: 0x3fe0ff, light: 0xd8fbff },
  violet: { main: 0xb56bff, light: 0xefdcff },
  rocket: { main: 0xff5a1f, light: 0xffd04a },
  emp: { main: 0x7cc8ff, light: 0xeaf8ff },
  heal: { main: 0x6dff9a, light: 0xe6ffee },
  smoke: [0xd8d0c8, 0xbfb6ae, 0xa8a09a],
  dust: [0xd8c8b0, 0xc8b496],
};

interface SurfaceFx {
  chunks: number[];
  puff: number[];
  sparks: number | null;
  spark2: number | null;
  shape: 'cube' | 'tetra' | 'spark';
}

const SURFACE_FX: Record<Surface, SurfaceFx> = {
  concrete: { chunks: [0xb9a68e, 0xa8957e], puff: [0xd8c8b0], sparks: null, spark2: null, shape: 'cube' },
  metal: { chunks: [0x5a5f6e], puff: [0x9a9aa0], sparks: 0xffb030, spark2: 0xfff0b0, shape: 'spark' },
  sheet: { chunks: [0x8a90a0], puff: [0xa0a0a8], sparks: 0xffb030, spark2: 0xfff0b0, shape: 'spark' },
  glass: { chunks: [0xcfefff, 0xa8d8f0], puff: [0xe0f4ff], sparks: 0xcfefff, spark2: 0xffffff, shape: 'tetra' },
  wood: { chunks: [0xa8733f, 0x6b4423], puff: [0xc8a070], sparks: null, spark2: null, shape: 'spark' },
  dirt: { chunks: [0x7a6a58, 0x5a4a3a], puff: [0xa08868], sparks: null, spark2: null, shape: 'tetra' },
  sand: { chunks: [0xc9a77c], puff: [0xe0c8a0], sparks: null, spark2: null, shape: 'tetra' },
  grass: { chunks: [0x8a8a4a, 0x6a7a3a], puff: [0xa8a070], sparks: null, spark2: null, shape: 'tetra' },
  water: { chunks: [], puff: [0xbfe6f0], sparks: 0xbfe6f0, spark2: 0xffffff, shape: 'spark' },
  armor: { chunks: [], puff: [], sparks: 0xffd8a0, spark2: 0xffffff, shape: 'spark' },
  energy: { chunks: [], puff: [], sparks: 0x6fd8ff, spark2: 0xb4f2ff, shape: 'spark' },
};

const _v = new THREE.Vector3();

/** Bullet impact on a surface. `energy` tints the flash for energy weapons. */
export function impact(vfx: VFX, pos: THREE.Vector3, normal: THREE.Vector3, surface: Surface, energy: EnergyFamily = 'kinetic', heavy = false, emissive?: number): void {
  const s = SURFACE_FX[surface];
  const isEnergy = energy === 'cyan' || energy === 'violet';
  const ec = FX_COLORS[energy];
  vfx.flash(pos, isEnergy ? ec.light : 0xfff0d0, heavy ? 1.6 : 0.7, heavy ? 0.12 : 0.07);
  if (surface === 'armor' && emissive !== undefined) {
    vfx.burst(pos, { count: heavy ? 10 : 5, color: 0xffffff, color2: emissive, speed: [3, 8], life: [0.1, 0.25], size: [0.04, 0.08], shape: 'spark', dir: normal, spread: 0.7, drag: 4 });
    return;
  }
  if (s.sparks !== null) {
    vfx.burst(pos, { count: heavy ? 12 : 6, color: s.spark2 ?? s.sparks, color2: s.sparks, speed: [4, 11], life: [0.1, 0.3], size: [0.03, 0.06], shape: 'spark', dir: normal, spread: 0.6, drag: 3, gravity: 9 });
  }
  if (isEnergy) {
    vfx.burst(pos, { count: heavy ? 8 : 4, color: ec.light, color2: ec.main, speed: [2, 6], life: [0.12, 0.3], size: [0.05, 0.1], shape: 'tetra', dir: normal, spread: 0.8, drag: 4 });
    vfx.shockwave(pos, ec.main, heavy ? 0.9 : 0.5, 0.18, { normal, r0: 0.05 });
  }
  if (s.chunks.length) {
    vfx.burst(pos, { count: heavy ? 6 : 3, color: s.chunks[0], color2: s.chunks[s.chunks.length - 1], speed: [2, 5], up: 1.5, life: [0.35, 0.7], size: [0.05, 0.11], shape: s.shape === 'spark' ? 'cube' : s.shape, additive: false, gravity: 16, dir: normal, spread: 0.7 });
  }
  if (s.puff.length) {
    vfx.burst(_v.copy(pos).addScaledVector(normal, 0.1), { count: heavy ? 3 : 2, color: s.puff[0], speed: [0.4, 1.4], up: 0.6, life: [0.5, 1.0], size: [0.18, 0.32], sizeEnd: 1.6, shape: 'puff', additive: false, drag: 2.5, dir: normal, spread: 0.6 });
  }
  if (surface === 'water') {
    vfx.burst(pos, { count: 6, color: 0xd8f0ff, speed: [2, 5], up: 3, gravity: 14, life: [0.3, 0.6], size: [0.06, 0.12], shape: 'puff', additive: false });
  }
}

/** Muzzle flash at the barrel tip along `dir`. */
export function muzzleFlash(vfx: VFX, pos: THREE.Vector3, dir: THREE.Vector3, energy: EnergyFamily, scale = 1, light = true): void {
  const c = FX_COLORS[energy];
  vfx.flash(pos, c.light, 0.55 * scale, 0.05);
  vfx.burst(pos, { count: Math.round(4 * scale), color: c.light, color2: c.main, speed: [6, 14], life: [0.04, 0.09], size: [0.03, 0.06], shape: 'spark', dir, spread: 0.25, drag: 6 });
  if (light) vfx.light(pos, c.main, 18 * scale, 0.06, 10);
}

/** Spent casing (kinetic) or vent puff (energy). */
export function shellEject(vfx: VFX, pos: THREE.Vector3, right: THREE.Vector3, energy: EnergyFamily): void {
  if (energy === 'cyan' || energy === 'violet') {
    const c = FX_COLORS[energy];
    vfx.burst(pos, { count: 2, color: c.light, color2: c.main, speed: [0.5, 1.5], up: 0.8, life: [0.15, 0.3], size: [0.03, 0.05], shape: 'puff', dir: right, spread: 0.5, drag: 3 });
    return;
  }
  vfx.burst(pos, { count: 1, color: 0xd8a040, speed: [2.5, 3.5], up: 2.5, life: [0.6, 0.9], size: [0.02, 0.025], shape: 'cube', additive: false, gravity: 14, dir: right, spread: 0.2, spin: 20 });
}

export type ExplosionKind = 'frag' | 'rocket' | 'shell' | 'fuel' | 'vehicle' | 'launch';

/** Explosion: flash, blast sphere, ground ring, spark burst, fire puffs, smoke, debris, light. */
export function explosion(vfx: VFX, pos: THREE.Vector3, radius: number, kind: ExplosionKind): void {
  const big = kind === 'fuel' || kind === 'vehicle' || kind === 'launch';
  const r = radius;
  vfx.flash(pos, 0xffe8b0, r * 1.4, 0.18);
  vfx.blastSphere(pos, 0xff7a2a, r * 0.8, big ? 0.45 : 0.3);
  vfx.shockwave(pos, 0xffd04a, r * 1.5, big ? 0.6 : 0.4, { r0: r * 0.2 });
  vfx.light(pos, 0xff8a3a, big ? 160 : 70, big ? 0.5 : 0.3, r * 6);
  vfx.burst(pos, { count: big ? 40 : 22, color: 0xfff4c8, color2: 0xff5a1f, speed: [8, big ? 26 : 18], life: [0.15, 0.45], size: [0.06, 0.14], shape: 'spark', drag: 2.5, gravity: 6 });
  vfx.burst(pos, { count: big ? 18 : 10, color: 0xffb030, color2: 0xff2a00, speed: [2, 6], up: 3, life: [0.3, 0.7], size: [r * 0.12, r * 0.22], sizeEnd: 0.2, shape: 'puff', drag: 2 });
  vfx.burst(pos, { count: big ? 14 : 8, color: 0x5a504c, color2: 0x3a3436, speed: [1, 4], up: 2.5, life: [1.4, big ? 3.4 : 2.4], size: [r * 0.12, r * 0.24], sizeEnd: 2.2, shape: 'puff', additive: false, drag: 1.4 });
  vfx.debris(pos, kind === 'fuel' ? [0xc04a3a, 0x5a5f6e, 0x3a3436] : [0x7a6a58, 0x5a4a3a, 0x3a3436], big ? 18 : 8, { speed: [4, big ? 16 : 10], size: [0.12, big ? 0.6 : 0.3], up: 5 });
}

/** EMP burst: cold ring, sphere and short bolts. */
export function empBurst(vfx: VFX, pos: THREE.Vector3, radius: number): void {
  const c = FX_COLORS.emp;
  vfx.flash(pos, c.light, radius * 1.2, 0.2);
  vfx.blastSphere(pos, c.main, radius, 0.4);
  vfx.shockwave(pos, c.light, radius * 1.3, 0.5, { r0: 0.4 });
  vfx.light(pos, c.main, 60, 0.4, radius * 4);
  for (let i = 0; i < 4; i++) vfx.bolt(pos, _v.copy(pos).add(randomUnit().multiplyScalar(radius * fxRng.range(0.5, 1))), c.light, { width: 0.06, segments: 5, branches: 0, life: 0.25 });
}

/** Lightning strike from sky to ground (ion storm). */
export function lightningStrike(vfx: VFX, from: THREE.Vector3, to: THREE.Vector3): void {
  vfx.bolt(from, to, 0xd8e8ff, { width: 0.9, segments: 14, jag: 10, branches: 4, life: 0.35 });
  vfx.bolt(from, to, 0xa0c0ff, { width: 0.4, segments: 10, jag: 14, branches: 2, life: 0.25 });
  vfx.flash(to, 0xe0ecff, 14, 0.25);
  vfx.shockwave(to, 0xb0d0ff, 10, 0.5, { r0: 1 });
  vfx.light(to, 0xb0d0ff, 220, 0.35, 90);
  vfx.burst(to, { count: 20, color: 0xffffff, color2: 0x8ab0ff, speed: [6, 18], life: [0.15, 0.4], size: [0.06, 0.14], shape: 'spark', drag: 2, gravity: 6 });
  vfx.decal(to, new THREE.Vector3(0, 1, 0), 4, 'burn', 30);
}

/** Healing pulse (dart hit, crate refill). */
export function healPulse(vfx: VFX, pos: THREE.Vector3): void {
  const c = FX_COLORS.heal;
  vfx.burst(pos, { count: 8, color: c.light, color2: c.main, speed: [1, 3], up: 1.5, life: [0.3, 0.7], size: [0.05, 0.1], shape: 'tetra', drag: 2 });
  vfx.shockwave(pos, c.main, 1.2, 0.35, { r0: 0.1 });
}

/** Dust kicked up by landings, slides, vehicles and the storm. */
export function dustKick(vfx: VFX, pos: THREE.Vector3, amount: number): void {
  vfx.burst(pos, { count: Math.round(3 * amount), color: FX_COLORS.dust[0], color2: FX_COLORS.dust[1], speed: [0.5, 2 * amount], up: 0.5, life: [0.6, 1.2], size: [0.2, 0.4], sizeEnd: 1.8, shape: 'puff', additive: false, drag: 2, flat: true, radius: 0.4 });
}

/** Energy shield hit ripple sparks. */
export function shieldSpark(vfx: VFX, pos: THREE.Vector3, normal: THREE.Vector3, color: number): void {
  vfx.burst(pos, { count: 4, color: 0xffffff, color2: color, speed: [2, 6], life: [0.1, 0.22], size: [0.04, 0.07], shape: 'spark', dir: normal, spread: 0.6, drag: 4 });
}

export { GLOW };
