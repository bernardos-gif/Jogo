import { describe, expect, it, beforeAll } from 'vitest';
import * as THREE from 'three';
import { Physics, initPhysics } from '../../src/physics/physics';
import { CollisionWorld } from '../../src/physics/collision';
import { Soldier } from '../../src/player/soldier';
import { attachBody, teleport } from '../../src/player/movement';
import { Arsenal } from '../../src/weapons/arsenal';
import { defaultAttachments } from '../../src/art/weaponModels';
import { VehicleSystem, type VehicleContext } from '../../src/vehicles/system';
import { SEAT_MOUNTS, SEAT_EXPOSED } from '../../src/vehicles/vehicle';
import { steerToward, throttleFor, orbitPoint } from '../../src/ai/vehicleCrew';
import { EventBus } from '../../src/core/events';
import { Rng } from '../../src/core/rng';
import { TUNING } from '../../src/config/tuning';
import { VEHICLES, type VehicleKind } from '../../src/config/content';

const V = TUNING.vehicles;
const DT = 1 / 60;

function setup() {
  const physics = new Physics();
  physics.addStaticBox(new THREE.Vector3(0, -0.5, 0), new THREE.Vector3(400, 0.5, 400));
  const collision = new CollisionWorld();
  const soldiers: Soldier[] = [];
  const events = new EventBus();
  const scene = new THREE.Scene();
  const vfx = new Proxy({}, { get: () => () => undefined });
  const vehicles = new VehicleSystem(scene);
  collision.targets.push(vehicles);
  const projectiles = { list: [] as { active: boolean; homing: unknown; pos: THREE.Vector3 }[], spawn: () => null };
  let nextId = 1;
  const ctx = {
    time: 0,
    soldiers,
    events,
    physics,
    collision,
    vfx,
    rng: new Rng(5),
    projectiles,
    player: null,
    scene,
    soldierById: (id: number) => soldiers.find((s) => s.id === id),
    onExplosion: () => undefined,
    damageObject: () => false,
    smokeBlocks: () => false,
    isMedic: () => false,
    fastReviver: () => false,
    explosiveResist: () => 1,
    groundHeight: () => 0,
  } as unknown as VehicleContext;
  const mk = (team: 0 | 1, x = 0, z = 0) => {
    const s = new Soldier(nextId++, `S${nextId}`, team, 'assault', 'varga', 'tern', 'frag');
    s.arsenal = new Arsenal('tern', defaultAttachments, 'frag');
    attachBody(s, physics);
    teleport(s, new THREE.Vector3(x, 0, z));
    soldiers.push(s);
    return s;
  };
  const spawn = (kind: VehicleKind, team: 0 | 1, x = 0, z = 0) => vehicles.spawn(kind, team, new THREE.Vector3(x, 0, z), 0, physics);
  const run = (seconds: number) => {
    for (let t = 0; t < seconds; t += DT) {
      (ctx as { time: number }).time += DT;
      vehicles.step(DT, ctx);
      physics.step();
      vehicles.postPhysics(DT, ctx);
    }
  };
  return { vehicles, ctx, mk, spawn, run, projectiles };
}

