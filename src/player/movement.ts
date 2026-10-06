// Soldier movement: one state machine for players and bots. Ground (walk, sprint, tactical
// sprint, crouch, prone), slide, air (jump, fall), mantle and vault, ladders, ziplines,
// parachute, wingsuit, grapple pull, elevators, fall damage and the map boundary.
import * as THREE from 'three';
import { TUNING } from '../config/tuning';
import { approach, clamp, damp } from '../core/math';
import { G, groups, SOLDIER_FILTER, type Physics } from '../physics/physics';
import type { Interactives } from '../world/interactives';
import type { Soldier, Stance } from './soldier';

const M = TUNING.movement;

export interface MovementContext {
  physics: Physics;
  interactives: Interactives;
  time: number;
  groundHeight(x: number, z: number): number;
  hasWingsuit(s: Soldier): boolean;
  /** Called on landing with the impact speed (positive, m/s). */
  onLand(s: Soldier, impactSpeed: number): void;
  onOutOfBounds(s: Soldier, secondsLeft: number): void;
  /** Weapon-dependent speed multiplier (ADS, heavy weapons). */
  speedMul(s: Soldier): number;
  /** True while the soldier is aiming down sights (blocks sprint). */
  aiming(s: Soldier): boolean;
}

const _desired = { x: 0, y: 0, z: 0 };
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _wish = new THREE.Vector3();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _center = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);
const CC_GROUPS = groups(G.SOLDIER, SOLDIER_FILTER);
/** Per-tick downward nudge while grounded (larger pushes let the capsule sink into the ground). */
const GROUND_PUSH = -0.005;
const PROBE_GROUPS = groups(G.SOLDIER, G.STATIC | G.DESTRUCT | G.VEHICLE);

export function halfHeightFor(stance: Stance): number {
  return stance === 'stand' ? M.standHalfHeight : stance === 'crouch' ? M.crouchHalfHeight : M.proneHalfHeight;
}

export function eyeFor(stance: Stance): number {
  return stance === 'stand' ? M.eyeStand : stance === 'crouch' ? M.eyeCrouch : M.eyeProne;
}

/** Creates the physics capsule for a soldier at its current feet position. */
export function attachBody(s: Soldier, physics: Physics): void {
  s.halfHeight = halfHeightFor(s.stance);
  const { body, collider } = physics.createSoldierBody(s.pos, s.halfHeight, M.capsuleRadius);
  s.body = body;
  s.collider = collider;
}

export function detachBody(s: Soldier, physics: Physics): void {
  if (s.body) physics.world.removeRigidBody(s.body);
  s.body = null;
  s.collider = null;
}

/** Teleports a soldier (spawn, vehicle exit). */
export function teleport(s: Soldier, p: THREE.Vector3): void {
  s.pos.copy(p);
  s.prevPos.copy(p);
  s.vel.set(0, 0, 0);
  if (s.body) {
    const c = centerOf(s, _center);
    s.body.setTranslation({ x: c.x, y: c.y, z: c.z }, true);
    s.body.setNextKinematicTranslation({ x: c.x, y: c.y, z: c.z });
  }
}

function centerOf(s: Soldier, out: THREE.Vector3): THREE.Vector3 {
  return out.set(s.pos.x, s.pos.y + s.halfHeight + M.capsuleRadius, s.pos.z);
}

/** Changes stance if there is room; returns success. */
export function setStance(s: Soldier, stance: Stance, physics: Physics): boolean {
  if (s.stance === stance) return true;
  const hh = halfHeightFor(stance);
  if (hh > s.halfHeight && s.collider) {
    _center.set(s.pos.x, s.pos.y + hh + M.capsuleRadius + 0.02, s.pos.z);
    if (physics.capsuleBlocked(_center, hh, M.capsuleRadius - 0.04, s.collider)) return false;
  }
  s.stance = stance;
  s.halfHeight = hh;
  if (s.collider) {
    (s.collider as unknown as { setHalfHeight(h: number): void }).setHalfHeight(hh);
    const c = centerOf(s, _center);
    s.body?.setNextKinematicTranslation({ x: c.x, y: c.y, z: c.z });
  }
  return true;
}

