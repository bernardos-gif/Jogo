import { describe, expect, it, beforeAll } from 'vitest';
import * as THREE from 'three';
import { Physics, initPhysics } from '../../src/physics/physics';
import { Soldier } from '../../src/player/soldier';
import { attachBody, stepMovement, teleport, type MovementContext } from '../../src/player/movement';
import { Interactives } from '../../src/world/interactives';
import { TUNING } from '../../src/config/tuning';

const DT = 1 / 60;

function makeWorld(): { physics: Physics; ctx: MovementContext; inter: Interactives } {
  const physics = new Physics();
  // Flat ground slab.
  physics.addStaticBox(new THREE.Vector3(0, -0.5, 0), new THREE.Vector3(200, 0.5, 200));
  const inter = new Interactives();
  const ctx: MovementContext = {
    physics,
    interactives: inter,
    time: 0,
    groundHeight: () => 0,
    hasWingsuit: () => false,
    onLand: () => undefined,
    onOutOfBounds: () => undefined,
    speedMul: () => 1,
    aiming: () => false,
  };
  return { physics, ctx, inter };
}

function spawn(physics: Physics, at = new THREE.Vector3(0, 0, 0)): Soldier {
  const s = new Soldier(1, 'T', 0, 'assault', 'varga', 'tern', 'frag');
  s.pos.copy(at);
  attachBody(s, physics);
  teleport(s, at);
  return s;
}

function run(s: Soldier, physics: Physics, ctx: MovementContext, seconds: number, each?: (t: number) => void): void {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    each?.(i * DT);
    ctx.time += DT;
    stepMovement(s, DT, ctx);
    physics.step();
    s.input.jump = false;
    s.input.crouch = false;
    s.input.prone = false;
    s.input.interact = false;
    s.input.tacSprint = false;
  }
}

describe('soldier movement', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it('walks at walk speed and sprints faster', () => {
    const { physics, ctx } = makeWorld();
    const s = spawn(physics);
    s.input.moveZ = 1;
    run(s, physics, ctx, 1.5);
    const walk = Math.hypot(s.vel.x, s.vel.z);
    expect(walk).toBeGreaterThan(TUNING.movement.walkSpeed * 0.9);
    expect(walk).toBeLessThan(TUNING.movement.walkSpeed * 1.1);
    s.input.sprint = true;
    run(s, physics, ctx, 1.5);
    expect(Math.hypot(s.vel.x, s.vel.z)).toBeGreaterThan(TUNING.movement.sprintSpeed * 0.9);
    // Facing yaw 0 moves north (-Z).
    expect(s.pos.z).toBeLessThan(-5);
  });

  it('jumps and lands back on the ground', () => {
    const { physics, ctx } = makeWorld();
    const s = spawn(physics);
    run(s, physics, ctx, 0.3);
    s.input.jump = true;
    let peak = 0;
    run(s, physics, ctx, 1.5, () => (peak = Math.max(peak, s.pos.y)));
    expect(peak).toBeGreaterThan(0.6);
    expect(s.state).toBe('ground');
    expect(Math.abs(s.pos.y)).toBeLessThan(0.1);
  });

  it('mantles onto a chest-high ledge', () => {
    const { physics, ctx } = makeWorld();
    physics.addStaticBox(new THREE.Vector3(0, 0.8, -3), new THREE.Vector3(3, 0.8, 1));
    const s = spawn(physics);
    run(s, physics, ctx, 0.2);
    s.input.moveZ = 1;
    run(s, physics, ctx, 0.8);
    s.input.jump = true;
    s.input.moveZ = 0;
    run(s, physics, ctx, 1.2);
    expect(s.pos.y).toBeGreaterThan(1.5);
    expect(s.state).toBe('ground');
  });

  it('vaults a low wall while sprinting', () => {
    const { physics, ctx } = makeWorld();
    physics.addStaticBox(new THREE.Vector3(0, 0.45, -6), new THREE.Vector3(3, 0.45, 0.3));
    const s = spawn(physics);
    run(s, physics, ctx, 0.2);
    s.input.moveZ = 1;
    s.input.sprint = true;
    let vaulted = false;
    let landedBeyond = false;
    run(s, physics, ctx, 3, () => {
      if (s.state === 'mantle') vaulted = true;
      if (vaulted && s.state === 'ground' && s.pos.z < -6.4 && s.pos.y < 0.3) landedBeyond = true;
      if (!vaulted && s.pos.z < -4.4 && s.state === 'ground') s.input.jump = true;
    });
    expect(vaulted).toBe(true);
    expect(landedBeyond).toBe(true);
  });

  it('crouches, slides from a sprint and goes prone', () => {
    const { physics, ctx } = makeWorld();
    const s = spawn(physics);
    run(s, physics, ctx, 0.2);
    s.input.moveZ = 1;
    s.input.sprint = true;
    run(s, physics, ctx, 1.2);
    s.input.crouch = true;
    run(s, physics, ctx, 0.05);
    expect(s.state).toBe('slide');
    s.input.sprint = false;
    s.input.moveZ = 0;
    run(s, physics, ctx, 1.5);
    expect(s.state).toBe('ground');
    expect(s.stance).toBe('crouch');
    s.input.prone = true;
    run(s, physics, ctx, 0.1);
    expect(s.stance).toBe('prone');
  });

  it('climbs a ladder to the top', () => {
    const { physics, ctx, inter } = makeWorld();
    physics.addStaticBox(new THREE.Vector3(0, 4, -3), new THREE.Vector3(2, 4, 1));
    inter.ladders.push({ id: 1, base: new THREE.Vector3(0, 0, -1.5), top: new THREE.Vector3(0, 8, -1.5), yaw: 0, exit: new THREE.Vector3(0, 8.05, -2.6) });
    const s = spawn(physics, new THREE.Vector3(0, 0, -1.4));
    run(s, physics, ctx, 0.2);
    s.input.moveZ = 1;
    let peak = 0;
    let climbed = false;
    run(s, physics, ctx, 4, () => {
      if (s.state === 'ladder') climbed = true;
      if (climbed && s.state === 'ground') s.input.moveZ = 0;
      peak = Math.max(peak, s.pos.y);
    });
    expect(climbed).toBe(true);
    expect(peak).toBeGreaterThan(7.9);
    expect(s.pos.y).toBeGreaterThan(7.9);
  });

  it('rides a zipline downhill', () => {
    const { physics, ctx, inter } = makeWorld();
    inter.ziplines.push({ id: 1, a: new THREE.Vector3(0, 2.5, 0), b: new THREE.Vector3(0, 1.0, -60) });
    const s = spawn(physics, new THREE.Vector3(0, 0, -1));
    run(s, physics, ctx, 0.2);
    s.input.interact = true;
    run(s, physics, ctx, 0.05);
    expect(s.state).toBe('zipline');
    run(s, physics, ctx, 3);
    expect(s.pos.z).toBeLessThan(-25);
  });
});
