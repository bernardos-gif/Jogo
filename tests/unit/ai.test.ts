import { describe, expect, it } from 'vitest';
import { TUNING } from '../../src/config/tuning';
import { zoneUtility, chooseObjective, type ObjectiveView, type UtilityInput } from '../../src/ai/utility';
import { AimState, turnToward, throwPitch } from '../../src/ai/aim';
import { Rng } from '../../src/core/rng';

const zone = (id: ObjectiveView['id'], x: number, z: number, owner: -1 | 0 | 1, extra: Partial<ObjectiveView> = {}): ObjectiveView => ({ id, x, z, radius: 30, owner, contested: false, capturing: -1, enemiesNear: 0, ...extra });

const input = (zones: ObjectiveView[], extra: Partial<UtilityInput> = {}): UtilityInput => ({ team: 0, x: 0, z: 0, squadSize: 4, tickets: [600, 600], zones, assigned: new Map(), ...extra });

describe('squad objective utility', () => {
  it('prefers a nearby neutral zone over a far one', () => {
    const near = zone('A', 50, 0, -1), far = zone('B', 600, 0, -1);
    const inp = input([near, far]);
    expect(zoneUtility(inp, near)).toBeGreaterThan(zoneUtility(inp, far));
    expect(chooseObjective(inp, null)).toMatchObject({ zone: 'A', kind: 'attack' });
  });

  it('values a contested own zone above a safe one and defends it', () => {
    const safe = zone('A', 100, 0, 0), hot = zone('B', 100, 50, 0, { contested: true });
    const inp = input([safe, hot]);
    expect(chooseObjective(inp, null)).toMatchObject({ zone: 'B', kind: 'defend' });
    const taken = zone('C', 100, 0, 0, { capturing: 1 });
    expect(zoneUtility(input([taken]), taken)).toBeGreaterThan(zoneUtility(input([safe]), safe));
  });

  it('ranks safe owned zones lowest', () => {
    const safe = zone('A', 50, 0, 0), enemy = zone('B', 80, 0, 1), neutral = zone('C', 80, 0, -1);
    const inp = input([safe, enemy, neutral]);
    expect(zoneUtility(inp, safe)).toBeLessThan(zoneUtility(inp, enemy));
    expect(zoneUtility(inp, safe)).toBeLessThan(zoneUtility(inp, neutral));
  });

  it('crowding spreads squads across objectives', () => {
    const a = zone('A', 100, 0, -1), b = zone('B', 140, 0, -1);
    expect(chooseObjective(input([a, b]), null)!.zone).toBe('A');
    expect(chooseObjective(input([a, b], { assigned: new Map([['A', 2]]) }), null)!.zone).toBe('B');
  });

  it('overwhelming known threat lowers a zone', () => {
    const quiet = zone('A', 100, 0, 1), hot = zone('B', 100, 0, 1, { enemiesNear: 14 });
    const inp = input([quiet, hot]);
    expect(zoneUtility(inp, hot)).toBeLessThan(zoneUtility(inp, quiet));
  });

  it('losing on tickets raises the value of zones we do not hold', () => {
    const enemy = zone('B', 200, 0, 1);
    const even = zoneUtility(input([enemy, zone('A', 0, 0, 0)]), enemy);
    const losing = zoneUtility(input([enemy, zone('A', 0, 0, 0)], { tickets: [200, 600] }), enemy);
    expect(losing).toBeGreaterThan(even);
  });

  it('keeps the current objective unless another is clearly better (hysteresis)', () => {
    const a = zone('A', 100, 0, -1), b = zone('B', 105, 0, -1);
    expect(chooseObjective(input([a, b]), 'B')!.zone).toBe('B');
    const far = zone('B', 900, 0, -1);
    expect(chooseObjective(input([a, far]), 'B')!.zone).toBe('A');
  });
});

describe('bot aim', () => {
  const p = TUNING.ai.difficulty.veteran;

  it('is deterministic for a seed', () => {
    const run = () => {
      const r = new Rng(77);
      const a = new AimState();
      a.acquire(1, 60, p, () => r.next());
      for (let i = 0; i < 120; i++) a.update(1 / 60, 60, 2, 0, p, () => r.next());
      return [a.errYaw, a.errPitch, a.reactLeft];
    };
    expect(run()).toEqual(run());
  });

  it('starts with a reaction delay and settles toward the tracking floor', () => {
    const r = new Rng(5);
    const a = new AimState();
    a.acquire(1, 50, p, () => r.next());
    expect(a.reactLeft).toBeGreaterThan(0.1);
    const start = a.magnitude;
    let avg = 0;
    for (let i = 0; i < 600; i++) {
      a.update(1 / 60, 50, 0, 0, p, () => r.next());
      if (i >= 300) avg += a.magnitude / 300;
    }
    expect(a.reactLeft).toBe(0);
    const floor = a.floor(50, 0, 0, p);
    expect(avg).toBeLessThan(start);
    expect(avg).toBeLessThan(floor * 2.5);
    expect(avg).toBeGreaterThan(floor * 0.3);
  });

  it('gets worse with range, target speed, suppression and lower difficulty', () => {
    const a = new AimState();
    const near = a.floor(20, 0, 0, p) * 20;
    const far = a.floor(200, 0, 0, p) * 200;
    expect(far).toBeGreaterThan(near);
    expect(a.floor(50, 6, 0, p)).toBeGreaterThan(a.floor(50, 0, 0, p));
    expect(a.floor(50, 0, 1, p)).toBeGreaterThan(a.floor(50, 0, 0, p));
    expect(a.floor(50, 0, 0, TUNING.ai.difficulty.recruit)).toBeGreaterThan(a.floor(50, 0, 0, TUNING.ai.difficulty.elite));
  });

  it('turns at a capped rate', () => {
    const [y, pt] = turnToward(0, 0, 1, 0, 0.1);
    expect(y).toBeCloseTo(0.1);
    expect(pt).toBe(0);
    const [y2] = turnToward(3, 0, -3, 0, 0.1);
    expect(y2).toBeGreaterThan(3);
    const [y3, p3] = turnToward(0, 0, 0.05, 0.02, 0.5);
    expect(y3).toBeCloseTo(0.05, 9);
    expect(p3).toBe(0.02);
  });

  it('solves a grenade arc that lands at the requested range', () => {
    const T = TUNING.throwables;
    const g = TUNING.weapons.gravity;
    for (const d of [10, 20, 30]) {
      const pitch = throwPitch(d, 0, T.throwSpeed, T.throwUp, 0.12, g);
      const a = pitch + 0.12;
      const vx = Math.cos(a) * T.throwSpeed, vy = Math.sin(a) * T.throwSpeed + T.throwUp;
      const t = (2 * vy) / g;
      expect(Math.abs(vx * t - d)).toBeLessThan(1.5);
    }
  });
});