/** Moves the capsule by `delta` with collision; updates pos, grounded. Returns the actual movement. */
function moveCollide(s: Soldier, physics: Physics, dx: number, dy: number, dz: number, out: THREE.Vector3): THREE.Vector3 {
  if (!s.collider || !s.body) {
    s.pos.x += dx;
    s.pos.y += dy;
    s.pos.z += dz;
    return out.set(dx, dy, dz);
  }
  _desired.x = dx;
  _desired.y = dy;
  _desired.z = dz;
  physics.cc.computeColliderMovement(s.collider, _desired, undefined, CC_GROUPS);
  const mv = physics.cc.computedMovement();
  s.grounded = physics.cc.computedGrounded();
  const t = s.body.translation();
  s.body.setNextKinematicTranslation({ x: t.x + mv.x, y: t.y + mv.y, z: t.z + mv.z });
  s.pos.set(t.x + mv.x, t.y + mv.y - s.halfHeight - M.capsuleRadius, t.z + mv.z);
  return out.set(mv.x, mv.y, mv.z);
}

/** Places the capsule exactly at the soldier's feet position (scripted states). */
function syncBody(s: Soldier): void {
  if (!s.body) return;
  const c = centerOf(s, _center);
  s.body.setNextKinematicTranslation({ x: c.x, y: c.y, z: c.z });
}

export function stepMovement(s: Soldier, dt: number, ctx: MovementContext): void {
  const inp = s.input;
  s.prevPos.copy(s.pos);
  s.prevYaw = s.yaw;
  s.prevPitch = s.pitch;
  if (s.state !== 'dead' && s.state !== 'downed') {
    s.yaw = inp.yaw;
    s.pitch = clamp(inp.pitch, -TUNING.camera.pitchLimit, TUNING.camera.pitchLimit);
  }
  s.jumpCooldown = Math.max(0, s.jumpCooldown - dt);
  s.slideCooldown = Math.max(0, s.slideCooldown - dt);
  s.tacCooldown = Math.max(0, s.tacCooldown - dt);
  s.landKick = Math.max(0, s.landKick - dt * 4);
  // Eye height follows the stance.
  const eyeTarget = s.state === 'slide' ? M.eyeCrouch * 0.9 : s.state === 'zipline' || s.state === 'ladder' ? M.eyeStand : eyeFor(s.stance);
  s.eye += (eyeTarget - s.eye) * damp(M.stanceBlendRate, dt);

  switch (s.state) {
    case 'ground':
      groundMove(s, dt, ctx);
      break;
    case 'air':
      airMove(s, dt, ctx);
      break;
    case 'slide':
      slideMove(s, dt, ctx);
      break;
    case 'mantle':
      mantleMove(s, dt);
      break;
    case 'ladder':
      ladderMove(s, dt, ctx);
      break;
    case 'zipline':
      ziplineMove(s, dt, ctx);
      break;
    case 'parachute':
    case 'wingsuit':
      chuteMove(s, dt, ctx);
      break;
    case 'grapple':
      grappleMove(s, dt, ctx);
      break;
    case 'downed':
    case 'dead':
      deadMove(s, dt, ctx);
      break;
    case 'vehicle':
      break;
  }
  boundary(s, dt, ctx);
}

// ------------------------------------------------------------------------------------------------
function wishDir(s: Soldier, out: THREE.Vector3): number {
  const inp = s.input;
  _fwd.set(-Math.sin(s.yaw), 0, -Math.cos(s.yaw));
  _right.set(Math.cos(s.yaw), 0, -Math.sin(s.yaw));
  out.set(0, 0, 0).addScaledVector(_fwd, inp.moveZ).addScaledVector(_right, inp.moveX);
  const len = out.length();
  if (len > 1) out.multiplyScalar(1 / len);
  return Math.min(1, len);
}

function targetSpeed(s: Soldier, ctx: MovementContext): number {
  const inp = s.input;
  let speed: number;
  if (s.stance === 'prone') speed = M.proneSpeed;
  else if (s.stance === 'crouch') speed = M.crouchSpeed;
  else if (s.tacSprint) speed = M.tacSprintSpeed;
  else if (s.sprinting) speed = M.sprintSpeed;
  else speed = M.walkSpeed;
  if (!s.sprinting && !s.tacSprint) {
    if (inp.moveZ < -0.1) speed *= M.backwardMul;
    else if (Math.abs(inp.moveX) > 0.5 && inp.moveZ < 0.5) speed *= M.strafeMul;
  }
  if (ctx.aiming(s)) speed *= M.adsSpeedMul;
  return speed * ctx.speedMul(s);
}

