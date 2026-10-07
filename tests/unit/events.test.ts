import { describe, expect, it, beforeAll } from 'vitest';
import * as THREE from 'three';
import { Physics, initPhysics } from '../../src/physics/physics';
import { CollisionWorld } from '../../src/physics/collision';
import { Soldier } from '../../src/player/soldier';
import { attachBody, teleport, fling } from '../../src/player/movement';
import { Arsenal } from '../../src/weapons/arsenal';
import { defaultAttachments } from '../../src/art/weaponModels';
import { VehicleSystem } from '../../src/vehicles/system';
import { WorldEvents, type EventHost } from '../../src/world/events';
import { Rocket } from '../../src/world/rocket';
import { EventBus } from '../../src/core/events';
import { Rng } from '../../src/core/rng';
import { TUNING } from '../../src/config/tuning';

const S = TUNING.events.storm;
const L = TUNING.events.launch;
const DT = 1 / 60;

interface FakeDestructible {
  tag?: string;
  alive: boolean;
}

function setup(withRocket = true) {
  const physics = new Physics();
  physics.addStaticBox(new THREE.Vector3(0, -0.5, 0), new THREE.Vector3(700, 0.5, 700));
  const collision = new CollisionWorld();
  const scene = new THREE.Scene();
  const soldiers: Soldier[] = [];
  const events = new EventBus();
  const vehicles = new VehicleSystem(scene);
  const items: FakeDestructible[] = [0, 1, 2, 3].map(() => ({ tag: 'rocketFuel', alive: true }));
  const destructibles = {
    items,
    aliveWithTag: (t: string) => items.filter((d) => d.tag === t && d.alive).length,
    radiusDamage: () => undefined,
  };
  const rocket = withRocket ? new Rocket({ base: new THREE.Vector3(200, 0, 0), height: 40, radius: 2.5 }, physics, collision) : null;
  const announced: string[] = [];
  events.on('announce', (e) => announced.push(e.text));
  const host = {
    time: 0,
    soldiers,
    events,
    physics,
    collision,
    vfx: new Proxy({}, { get: () => () => undefined }),
    rng: new Rng(2),
    projectiles: { list: [], spawn: () => null },
    player: null,
    scene,
    vehicles,
    destructibles,
    rocket,
    soldierById: (id: number) => soldiers.find((s) => s.id === id),
    onExplosion: () => undefined,
    damageObject: () => false,
    smokeBlocks: () => false,
    isMedic: () => false,
    fastReviver: () => false,
    explosiveResist: () => 1,
    groundHeight: () => 0,
    stormTargets: () => [{ x: 0, z: 0 }],
    shakeAt: () => undefined,
  } as unknown as EventHost;
  let nextId = 1;
  const mk = (x: number, z: number) => {
    const s = new Soldier(nextId++, `S${nextId}`, 0, 'assault', 'varga', 'tern', 'frag');
    s.arsenal = new Arsenal('tern', defaultAttachments, 'frag');
    attachBody(s, physics);
    teleport(s, new THREE.Vector3(x, 0, z));
    soldiers.push(s);
    return s;
  };
  const world = new WorldEvents(host, false);
  const run = (seconds: number) => {
    for (let t = 0; t < seconds; t += DT) {
      (host as { time: number }).time += DT;
      world.update(DT);
    }
  };
  return { world, host, mk, run, items, rocket, announced };
}

describe('world events', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it('schedules the first storm inside its window and announces it', () => {
    const { world, run, announced } = setup();
    run(S.firstAt[0] - 1);
    expect(world.stormPhase).toBe('idle');
    run(S.firstAt[1] - S.firstAt[0] + 2);
    expect(world.storms).toBe(1);
    expect(['warn', 'active']).toContain(world.stormPhase);
    expect(announced).toContain('Ion storm forming');
    // The warning hazard carries a travel cone.
    const hz = world.hazards.find((h) => h.label === 'Ion storm')!;
    expect(hz.dir).toBeTypeOf('number');
    expect(hz.reach).toBeGreaterThan(0);
  });

  it('the storm pulls soldiers in and lifts those near the core', () => {
    const { world, run, mk } = setup(false);
    world.forceStorm();
    run(S.warnSeconds + 7);
    expect(world.stormPhase).toBe('active');
    const c = world.stormPos.clone();
    const near = mk(c.x + S.liftRadius * 0.4, c.z);
    const far = mk(c.x + S.pullRadius * 2, c.z);
    run(0.3);
    expect(near.state).toBe('air');
    expect(near.vel.y).toBeGreaterThan(0);
    // Pulled toward the center (negative x relative to the storm).
    expect(near.vel.x).toBeLessThan(0);
    expect(far.state).not.toBe('air');
  });

  it('fling lifts a grounded soldier and ignores ladders', () => {
    const { mk } = setup(false);
    const s = mk(0, 0);
    s.state = 'ground';
    fling(s, 1, 4, 0);
    expect(s.state).toBe('air');
    expect(s.vel.y).toBeGreaterThanOrEqual(4);
    const l = mk(5, 0);
    l.state = 'ladder';
    fling(l, 1, 4, 0);
    expect(l.state).toBe('ladder');
  });

  it('with the fuel farm intact the rocket ignites and climbs away', () => {
    const { world, run, rocket } = setup();
    world.forceLaunch();
    run(L.countdown + 1);
    expect(world.launchPhase).toBe('ignition');
    run(L.ignitionSeconds + 3);
    expect(world.launchPhase).toBe('ascent');
    expect(rocket!.lift).toBeGreaterThan(5);
    expect(world.launches).toBe(1);
  });

  it('with the fuel farm destroyed the rocket detonates and leaves rubble', () => {
    const { world, run, rocket, items, host } = setup();
    items[0].alive = false;
    items[1].alive = false;
    world.forceLaunch();
    run(DT);
    expect(world.timer()?.label).toBe('Detonation');
    const before = host.scene.children.length;
    run(L.countdown + 1);
    expect(world.launchPhase).toBe('detonated');
    expect(world.detonations).toBe(1);
    expect(rocket!.group.visible).toBe(false);
    expect(host.scene.children.length).toBeGreaterThan(before);
    // A new round puts the rocket back.
    world.reset();
    expect(rocket!.phase).toBe('pad');
    expect(rocket!.group.visible).toBe(true);
  });

  it('the day drifts from afternoon toward dusk over a round', () => {
    const { world, run } = setup(false);
    const d0 = world.dayT;
    run(60);
    expect(world.dayT).toBeGreaterThan(d0);
    expect(world.dayT).toBeLessThanOrEqual(TUNING.weather.dayEnd);
  });
});
