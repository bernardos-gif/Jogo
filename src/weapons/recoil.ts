// Deterministic recoil: a per-weapon pattern of [vertical, horizontal] kicks indexed by the shot
// number in the current string, plus small seeded noise. The same seed and shot index always
// produce the same kick, so patterns are learnable.
import { Rng } from '../core/rng';
import type { WeaponStats } from './stats';

export interface Kick {
  /** Degrees up. */
  v: number;
  /** Degrees right. */
  h: number;
}

/** Deterministic seed per weapon and shot string (the string counter increments when you stop firing). */
export function recoilSeed(weaponId: string, stringIndex: number): number {
  let h = 2166136261;
  for (let i = 0; i < weaponId.length; i++) h = Math.imul(h ^ weaponId.charCodeAt(i), 16777619);
  return (h ^ Math.imul(stringIndex + 1, 0x9e3779b1)) >>> 0;
}

/**
 * Kick for shot `shot` (0-based) of a string. Past the end of the pattern the last two entries
 * alternate. `adsMul` scales the kick when aiming; `braced` applies bipods / prone bracing.
 */
export function recoilKick(s: WeaponStats, shot: number, rng: Rng, adsMul = 1, braced = 1): Kick {
  const p = s.recoil.pattern;
  let base: [number, number];
  if (shot < p.length) base = p[shot];
  else base = p.length >= 2 ? p[p.length - 2 + ((shot - p.length) % 2)] : p[0];
  const nv = (rng.next() * 2 - 1) * s.recoil.random * 0.5;
  const nh = (rng.next() * 2 - 1) * s.recoil.random;
  return {
    v: (base[0] + nv) * s.recoil.v * adsMul * braced,
    h: (base[1] + nh) * s.recoil.h * adsMul * braced,
  };
}

/** Full sequence of kicks for a string of `n` shots (used by tests and the range readout). */
export function recoilSequence(s: WeaponStats, n: number, seed: number): Kick[] {
  const rng = new Rng(seed);
  const out: Kick[] = [];
  for (let i = 0; i < n; i++) out.push(recoilKick(s, i, rng));
  return out;
}