function groundMove(s: Soldier, dt: number, ctx: MovementContext): void {
  const inp = s.input;
  const physics = ctx.physics;
  // Stance toggles.
  if (inp.prone) setStance(s, s.stance === 'prone' ? 'stand' : 'prone', physics);
  if (inp.crouch) {
    const speed = Math.hypot(s.vel.x, s.vel.z);
    if ((s.sprinting || s.tacSprint) && speed > M.slideMinSpeed && s.slideCooldown <= 0 && s.stance === 'stand') {
      startSlide(s, physics);
      return;
    }
    setStance(s, s.stance === 'crouch' ? 'stand' : 'crouch', physics);
  }
  // Sprint: hold to sprint (forward only); double-tap for tactical sprint.
  const forward = inp.moveZ > 0.3;
  if (inp.tacSprint && s.tacCooldown <= 0 && forward) {
    s.tacSprint = true;
    s.tacSprintT = 0;
  }
  const wantsSprint = (inp.sprint || s.tacSprint) && forward && !ctx.aiming(s);
  if (wantsSprint && s.stance !== 'stand') setStance(s, 'stand', physics);
  s.sprinting = wantsSprint && s.stance === 'stand';
  if (s.tacSprint) {
    s.tacSprintT += dt;
    if (!s.sprinting || !inp.sprint || s.tacSprintT > M.tacSprintMax) {
      if (s.tacSprintT > M.tacSprintMax) s.tacCooldown = M.tacSprintCooldown;
      s.tacSprint = false;
    }
  }

  const amount = wishDir(s, _wish);
  const speed = targetSpeed(s, ctx);
  // Accelerate toward wish velocity; friction when idle.
  const tx = _wish.x * speed * amount, tz = _wish.z * speed * amount;
  const accel = (amount > 0.05 ? M.groundAccel : M.groundFriction * Math.max(1, Math.hypot(s.vel.x, s.vel.z))) * dt;
  const dx = tx - s.vel.x, dz = tz - s.vel.z;
  const dl = Math.hypot(dx, dz);
  if (dl > 1e-5) {
    const k = Math.min(1, accel / dl);
    s.vel.x += dx * k;
    s.vel.z += dz * k;
  }
  // Elevator ride.
  s.elevator = ctx.interactives.elevatorUnder(s.pos);
  const lift = s.elevator ? s.elevator.delta : 0;
  s.vel.y = 0; // a tiny push keeps contact; snap-to-ground follows slopes and stairs
  // Ladder grab by walking into one.
  if (forward && tryLadder(s, ctx, false)) return;
  // Jump / mantle / vault.
  if (inp.jump && s.jumpCooldown <= 0) {
    if (tryMantle(s, ctx)) return;
    if (s.stance !== 'stand') {
      setStance(s, 'stand', physics);
    } else {
      s.vel.y = M.jumpVelocity;
      s.jumpCooldown = M.jumpCooldown;
      s.state = 'air';
      s.airT = 0;
      s.fallStartY = s.pos.y;
      s.minVy = 0;
      moveCollide(s, physics, s.vel.x * dt, s.vel.y * dt + lift, s.vel.z * dt, _v);
      return;
    }
  }
  if (inp.interact && (tryLadder(s, ctx, true) || tryZipline(s, ctx))) return;
  const before = _v2.copy(s.pos);
  moveCollide(s, physics, s.vel.x * dt, GROUND_PUSH + lift, s.vel.z * dt, _v);
  // Blocked horizontally: shed velocity into the wall.
  const movedX = (s.pos.x - before.x) / dt, movedZ = (s.pos.z - before.z) / dt;
  if (Math.abs(movedX) < Math.abs(s.vel.x) * 0.5) s.vel.x = movedX;
  if (Math.abs(movedZ) < Math.abs(s.vel.z) * 0.5) s.vel.z = movedZ;
  if (s.grounded) s.lastGroundedT = ctx.time;
  else if (ctx.time - s.lastGroundedT > M.coyoteTime) {
    s.state = 'air';
    s.airT = 0;
    s.fallStartY = s.pos.y;
    s.minVy = 0;
    s.vel.y = 0;
  }
}