describe('vehicles', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it('seat tables agree for every vehicle', () => {
    for (const k of Object.keys(VEHICLES) as VehicleKind[]) {
      expect(SEAT_MOUNTS[k].length).toBe(VEHICLES[k].seats.length);
      expect(SEAT_EXPOSED[k].length).toBe(VEHICLES[k].seats.length);
    }
  });

  it('an empty hover vehicle settles at its hover height', () => {
    const { spawn, run } = setup();
    const v = spawn('wisp', 0);
    run(3);
    expect(v.pos.y).toBeGreaterThan(V.wisp.hoverHeight - 0.25);
    expect(v.pos.y).toBeLessThan(V.wisp.hoverHeight + 0.25);
    expect(v.grounded).toBe(true);
  });

  it('a driver drives forward and the top speed holds', () => {
    const { spawn, run, mk, vehicles } = setup();
    const v = spawn('wisp', 0);
    const d = mk(0, 3, 0);
    expect(vehicles.enter(d, v)).toBe(true);
    d.input.moveZ = 1;
    run(4);
    // Yaw 0 faces -Z.
    expect(v.pos.z).toBeLessThan(-40);
    expect(Math.hypot(v.vel.x, v.vel.z)).toBeLessThanOrEqual(V.wisp.maxSpeed + 0.5);
    // The driver rides along in the seat.
    expect(d.pos.distanceTo(v.pos)).toBeLessThan(3);
  });

  it('seats fill driver first, enclosed seats shield their occupant, exit frees the seat', () => {
    const { spawn, mk, vehicles, ctx } = setup();
    const v = spawn('basalt', 1);
    const a = mk(0, 6, 0);
    const b = mk(0, 6, 2);
    expect(vehicles.enter(a, v)).toBe(true);
    expect(a.seat).toBe(0);
    expect(v.team).toBe(0);
    expect(vehicles.enter(b, v)).toBe(true);
    expect(b.seat).toBe(1);
    expect(a.enclosed).toBe(true);
    expect(vehicles.exposed(a)).toBe(false);
    expect(vehicles.exit(b, ctx, true)).toBe(true);
    expect(v.seats[1]).toBeNull();
    expect(b.inVehicle).toBe(false);
    expect(b.enclosed).toBe(false);
    expect(vehicles.distToHull(v, b.pos)).toBeGreaterThan(0.2);
    // Enemies cannot board a crewed vehicle.
    const foe = mk(1, 5, 0);
    expect(vehicles.nearest(foe, 10)).toBeNull();
  });

  it('friendly fire does not hurt a crewed vehicle; explosions fall off with distance', () => {
    const { spawn, mk, vehicles, ctx } = setup();
    const v = spawn('basalt', 0);
    const crew = mk(0, 6, 0);
    vehicles.enter(crew, v);
    const mate = mk(0, 20, 0);
    vehicles.damageRef(v, 500, mate, ctx, v.pos.clone());
    expect(v.hp).toBe(v.maxHp);
    const foe = mk(1, 30, 0);
    const before = v.hp;
    vehicles.radiusDamage(v.pos.clone().add(new THREE.Vector3(0, 0, 5)), 8, 200, foe, ctx);
    const near = before - v.hp;
    vehicles.radiusDamage(v.pos.clone().add(new THREE.Vector3(0, 0, 9)), 8, 200, foe, ctx);
    const far = before - near - v.hp;
    expect(near).toBeGreaterThan(0);
    expect(far).toBeLessThan(near);
  });

  it('heavy hits can cripple a component, and the hull self-repairs only up to its floor', () => {
    const { spawn, vehicles, ctx, run } = setup();
    const v = spawn('wisp', 0);
    (ctx as { rng: { next(): number } }).rng = { next: () => 0 };
    vehicles.damage(v, v.maxHp * 0.6, null, ctx, true);
    expect(v.comps.engine + v.comps.weapons + v.comps.mobility).toBeLessThan(3);
    run(V.selfRepairDelay + 30);
    expect(v.hp).toBeGreaterThan(v.maxHp * 0.4);
    expect(v.hp).toBeLessThanOrEqual(v.maxHp * V.selfRepairTo + 1e-6);
  });

  it('destroying a vehicle kills its crew and leaves a wreck', () => {
    const { spawn, mk, vehicles, ctx } = setup();
    const v = spawn('wisp', 0);
    const a = mk(0, 3, 0);
    vehicles.enter(a, v);
    vehicles.damage(v, v.maxHp + 1, null, ctx, false);
    expect(v.alive).toBe(false);
    expect(a.alive && !a.downed).toBe(false);
    expect(a.inVehicle).toBe(false);
  });

  it('countermeasures break incoming homing rockets and use a charge', () => {
    const { spawn, mk, vehicles, run, projectiles } = setup();
    const v = spawn('basalt', 0);
    const d = mk(0, 6, 0);
    vehicles.enter(d, v);
    const rocket = { active: true, homing: { pos: () => v.pos }, pos: v.pos.clone().add(new THREE.Vector3(0, 0, 10)) };
    projectiles.list.push(rocket);
    d.input.fireMode = true;
    run(DT);
    expect(rocket.homing).toBeNull();
    expect(v.cm.charges).toBe(V.countermeasures.charges - 1);
  });

  it('launchers lock on to crewed enemy vehicles in the cone, not through countermeasures', () => {
    const { spawn, mk, vehicles } = setup();
    const v = spawn('basalt', 1, 0, -60);
    const crew = mk(1, 6, -60);
    vehicles.enter(crew, v);
    const s = mk(0, 0, 0);
    const eye = new THREE.Vector3(0, 1.6, 0);
    const pitch = Math.atan2(v.pos.y + v.model.centerY - 1.6, 60);
    expect(vehicles.lockCandidate(s, eye, 0, pitch)).not.toBeNull();
    expect(v.lockWarnT).toBeGreaterThan(0);
    expect(vehicles.lockCandidate(s, eye, Math.PI / 2, pitch)).toBeNull();
    v.cm.activeT = 1;
    expect(vehicles.lockCandidate(s, eye, 0, pitch)).toBeNull();
  });

  it('a pilot climbs and flies toward the look direction', () => {
    const { spawn, mk, vehicles, run } = setup();
    const v = spawn('midge', 0);
    const p = mk(0, 3, 0);
    vehicles.enter(p, v);
    p.input.jumpHeld = true;
    p.input.yaw = 0;
    run(3);
    expect(v.pos.y).toBeGreaterThan(8);
    p.input.jumpHeld = false;
    p.input.moveZ = 1;
    const z0 = v.pos.z;
    run(3);
    expect(v.pos.z).toBeLessThan(z0 - 30);
  });
});

describe('bot crews', () => {
  it('steers toward the target side (positive moveX turns right)', () => {
    // Facing -Z (yaw 0), a target ahead and to the east (+X) needs a right turn.
    const [steer] = steerToward(0, 10, -10);
    expect(steer).toBeGreaterThan(0);
    const [left] = steerToward(0, -10, -10);
    expect(left).toBeLessThan(0);
    const [, diff] = steerToward(0, 0, -10);
    expect(Math.abs(diff)).toBeLessThan(1e-9);
  });

  it('throttle eases off for sharp turns and on arrival', () => {
    expect(throttleFor(0, 500, 40)).toBe(1);
    expect(throttleFor(1.4, 500, 40)).toBeLessThan(0.5);
    expect(throttleFor(0, 20, 40)).toBeLessThan(0.5);
  });

  it('orbit points lie on the circle ahead of the aircraft', () => {
    const out = new THREE.Vector3();
    orbitPoint(100, 50, 300, 50, 120, 0.5, 1, out);
    expect(Math.hypot(out.x - 100, out.z - 50)).toBeCloseTo(120, 5);
    // Lead rotates from the current bearing (angle 0) by +0.5 rad.
    expect(Math.atan2(out.z - 50, out.x - 100)).toBeCloseTo(0.5, 5);
  });
});
