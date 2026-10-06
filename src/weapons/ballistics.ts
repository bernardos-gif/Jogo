// Pure ballistics: damage falloff, body-part multipliers, projectile integration with drop.
import * as THREE from 'three';
import type { WeaponStats } from './stats';
import type { HitPart } from '../physics/collision';

/** Damage at a distance: full until range start, linear to the minimum at range end. */
export function damageFalloff(dist: number, max: number, min: number, start: number, end: number): number {
  if (dist <= start) return max;
  if (dist >= end) return min;
  return max + ((min - max) * (dist - start)) / (end - start);
}

export function damageAt(s: WeaponStats, dist: number, part: HitPart | null): number {
  const base = damageFalloff(dist, s.damage[0], s.damage[1], s.range[0], s.range[1]);
  if (part === 'head') return base * s.headMul;
  if (part === 'limb') return base * s.limbMul;
  return base;
}

/**
 * Advances a projectile by one step (semi-implicit Euler with gravity) and returns the swept
 * segment length. `pos` and `vel` are mutated; `prev` receives the previous position.
 */
export function integrate(pos: THREE.Vector3, vel: THREE.Vector3, prev: THREE.Vector3, dt: number, gravity: number): number {
  prev.copy(pos);
  vel.y -= gravity * dt;
  pos.addScaledVector(vel, dt);
  return prev.distanceTo(pos);
}

/** Bullet drop (meters below the launch line) after flying `dist` meters at `speed`. */
export function dropAt(dist: number, speed: number, gravity: number): number {
  const t = dist / speed;
  return 0.5 * gravity * t * t;
}

/** Uniform random direction inside a cone of half-angle `deg` around `dir` (seeded). */
export function coneDir(dir: THREE.Vector3, deg: number, r1: number, r2: number, out: THREE.Vector3): THREE.Vector3 {
  if (deg <= 0) return out.copy(dir);
  const a = THREE.MathUtils.degToRad(deg);
  const cosA = Math.cos(a);
  const z = cosA + (1 - cosA) * r1;
  const phi = r2 * Math.PI * 2;
  const sz = Math.sqrt(1 - z * z);
  // Basis around dir.
  const up = Math.abs(dir.y) < 0.95 ? _up.set(0, 1, 0) : _up.set(1, 0, 0);
  const u = _u.crossVectors(up, dir).normalize();
  const v = _w.crossVectors(dir, u);
  return out
    .copy(dir)
    .multiplyScalar(z)
    .addScaledVector(u, Math.cos(phi) * sz)
    .addScaledVector(v, Math.sin(phi) * sz)
    .normalize();
}

const _up = new THREE.Vector3();
const _u = new THREE.Vector3();
const _w = new THREE.Vector3();