function startSlide(s: Soldier, physics: Physics): void {
  if (!setStance(s, 'crouch', physics)) return;
  s.state = 'slide';
  s.slideT = 0;
  _fwd.set(s.vel.x, 0, s.vel.z).normalize();
  s.vel.x += _fwd.x * M.slideBoost;
  s.vel.z += _fwd.z * M.slideBoost;
  s.sprinting = false;
  s.tacSprint = false;
}

function slideMove(s: Soldier, dt: number, ctx: MovementContext): void {
  const inp = s.input;
  s.slideT += dt;
  // Friction, with a little steering.
  const sp = Math.hypot(s.vel.x, s.vel.z);
  const ns = Math.max(0, sp - M.slideFriction * dt);
  if (sp > 1e-4) {
    s.vel.x *= ns / sp;
    s.vel.z *= ns / sp;
  }
  wishDir(s, _wish);
  s.vel.x += _wish.x * 2 * dt;
  s.vel.z += _wish.z * 2 * dt;
  s.vel.y = 0;
  moveCollide(s, ctx.physics, s.vel.x * dt, GROUND_PUSH, s.vel.z * dt, _v);
  if (inp.jump) {
    setStance(s, 'stand', ctx.physics);
    s.vel.y = M.jumpVelocity * 0.9;
    s.state = 'air';
    s.airT = 0;
    s.fallStartY = s.pos.y;
    s.slideCooldown = M.slideCooldown;
    return;
  }
  if (s.slideT > M.slideDuration || ns < M.slideEndSpeed || inp.crouch) {
    s.state = 'ground';
    s.slideCooldown = M.slideCooldown;
  }
  if (!s.grounded) {
    s.state = 'air';
    s.airT = 0;
    s.fallStartY = s.pos.y;
    s.vel.y = 0;
  }
}

function airMove(s: Soldier, dt: number, ctx: MovementContext): void {
  const inp = s.input;
  s.airT += dt;
  const amount = wishDir(s, _wish);
  if (amount > 0.05) {
    const spd = Math.max(M.walkSpeed, Math.hypot(s.vel.x, s.vel.z));
    const tx = _wish.x * spd, tz = _wish.z * spd;
    s.vel.x += (tx - s.vel.x) * Math.min(1, M.airAccel * M.airControl * dt);
    s.vel.z += (tz - s.vel.z) * Math.min(1, M.airAccel * M.airControl * dt);
  }
  s.vel.y -= M.gravity * dt;
  s.minVy = Math.min(s.minVy, s.vel.y);
  // Mantle onto ledges while airborne (forward + jump held).
  if ((inp.jumpHeld || inp.moveZ > 0.5) && s.vel.y < 2 && tryMantle(s, ctx)) return;
  // Parachute / wingsuit.
  const height = s.pos.y - ctx.groundHeight(s.pos.x, s.pos.z);
  if (inp.jump && s.vel.y < M.parachuteDeploySpeed && height > M.parachuteMinHeight) {
    s.state = ctx.hasWingsuit(s) ? 'wingsuit' : 'parachute';
    return;
  }
  if (inp.interact && (tryLadder(s, ctx, true) || tryZipline(s, ctx))) return;
  const before = s.vel.y;
  moveCollide(s, ctx.physics, s.vel.x * dt, s.vel.y * dt, s.vel.z * dt, _v);
  if (_v.y > s.vel.y * dt + 1e-4 && s.vel.y > 0) s.vel.y = 0; // hit a ceiling
  if (s.grounded && before <= 0) land(s, ctx, -before);
}

function land(s: Soldier, ctx: MovementContext, impact: number): void {
  s.state = 'ground';
  s.lastGroundedT = ctx.time;
  s.landKick = clamp(impact / 20, 0, 1);
  s.vel.y = 0;
  ctx.onLand(s, impact);
}

