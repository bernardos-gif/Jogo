import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { GridNav } from '../../src/world/nav';

describe('grid navigation fallback', () => {
  // 100 m square, flat, with a wall at x = 0 from z = -50 to z = 30 (gap at the north end).
  const wall = (x: number, z: number) => Math.abs(x) < 2 && z < 30;
  const nav = new GridNav(-50, 2, 100, () => 0, wall);

  it('routes around a wall through the gap', () => {
    const out: THREE.Vector3[] = [];
    expect(nav.findPath(new THREE.Vector3(-20, 0, -20), new THREE.Vector3(20, 0, -20), out)).toBe(true);
    expect(out.length).toBeGreaterThan(1);
    expect(Math.max(...out.map((p) => p.z))).toBeGreaterThan(28);
    for (const p of out) expect(wall(p.x, p.z)).toBe(false);
    expect(out[out.length - 1].distanceTo(new THREE.Vector3(20, 0, -20))).toBeLessThan(2.5);
  });

  it('snaps blocked points to the nearest walkable cell', () => {
    const o = new THREE.Vector3();
    expect(nav.closest(new THREE.Vector3(0, 0, 0), o)).toBe(true);
    expect(wall(o.x, o.z)).toBe(false);
    expect(Math.abs(o.x)).toBeLessThan(5);
  });

  it('treats steep slopes as blocked', () => {
    const cliff = new GridNav(-20, 1, 40, (x) => (x > 0 ? x * 3 : 0), () => false);
    const out: THREE.Vector3[] = [];
    // A path that would need to climb the cliff fails (or stays on the flat side).
    const ok = cliff.findPath(new THREE.Vector3(-10, 0, 0), new THREE.Vector3(10, 30, 0), out);
    if (ok) for (const p of out) expect(p.x).toBeLessThan(1.5);
  });
});
