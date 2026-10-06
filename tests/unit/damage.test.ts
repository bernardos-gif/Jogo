import { describe, expect, it, beforeAll } from 'vitest';
import * as THREE from 'three';
import { Physics, initPhysics } from '../../src/physics/physics';
import { Soldier } from '../../src/player/soldier';
import { attachBody, teleport } from '../../src/player/movement';
import { damageSoldier, stepHealth, type CombatContext } from '../../src/weapons/damage';
import { EventBus } from '../../src/core/events';
import { TUNING } from '../../src/config/tuning';
import { Rng } from '../../src/core/rng';

function setup() {
  const physics = new Physics();
  physics.addStaticBox(new THREE.Vector3(0, -0.5, 0), new THREE.Vector3(50, 0.5, 50));
  const events = new EventBus();
  const soldiers: Soldier[] = [];
  const mk = (id: number, team: 0 | 1, cls: 'assault' | 'support' = 'assault') => {
    const s = new Soldier(id, `S${id}`, team, cls, cls === 'support' ? 'lindqvist' : 'varga', 'tern', 'frag');
    attachBody(s, physics);
    teleport(s, new THREE.Vector3(id * 1.2, 0, 0));
    soldiers.push(s);
    return s;
  };
  const ctx = {
    time: 0,
    soldiers,
    events,
    physics,
    rng: new Rng(1),
    player: null,
    soldierById: (id: number) => soldiers.find((s) => s.id === id),
    onExplosion: () => undefined,
    damageObject: () => false,
    smokeBlocks: () => false,
    isMedic: (s: Soldier) => s.cls === 'support',
    fastReviver: () => false,
    explosiveResist: () => 1,
  } as unknown as CombatContext;
  return { ctx, mk, events };
}
const from = new THREE.Vector3();

describe('damage and health', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it('armor plates absorb damage before health', () => {
    const { ctx, mk } = setup();
    const a = mk(1, 0);
    const v = mk(2, 1);
    v.maxArmor = v.armor = TUNING.health.armorPlate;
    const r = damageSoldier(ctx, v, 15, { attacker: a, weapon: 'tern', part: 'body', explosive: false, from, armorMul: 1 });
    expect(v.armor).toBeCloseTo(5, 6);
    expect(v.health).toBe(100);
    expect(r.armorBreak).toBe(false);
    const r2 = damageSoldier(ctx, v, 15, { attacker: a, weapon: 'tern', part: 'body', explosive: false, from, armorMul: 1 });
    expect(r2.armorBreak).toBe(true);
    expect(v.health).toBeCloseTo(90, 6);
  });

  it('ignores friendly fire', () => {
    const { ctx, mk } = setup();
    const a = mk(1, 0);
    const v = mk(2, 0);
    damageSoldier(ctx, v, 50, { attacker: a, weapon: 'tern', part: 'body', explosive: false, from, armorMul: 1 });
    expect(v.health).toBe(100);
  });

  it('lethal bullet damage downs, a teammate revives, a medic is faster', () => {
    const { ctx, mk, events } = setup();
    const a = mk(1, 1);
    const v = mk(2, 0);
    const medic = mk(3, 0, 'support');
    let kills = 0;
    events.on('kill', () => kills++);
    const r = damageSoldier(ctx, v, 150, { attacker: a, weapon: 'tern', part: 'body', explosive: false, from, armorMul: 1 });
    expect(r.downed).toBe(true);
    expect(v.downed).toBe(true);
    expect(v.alive).toBe(true);
    expect(kills).toBe(1);
    medic.input.interactHeld = true;
    let t = 0;
    while (v.downed && t < 10) {
      stepHealth(ctx, v, 1 / 60);
      t += 1 / 60;
    }
    expect(v.downed).toBe(false);
    expect(t).toBeLessThan(TUNING.health.reviveTime);
    expect(v.health).toBe(TUNING.health.revivedHealth);
  });

  it('downed soldiers bleed out, and enemies can finish them', () => {
    const { ctx, mk, events } = setup();
    const a = mk(1, 1);
    const v = mk(2, 0);
    let deaths = 0;
    events.on('death', () => deaths++);
    damageSoldier(ctx, v, 150, { attacker: a, weapon: 'tern', part: 'body', explosive: false, from, armorMul: 1 });
    for (let t = 0; t < TUNING.health.downedSeconds + 1; t += 1 / 60) stepHealth(ctx, v, 1 / 60);
    expect(v.alive).toBe(false);
    expect(deaths).toBe(1);
    const v2 = mk(4, 0);
    damageSoldier(ctx, v2, 150, { attacker: a, weapon: 'tern', part: 'body', explosive: false, from, armorMul: 1 });
    damageSoldier(ctx, v2, 5, { attacker: a, weapon: 'tern', part: 'body', explosive: false, from, armorMul: 1 });
    expect(v2.alive).toBe(false);
  });

  it('explosive overkill kills outright', () => {
    const { ctx, mk } = setup();
    const a = mk(1, 1);
    const v = mk(2, 0);
    const r = damageSoldier(ctx, v, 200, { attacker: a, weapon: 'frag', part: null, explosive: true, from, armorMul: 1 });
    expect(r.killed).toBe(true);
    expect(v.alive).toBe(false);
  });

  it('regenerates after the delay', () => {
    const { ctx, mk } = setup();
    const a = mk(1, 1);
    const v = mk(2, 0);
    damageSoldier(ctx, v, 40, { attacker: a, weapon: 'tern', part: 'body', explosive: false, from, armorMul: 1 });
    for (let t = 0; t < TUNING.health.regenDelay - 0.5; t += 1 / 60) {
      (ctx as { time: number }).time += 1 / 60;
      stepHealth(ctx, v, 1 / 60);
    }
    expect(v.health).toBeCloseTo(60, 3);
    for (let t = 0; t < 6; t += 1 / 60) {
      (ctx as { time: number }).time += 1 / 60;
      stepHealth(ctx, v, 1 / 60);
    }
    expect(v.health).toBe(100);
  });
});