function chuteMove(s: Soldier, dt: number, ctx: MovementContext): void {
  const inp = s.input;
  if (s.state === 'parachute') {
    s.vel.y = approach(s.vel.y, -M.parachuteFallSpeed, 30 * dt);
    const amount = wishDir(s, _wish);
    s.vel.x += (_wish.x * M.parachuteSpeed * amount - s.vel.x) * Math.min(1, M.parachuteAccel * dt);
    s.vel.z += (_wish.z * M.parachuteSpeed * amount - s.vel.z) * Math.min(1, M.parachuteAccel * dt);
    if (inp.crouch) {
      s.state = 'air';
      s.airT = 0;
      s.fallStartY = s.pos.y;
      s.minVy = s.vel.y;
      return;
    }
  } else {
    // Wingsuit: glide forward along the look direction; pitch trades height for speed.
    _fwd.set(-Math.sin(s.yaw), 0, -Math.cos(s.yaw));
    const dive = clamp(-s.pitch, -0.3, 1);
    const speed = M.wingsuitForward * (1 + dive * 0.35);
    s.vel.x += (_fwd.x * speed - s.vel.x) * Math.min(1, 2 * dt);
    s.vel.z += (_fwd.z * speed - s.vel.z) * Math.min(1, 2 * dt);
    s.vel.y = approach(s.vel.y, -M.wingsuitSink * (1 + dive * 1.5), 20 * dt);
    if (inp.jump && s.pos.y - ctx.groundHeight(s.pos.x, s.pos.z) > 4) {
      s.state = 'parachute';
      return;
    }
  }
  const before = s.vel.y;
  moveCollide(s, ctx.physics, s.vel.x * dt, s.vel.y * dt, s.vel.z * dt, _v);
  if (s.grounded) land(s, ctx, s.state === 'wingsuit' ? Math.min(-before, M.fallDamageMinSpeed - 1) : 0);
}

function grappleMove(s: Soldier, dt: number, ctx: MovementContext): void {
  _v2.subVectors(s.grapplePoint, s.pos).add(_v.set(0, 0.2, 0));
  const dist = _v2.length();
  const speed = TUNING.gadgets.grapple.pullSpeed;
  if (dist < 1.2 || s.input.jump) {
    s.state = 'air';
    s.airT = 0;
    s.fallStartY = s.pos.y;
    s.minVy = 0;
    s.vel.multiplyScalar(0.6);
    if (dist < 1.2) s.vel.y = Math.max(s.vel.y, M.jumpVelocity * 0.7);
    tryMantle(s, ctx);
    return;
  }
  _v2.multiplyScalar(1 / dist);
  s.vel.copy(_v2).multiplyScalar(speed);
  const before = _v.copy(s.pos);
  moveCollide(s, ctx.physics, s.vel.x * dt, s.vel.y * dt, s.vel.z * dt, _v2);
  if (s.pos.distanceTo(before) < speed * dt * 0.2) {
    // Snagged: drop off the line.
    s.state = 'air';
    s.airT = 0;
    s.fallStartY = s.pos.y;
    tryMantle(s, ctx);
  }
}

function deadMove(s: Soldier, dt: number, ctx: MovementContext): void {
  s.vel.x *= Math.max(0, 1 - 6 * dt);
  s.vel.z *= Math.max(0, 1 - 6 * dt);
  s.vel.y = s.grounded ? 0 : s.vel.y - M.gravity * dt;
  if (s.body) moveCollide(s, ctx.physics, s.vel.x * dt, s.grounded ? GROUND_PUSH : s.vel.y * dt, s.vel.z * dt, _v);
  else {
    const gy = ctx.groundHeight(s.pos.x, s.pos.z);
    s.pos.y = Math.max(gy, s.pos.y + s.vel.y * dt);
    s.grounded = s.pos.y <= gy + 0.01;
  }
}

