import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { damageFalloff, damageAt, integrate, dropAt, coneDir } from '../../src/weapons/ballistics';
import { recoilKick, recoilSequence, recoilSeed } from '../../src/weapons/recoil';
import { weaponStats } from '../../src/weapons/stats';
import { defaultAttachments } from '../../src/art/weaponModels';
import { Rng } from '../../src/core/rng';
import { WEAPONS } from '../../src/config/content';
import { TUNING } from '../../src/config/tuning';

describe('damage falloff', () => {
  it('is full damage before the range start and minimum after the range end', () => {
    expect(damageFalloff(5, 24, 16, 15, 60)).toBe(24);
    expect(damageFalloff(15, 24, 16, 15, 60)).toBe(24);
    expect(damageFalloff(60, 24, 16, 15, 60)).toBe(16);
    expect(damageFalloff(400, 24, 16, 15, 60)).toBe(16);
  });
  it('interpolates linearly in between', () => {
    expect(damageFalloff(37.5, 24, 16, 15, 60)).toBeCloseTo(20, 6);
  });
  it('applies head and limb multipliers', () => {
    const s = weaponStats('tern', defaultAttachments('tern'));
    expect(damageAt(s, 5, 'head')).toBeCloseTo(24 * s.headMul, 6);
    expect(damageAt(s, 5, 'limb')).toBeCloseTo(24 * s.limbMul, 6);
    expect(damageAt(s, 5, 'body')).toBeCloseTo(24, 6);
  });
  it('lets the bolt sniper kill with one headshot at any range', () => {
    const s = weaponStats('longbow', defaultAttachments('longbow'));
    for (const d of [10, 100, 300, 600]) expect(damageAt(s, d, 'head')).toBeGreaterThanOrEqual(TUNING.health.max);
  });
  it('every weapon has a defined, decreasing falloff', () => {
    for (const w of WEAPONS) {
      const s = weaponStats(w.id, defaultAttachments(w.id));
      expect(s.damage[0]).toBeGreaterThanOrEqual(s.damage[1]);
      expect(s.range[1]).toBeGreaterThanOrEqual(s.range[0]);
    }
  });
});

describe('ballistics', () => {
  it('drops according to gravity over time', () => {
    const pos = new THREE.Vector3(0, 0, 0);
    const vel = new THREE.Vector3(0, 0, -800);
    const prev = new THREE.Vector3();
    const g = 9.81;
    const dt = 1 / 60;
    let t = 0;
    while (t < 0.5 - 1e-9) {
      integrate(pos, vel, prev, dt, g);
      t += dt;
    }
    // Semi-implicit Euler lands within a few percent of the analytic drop.
    const analytic = 0.5 * g * t * t;
    expect(-pos.y).toBeGreaterThan(analytic * 0.95);
    expect(-pos.y).toBeLessThan(analytic * 1.1);
    expect(pos.z).toBeCloseTo(-400, 0);
  });
  it('returns the swept segment length each tick', () => {
    const pos = new THREE.Vector3();
    const vel = new THREE.Vector3(600, 0, 0);
    const prev = new THREE.Vector3();
    const len = integrate(pos, vel, prev, 1 / 60, 0);
    expect(len).toBeCloseTo(10, 6);
    expect(prev.x).toBe(0);
  });
  it('computes drop at range', () => {
    expect(dropAt(100, 1000, 9.81)).toBeCloseTo(0.04905, 5);
  });
  it('keeps spread directions inside the cone', () => {
    const dir = new THREE.Vector3(0, 0, -1);
    const rng = new Rng(9);
    const out = new THREE.Vector3();
    for (let i = 0; i < 200; i++) {
      coneDir(dir, 3, rng.next(), rng.next(), out);
      expect(THREE.MathUtils.radToDeg(out.angleTo(dir))).toBeLessThanOrEqual(3.0001);
      expect(out.length()).toBeCloseTo(1, 6);
    }
  });
});

describe('recoil', () => {
  it('is deterministic for the same seed', () => {
    const s = weaponStats('tern', defaultAttachments('tern'));
    const a = recoilSequence(s, 20, recoilSeed('tern', 3));
    const b = recoilSequence(s, 20, recoilSeed('tern', 3));
    expect(a).toEqual(b);
  });
  it('differs between strings but follows the same base pattern', () => {
    const s = weaponStats('tern', defaultAttachments('tern'));
    const a = recoilSequence(s, 8, recoilSeed('tern', 1));
    const b = recoilSequence(s, 8, recoilSeed('tern', 2));
    expect(a).not.toEqual(b);
    for (let i = 0; i < 8; i++) {
      const base = s.recoil.pattern[i];
      expect(Math.abs(a[i].v - base[0] * s.recoil.v)).toBeLessThanOrEqual(s.recoil.random * 0.5 * s.recoil.v + 1e-9);
      expect(Math.abs(b[i].h - base[1] * s.recoil.h)).toBeLessThanOrEqual(s.recoil.random * s.recoil.h + 1e-9);
    }
  });
  it('kicks upward for every weapon', () => {
    for (const w of WEAPONS) {
      const s = weaponStats(w.id, defaultAttachments(w.id));
      const k = recoilKick(s, 0, new Rng(1));
      expect(k.v).toBeGreaterThan(0);
    }
  });
  it('compensator and vertical grip reduce vertical recoil', () => {
    const base = weaponStats('tern', { sight: 'holo', barrel: 'standard', underbarrel: 'agrip', ammo: 'standard' });
    const comp = weaponStats('tern', { sight: 'holo', barrel: 'compensator', underbarrel: 'vgrip', ammo: 'standard' });
    expect(recoilKick(comp, 0, new Rng(5)).v).toBeLessThan(recoilKick(base, 0, new Rng(5)).v);
  });
});

describe('attachments', () => {
  it('change stats as described', () => {
    const t = (b: 'standard' | 'suppressor' | 'longBarrel') => weaponStats('sable', { sight: 'prism2', barrel: b, underbarrel: 'vgrip', ammo: 'standard' });
    expect(t('suppressor').suppressed).toBe(true);
    expect(t('longBarrel').velocity).toBeGreaterThan(t('standard').velocity);
    expect(weaponStats('sable', { sight: 'optic8', barrel: 'standard', underbarrel: 'vgrip', ammo: 'standard' }).zoom).toBe(8);
    expect(weaponStats('tern', { sight: 'holo', barrel: 'standard', underbarrel: 'vgrip', ammo: 'piercing' }).penetration).toBe(2);
  });
});
