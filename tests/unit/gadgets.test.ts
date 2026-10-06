import { describe, expect, it, beforeAll } from 'vitest';
import * as THREE from 'three';
import { Physics, initPhysics } from '../../src/physics/physics';
import { CollisionWorld } from '../../src/physics/collision';
import { Soldier } from '../../src/player/soldier';
import { attachBody, teleport } from '../../src/player/movement';
import { Arsenal } from '../../src/weapons/arsenal';
import { defaultAttachments } from '../../src/art/weaponModels';
import { SoldierTargets } from '../../src/weapons/hitboxes';
import { GadgetSystem, type GadgetContext } from '../../src/gadgets/system';
import { EventBus } from '../../src/core/events';
import { Rng } from '../../src/core/rng';
import { TUNING } from '../../src/config/tuning';
import type { SpecialistId } from '../../src/config/content';

const GT = TUNING.gadgets;
const DT = 1 / 60;

function setup() {
  const physics = new Physics();
  physics.addStaticBox(new THREE.Vector3(0, -0.5, 0), new THREE.Vector3(80, 0.5, 80));
  const collision = new CollisionWorld();
  const soldiers: Soldier[] = [];
  collision.targets.push(new SoldierTargets(() => soldiers, () => true));
  const events = new EventBus();
  const scene = new THREE.Scene();
  const vfxStub = new Proxy({}, { get: () => () => undefined });
  const gadgets = new GadgetSystem(scene);
  let nextId = 1;
  const mk = (team: 0 | 1, spec: SpecialistId, x: number, z = 0) => {
    const cls = spec === 'adeyemi' || spec === 'lindqvist' ? 'support' : spec === 'halloran' || spec === 'petrova' ? 'engineer' : spec === 'tanaka' || spec === 'rousseau' ? 'recon' : 'assault';
    const s = new Soldier(nextId++, `S${nextId}`, team, cls, spec, 'tern', 'frag');
    s.arsenal = new Arsenal('tern', defaultAttachments, 'frag');
    attachBody(s, physics);
    teleport(s, new THREE.Vector3(x, 0, z));
    gadgets.equip(s);
    soldiers.push(s);
    return s;
  };
  const ctx = {
    time: 0,
    soldiers,
    events,
    physics,
    collision,
    vfx: vfxStub,
    rng: new Rng(3),
    projectiles: { spawn: () => null },
    player: null,
    scene,
    soldierById: (id: number) => soldiers.find((s) => s.id === id),
    onExplosion: () => undefined,
    damageObject: () => false,
    smokeBlocks: () => false,
    isMedic: (s: Soldier) => s.cls === 'support',
    fastReviver: () => false,
    explosiveResist: () => 1,
    groundHeight: () => 0,
    spot: (by: Soldier, t: Soldier) => {
      t.spottedUntil = ctx.time + 5;
      t.spottedByTeam = by.team;
    },
    muzzle: (s: Soldier, out: THREE.Vector3) => out.copy(s.eyePos),
  } as unknown as GadgetContext;
  const run = (seconds: number) => {
    for (let t = 0; t < seconds; t += DT) {
      (ctx as { time: number }).time += DT;
      for (const s of soldiers) gadgets.stepSoldier(s, DT, ctx);
      gadgets.step(DT, ctx);
      for (const s of soldiers) {
        s.input.gadget = false;
      }
    }
  };
  return { gadgets, ctx, mk, run, soldiers };
}

describe('gadgets', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it('every specialist gets their gadget; Plated starts with an armor plate', () => {
    const { mk } = setup();
    expect(mk(0, 'varga', 0).gadget!.id).toBe('grapple');
    expect(mk(0, 'adeyemi', 2).gadget!.charges).toBe(GT.mender.charges);
    const ok = mk(0, 'okonjo', 4);
    expect(ok.gadget!.id).toBe('shield');
    expect(ok.armor).toBe(GT.passives.platedArmor);
  });

  it('a Mender dart heals the ally it hits', () => {
    const { mk, run } = setup();
    const medic = mk(0, 'adeyemi', 0, 0);
    const ally = mk(0, 'varga', 0, -8);
    ally.health = 40;
    medic.yaw = 0;
    medic.pitch = Math.atan2(1.1 - medic.eye, 8);
    medic.input.gadgetHeld = true;
    run(0.1);
    medic.input.gadgetHeld = false;
    run(0.5);
    expect(ally.health).toBeGreaterThanOrEqual(40 + GT.mender.heal - 1);
    expect(medic.gadget!.charges).toBe(GT.mender.charges - 1);
  });

  it('holding the Mender heals yourself', () => {
    const { mk, run } = setup();
    const medic = mk(0, 'adeyemi', 0);
    medic.health = 30;
    medic.input.gadgetHeld = true;
    run(GT.mender.selfHold + 0.1);
    medic.input.gadgetHeld = false;
    run(0.1);
    expect(medic.health).toBeGreaterThanOrEqual(30 + GT.mender.selfHeal - 1);
  });

  it('a supply cache refills reserve ammo, throwables and armor for teammates nearby', () => {
    const { mk, run, gadgets } = setup();
    const sup = mk(0, 'lindqvist', 0);
    const mate = mk(0, 'varga', 1.5);
    const w = mate.arsenal.slots[0];
    w.reserve = 0;
    mate.arsenal.throwables = 0;
    sup.input.gadget = true;
    run(GT.cache.throwableEvery + 0.2);
    expect(gadgets.caches.length).toBe(1);
    expect(w.reserve).toBeGreaterThan(0);
    expect(mate.arsenal.throwables).toBeGreaterThan(0);
    expect(mate.armor).toBeGreaterThan(0);
  });

  it('an EMP disables enemy deployables and gadgets in range', () => {
    const { mk, run, gadgets, ctx } = setup();
    const eng = mk(0, 'halloran', 0);
    eng.input.gadget = true;
    run(0.05);
    expect(gadgets.sentries.length).toBe(1);
    gadgets.emp(new THREE.Vector3(0, 0, -2), 10, ctx, 1);
    expect(gadgets.sentries[0].disabledT).toBeGreaterThan(0);
    expect(eng.gadget!.disabledT).toBeGreaterThan(0);
  });

  it('deployables expire and start the cooldown', () => {
    const { mk, run, gadgets } = setup();
    const ok = mk(0, 'okonjo', 0);
    ok.input.gadget = true;
    run(0.05);
    expect(gadgets.walls.length).toBe(1);
    run(GT.shield.life + 0.2);
    expect(gadgets.walls.length).toBe(0);
    expect(ok.gadget!.cooldown).toBeGreaterThan(GT.shield.cooldown - 1);
  });
});