// ------------------------------------------------------------------------------------------------
// Mantle and vault
function tryMantle(s: Soldier, ctx: MovementContext): boolean {
  const physics = ctx.physics;
  _fwd.set(-Math.sin(s.yaw), 0, -Math.cos(s.yaw));
  // Wall ahead at knee and chest height; reach grows with speed so sprint vaults trigger early.
  const reach = M.mantleReach + Math.hypot(s.vel.x, s.vel.z) * M.mantleAnticipation;
  let wall = null;
  for (const h of [0.5, 1.1]) {
    _v.set(s.pos.x, s.pos.y + h, s.pos.z);
    wall = physics.ray(_v, _fwd, reach, PROBE_GROUPS, s.collider ?? undefined);
    if (wall) break;
  }
  if (!wall) return false;
  // Find the top surface just past the wall face.
  const top = s.pos.y + M.mantleMaxHeight + 0.4;
  _v.set(s.pos.x + _fwd.x * (wall.dist + 0.35), top, s.pos.z + _fwd.z * (wall.dist + 0.35));
  const down = physics.ray(_v, _down, M.mantleMaxHeight + 0.4, PROBE_GROUPS, s.collider ?? undefined);
  if (!down) return false;
  const topY = top - down.dist;
  const h = topY - s.pos.y;
  if (h < 0.35 || h > M.mantleMaxHeight || down.normal.y < 0.7) return false;
  // Room to stand on top.
  _center.set(_v.x, topY + M.standHalfHeight + M.capsuleRadius + 0.05, _v.z);
  if (physics.capsuleBlocked(_center, M.standHalfHeight, M.capsuleRadius - 0.05, s.collider ?? undefined)) {
    // Try crouched.
    _center.y = topY + M.crouchHalfHeight + M.capsuleRadius + 0.05;
    if (physics.capsuleBlocked(_center, M.crouchHalfHeight, M.capsuleRadius - 0.05, s.collider ?? undefined)) return false;
    setStance(s, 'crouch', physics);
  }
  s.moveFrom.copy(s.pos);
  s.moveTo.set(_v.x, topY + 0.02, _v.z);
  s.moveDur = M.mantleTime;
  // Vault over low obstacles while moving fast: land on the far side if there is ground.
  const speed = Math.hypot(s.vel.x, s.vel.z);
  if (h <= M.vaultMaxHeight && speed > M.walkSpeed * 0.8) {
    _v2.set(s.pos.x + _fwd.x * (wall.dist + 1.6), topY + 0.5, s.pos.z + _fwd.z * (wall.dist + 1.6));
    const far = physics.ray(_v2, _down, 3.5, PROBE_GROUPS, s.collider ?? undefined);
    if (far && far.dist > 0.6) {
      s.moveTo.set(_v2.x, _v2.y - far.dist + 0.02, _v2.z);
      s.moveDur = M.vaultTime;
    }
  }
  s.state = 'mantle';
  s.moveT = 0;
  s.sprinting = false;
  s.tacSprint = false;
  return true;
}

function mantleMove(s: Soldier, dt: number): void {
  s.moveT += dt;
  const k = clamp(s.moveT / s.moveDur, 0, 1);
  const up = clamp(k * 1.8, 0, 1);
  const across = clamp((k - 0.25) / 0.75, 0, 1);
  const peak = Math.max(s.moveFrom.y, s.moveTo.y) + 0.15;
  s.pos.x = s.moveFrom.x + (s.moveTo.x - s.moveFrom.x) * across;
  s.pos.z = s.moveFrom.z + (s.moveTo.z - s.moveFrom.z) * across;
  s.pos.y = k < 0.6 ? s.moveFrom.y + (peak - s.moveFrom.y) * (1 - (1 - up) * (1 - up)) : peak + (s.moveTo.y - peak) * ((k - 0.6) / 0.4);
  syncBody(s);
  if (k >= 1) {
    s.state = 'ground';
    s.vel.set(((s.moveTo.x - s.moveFrom.x) / s.moveDur) * 0.4, 0, ((s.moveTo.z - s.moveFrom.z) / s.moveDur) * 0.4);
    s.grounded = true;
  }
}

// ------------------------------------------------------------------------------------------------
// Ladders and ziplines
function tryLadder(s: Soldier, ctx: MovementContext, explicit: boolean): boolean {
  const l = ctx.interactives.nearestLadder(s.pos, M.ladderGrabRange);
  if (!l) return false;
  if (!explicit) {
    // Walking into it while facing it.
    const facing = Math.cos(s.yaw - l.yaw);
    if (facing < 0.6) return false;
    if (Math.hypot(s.pos.x - l.base.x, s.pos.z - l.base.z) > 0.8) return false;
  }
  if (s.pos.y > l.top.y - 0.3) return false;
  setStance(s, 'stand', ctx.physics);
  s.state = 'ladder';
  s.ladder = l;
  s.vel.set(0, 0, 0);
  s.sprinting = false;
  s.tacSprint = false;
  return true;
}

function ladderMove(s: Soldier, dt: number, ctx: MovementContext): void {
  const l = s.ladder!;
  const inp = s.input;
  s.pos.x += (l.base.x - s.pos.x) * Math.min(1, 12 * dt);
  s.pos.z += (l.base.z - s.pos.z) * Math.min(1, 12 * dt);
  const climb = inp.moveZ * M.ladderSpeed * (inp.sprint ? 1.4 : 1);
  s.vel.set(0, climb, 0);
  s.pos.y += climb * dt;
  if (s.pos.y >= l.top.y) {
    s.state = 'ground';
    s.pos.copy(l.exit);
    s.ladder = null;
    s.vel.set(-Math.sin(l.yaw) * M.ladderExitBoost, 0, -Math.cos(l.yaw) * M.ladderExitBoost);
  } else if (s.pos.y <= l.base.y && inp.moveZ < 0) {
    s.state = 'ground';
    s.pos.y = l.base.y;
    s.ladder = null;
  } else if (inp.jump) {
    s.state = 'air';
    s.airT = 0;
    s.fallStartY = s.pos.y;
    s.minVy = 0;
    s.vel.set(Math.sin(l.yaw) * 3, 2, Math.cos(l.yaw) * 3);
    s.ladder = null;
  }
  syncBody(s);
  void ctx;
}

function tryZipline(s: Soldier, ctx: MovementContext): boolean {
  const z = ctx.interactives.nearestZipline(s.pos, M.ziplineGrabRange);
  if (!z) return false;
  _v.subVectors(z.line.b, z.line.a);
  _fwd.set(-Math.sin(s.yaw), 0, -Math.cos(s.yaw));
  s.zipline = z.line;
  s.zipT = z.t;
  s.zipDir = _v.dot(_fwd) >= 0 ? 1 : -1;
  s.zipSpeed = Math.max(4, Math.hypot(s.vel.x, s.vel.z));
  s.state = 'zipline';
  setStance(s, 'stand', ctx.physics);
  return true;
}

function ziplineMove(s: Soldier, dt: number, ctx: MovementContext): void {
  const z = s.zipline!;
  _v.subVectors(z.b, z.a);
  const len = _v.length();
  s.zipSpeed = approach(s.zipSpeed, M.ziplineSpeed, M.ziplineAccel * dt);
  s.zipT += (s.zipDir * s.zipSpeed * dt) / len;
  const done = s.zipT <= 0.01 || s.zipT >= 0.99;
  s.zipT = clamp(s.zipT, 0, 1);
  _v2.copy(z.a).addScaledVector(_v, s.zipT);
  const prev = _center.copy(s.pos);
  s.pos.set(_v2.x, _v2.y - 1.95, _v2.z);
  s.vel.subVectors(s.pos, prev).multiplyScalar(1 / dt);
  syncBody(s);
  if (done || s.input.jump || s.input.crouch) {
    s.state = 'air';
    s.airT = 0;
    s.fallStartY = s.pos.y;
    s.minVy = 0;
    s.zipline = null;
    if (s.input.jump) s.vel.y = M.jumpVelocity * 0.6;
  }
  void ctx;
}

// ------------------------------------------------------------------------------------------------
function boundary(s: Soldier, dt: number, ctx: MovementContext): void {
  if (s.state === 'dead') return;
  const lim = M.mapLimit;
  const out = Math.abs(s.pos.x) > lim || Math.abs(s.pos.z) > lim;
  if (out) {
    s.outOfBoundsT += dt;
    ctx.onOutOfBounds(s, M.outOfBoundsSeconds - s.outOfBoundsT);
  } else s.outOfBoundsT = 0;
  // Hard wall well past the limit.
  const hard = lim + 40;
  if (Math.abs(s.pos.x) > hard || Math.abs(s.pos.z) > hard) {
    s.pos.x = clamp(s.pos.x, -hard, hard);
    s.pos.z = clamp(s.pos.z, -hard, hard);
    syncBody(s);
  }
}

/** Interpolated position for rendering. */
export function renderPos(s: Soldier, alpha: number, out: THREE.Vector3): THREE.Vector3 {
  return out.copy(s.prevPos).lerp(s.pos, alpha);
}
