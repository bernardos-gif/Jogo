// Procedural soldier animation (code-driven, as in Elemental Brawl): gait, stances, sprint,
// slide, prone, air, ladder, zipline, parachute, wingsuit, seated, downed and dead poses, plus
// two-hand weapon holds solved with arm IK (reload, melee and throw motions on top).
import * as THREE from 'three';
import { Pose, J, JOINT_COUNT, evaluateFK, solveArmIK, SOLDIER_SCALE, BUILD } from './skeleton';
import { holdOffset, type WeaponAnchors } from './weaponModels';
import type { WeaponCategory } from '../config/content';
import { clamp, damp } from '../core/math';

export type BodyMode = 'normal' | 'sprint' | 'slide' | 'air' | 'ladder' | 'zipline' | 'parachute' | 'wingsuit' | 'downed' | 'dead' | 'seated' | 'mantle';

export interface AnimInput {
  pos: THREE.Vector3;
  yaw: number;
  pitch: number;
  vel: THREE.Vector3;
  crouch: boolean;
  prone: boolean;
  mode: BodyMode;
  weapon: { cat: WeaponCategory; anchors: WeaponAnchors } | null;
  /** -1 when idle, else 0..1 progress. */
  reload: number;
  melee: number;
  throwing: number;
  /** Recoil kick 0..1 (decays). */
  kick: number;
  deadT: number;
  /** Random per-soldier 0..1 used to vary death poses. */
  seed: number;
  /** Arms up holding handlebars or controls when seated without a weapon. */
  driving: boolean;
}

const _root = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _head = new THREE.Vector3();
const _right = new THREE.Vector3();
const _left = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _e = new THREE.Euler();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _off = new THREE.Vector3();
const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);
/** Third-person weapons are scaled up to match the chunky toy-figure hands. */
export const TP_WEAPON_SCALE = 1.35;

export class SoldierAnimator {
  readonly pose = new Pose();
  readonly mats: THREE.Matrix4[] = Array.from({ length: JOINT_COUNT }, () => new THREE.Matrix4());
  readonly out = new Float32Array(JOINT_COUNT * 16);
  readonly weaponMatrix = new THREE.Matrix4();
  readonly headPos = new THREE.Vector3();
  hasWeapon = false;
  private phase = 0;
  private k = { crouch: 0, prone: 0, sprint: 0, air: 0, slide: 0, move: 0 };
  private bob = 0;

  update(dt: number, a: AnimInput): void {
    const p = this.pose;
    p.reset();
    const k = this.k;
    const dk = damp(10, dt);
    k.crouch += ((a.crouch ? 1 : 0) - k.crouch) * dk;
    k.prone += ((a.prone ? 1 : 0) - k.prone) * damp(6, dt);
    k.sprint += ((a.mode === 'sprint' ? 1 : 0) - k.sprint) * dk;
    k.air += ((a.mode === 'air' ? 1 : 0) - k.air) * dk;
    k.slide += ((a.mode === 'slide' ? 1 : 0) - k.slide) * damp(14, dt);

    // Local movement.
    const yaw = a.yaw;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const fwdSpeed = a.vel.x * fx + a.vel.z * fz;
    const rightSpeed = a.vel.x * -fz + a.vel.z * fx;
    const speed = Math.hypot(a.vel.x, a.vel.z);
    k.move += (clamp(speed / 5.5, 0, 1.2) - k.move) * dk;
    const stride = a.prone ? 0.9 : 1.15 + k.sprint * 0.4;
    this.phase += dt * (speed / stride) * Math.PI;
    const ph = this.phase;
    const amp = clamp(speed / 6, 0, 1) * (0.55 + k.sprint * 0.25) * (1 - k.crouch * 0.35);
    const dirAng = Math.atan2(rightSpeed, Math.max(0.01, Math.abs(fwdSpeed))) * (fwdSpeed < -0.2 ? -1 : 1);
    const back = fwdSpeed < -0.2 ? -1 : 1;

    // Root transform (with whole-body pitch for prone / downed / dead / wingsuit).
    let bodyPitch = 0;
    let bodyRoll = 0;
    let lift = 0;
    let shiftZ = 0;
    if (a.mode === 'dead' || a.mode === 'downed') {
      const faceUp = a.mode === 'downed' || a.seed > 0.5;
      bodyPitch = faceUp ? -Math.PI / 2 : Math.PI / 2;
      bodyRoll = (a.seed - 0.5) * 0.5;
      lift = 0.2;
      shiftZ = faceUp ? 0.95 : -0.95;
    } else if (a.mode === 'wingsuit') {
      bodyPitch = Math.PI / 2 - 0.25;
      lift = 0.9;
      shiftZ = -0.9;
    } else if (k.prone > 0.01) {
      bodyPitch = (Math.PI / 2) * k.prone;
      lift = 0.22 * k.prone;
      shiftZ = -0.95 * k.prone;
    }
    _q.setFromAxisAngle(AY, yaw + Math.PI);
    _root.makeRotationFromQuaternion(_q);
    _root.setPosition(a.pos);
    if (bodyPitch !== 0 || bodyRoll !== 0) {
      _e.set(bodyPitch, 0, bodyRoll);
      _m.makeRotationFromEuler(_e);
      _m.setPosition(0, lift, shiftZ * SOLDIER_SCALE);
      _root.multiply(_m);
    }
    _s.set(SOLDIER_SCALE, SOLDIER_SCALE, SOLDIER_SCALE);
    _root.scale(_s);

    // ---- Legs and hips
    const swing = Math.sin(ph) * amp;
    const sx = Math.cos(dirAng), sz = Math.sin(dirAng);
    let hipY = -0.33 * k.crouch;
    switch (a.mode) {
      case 'slide':
        hipY = -0.5;
        p.setEuler(J.hipL, -1.45, 0, 0.1);
        p.setEuler(J.kneeL, 0.25, 0, 0);
        p.setEuler(J.hipR, -0.55, 0, -0.15);
        p.setEuler(J.kneeR, 1.7, 0, 0);
        p.setEuler(J.spine, -0.45, 0, 0);
        break;
      case 'air':
      case 'mantle': {
        const tuck = a.mode === 'mantle' ? 1.2 : 0.5;
        p.setEuler(J.hipL, -tuck - 0.2, 0, 0.05);
        p.setEuler(J.kneeL, tuck * 1.6, 0, 0);
        p.setEuler(J.hipR, -tuck * 0.6, 0, -0.05);
        p.setEuler(J.kneeR, tuck, 0, 0);
        break;
      }
      case 'ladder': {
        const c = Math.sin(ph * 1.4);
        p.setEuler(J.hipL, -0.9 + c * 0.5, 0, 0);
        p.setEuler(J.kneeL, 1.3 - c * 0.5, 0, 0);
        p.setEuler(J.hipR, -0.9 - c * 0.5, 0, 0);
        p.setEuler(J.kneeR, 1.3 + c * 0.5, 0, 0);
        break;
      }
      case 'zipline':
      case 'parachute': {
        const sway = Math.sin(this.phase * 0.3 + a.seed * 6) * 0.15;
        p.setEuler(J.hipL, -0.35 + sway, 0, 0.08);
        p.setEuler(J.kneeL, 0.4, 0, 0);
        p.setEuler(J.hipR, -0.2 - sway, 0, -0.08);
        p.setEuler(J.kneeR, 0.5, 0, 0);
        break;
      }
      case 'wingsuit':
        p.setEuler(J.hipL, 0.1, 0, 0.25);
        p.setEuler(J.hipR, 0.1, 0, -0.25);
        break;
      case 'seated':
        p.setEuler(J.hipL, -1.45, 0, 0.12);
        p.setEuler(J.kneeL, 1.45, 0, 0);
        p.setEuler(J.hipR, -1.45, 0, -0.12);
        p.setEuler(J.kneeR, 1.45, 0, 0);
        break;
      case 'downed':
        p.setEuler(J.hipL, -0.6, 0, 0.1);
        p.setEuler(J.kneeL, 1.1 + Math.sin(this.phase * 0.2) * 0.1, 0, 0);
        p.setEuler(J.hipR, -0.1, 0, -0.15);
        p.setEuler(J.kneeR, 0.2, 0, 0);
        break;
      case 'dead': {
        const s = a.seed;
        p.setEuler(J.hipL, -0.2 - s * 0.6, 0, 0.25);
        p.setEuler(J.kneeL, s * 0.9, 0, 0);
        p.setEuler(J.hipR, 0.1, 0, -0.3 - s * 0.2);
        p.setEuler(J.kneeR, 0.3, 0, 0);
        break;
      }
      default: {
        if (k.prone > 0.5) {
          const crawl = Math.sin(ph) * clamp(speed / 1.2, 0, 1) * 0.35;
          p.setEuler(J.hipL, crawl * 0.5, 0, 0.12 + crawl);
          p.setEuler(J.kneeL, Math.max(0, crawl) * 1.5, 0, 0);
          p.setEuler(J.hipR, -crawl * 0.5, 0, -0.12 + crawl);
          p.setEuler(J.kneeR, Math.max(0, -crawl) * 1.5, 0, 0);
        } else {
          const cr = k.crouch;
          const lw = -swing * back, rw = swing * back;
          p.setEuler(J.hipL, -cr * 1.15 + lw * sx, 0, lw * sz * 0.6 + 0.04);
          p.setEuler(J.kneeL, cr * 1.95 + Math.max(0, Math.sin(ph + 1.6)) * amp * 1.4, 0, 0);
          p.setEuler(J.hipR, -cr * 1.15 + rw * sx, 0, rw * sz * 0.6 - 0.04);
          p.setEuler(J.kneeR, cr * 1.95 + Math.max(0, Math.sin(ph + Math.PI + 1.6)) * amp * 1.4, 0, 0);
          p.setEuler(J.footL, -cr * 0.75, 0, 0);
          p.setEuler(J.footR, -cr * 0.75, 0, 0);
          // Hip bob while moving.
          hipY += -Math.abs(Math.sin(ph)) * amp * 0.06;
        }
      }
    }
    if (a.mode === 'seated') hipY = -0.42;
    p.hipOffset.set(0, hipY, 0);
    this.bob = hipY;

    // ---- Torso and head
    const pitch = a.mode === 'dead' || a.mode === 'downed' ? 0 : a.pitch;
    if (a.mode !== 'slide') {
      let spineX = k.sprint * 0.28 + k.crouch * 0.15 - pitch * 0.38;
      if (k.prone > 0.5) spineX = -0.35 - pitch * 0.25;
      if (a.mode === 'wingsuit') spineX = -0.3;
      const twist = a.mode === 'normal' || a.mode === 'sprint' ? clamp(rightSpeed * 0.04, -0.2, 0.2) : 0;
      p.setEuler(J.spine, spineX, twist, 0);
      p.setEuler(J.hips, 0, -twist * 0.6, 0);
    }
    const neckX = a.mode === 'dead' ? 0.3 * (a.seed - 0.5) : a.mode === 'downed' ? -0.4 : k.prone > 0.5 ? -0.9 - pitch * 0.4 : -pitch * 0.55 - k.sprint * 0.15;
    p.setEuler(J.neck, neckX, a.mode === 'dead' ? (a.seed - 0.5) * 1.2 : 0, 0);

    // ---- Arms (euler poses for modes without a held weapon)
    const holding = !!a.weapon && (a.mode === 'normal' || a.mode === 'sprint' || a.mode === 'slide' || a.mode === 'air' || a.mode === 'seated' || a.mode === 'mantle') && a.throwing < 0;
    if (!holding) armPose(p, a, this.phase);

    evaluateFK(_root, p, this.out, this.mats);
    _head.set(0, BUILD.headH / 2 + 0.08, 0).applyMatrix4(this.mats[J.neck]);
    this.headPos.copy(_head);

    this.hasWeapon = holding;
    if (!holding || !a.weapon) return;
    this.holdWeapon(a, k.sprint, k.prone);
  }

  private holdWeapon(a: AnimInput, sprintK: number, proneK: number): void {
    const w = a.weapon!;
    // Aim rotation: model forward is +Z, so yaw + PI; pitch tilts +Z toward +Y.
    _q.setFromAxisAngle(AY, a.yaw + Math.PI);
    _q2.setFromAxisAngle(AX, -clamp(a.pitch, -1.2, 1.2));
    _q.multiply(_q2);
    const off = _off.copy(holdOffset(w.cat));
    // Sprint: lower and cant the weapon across the chest.
    if (sprintK > 0.01 && w.cat !== 'launcher') {
      _q2.setFromEuler(_e.set(0.75 * sprintK, -0.55 * sprintK, 0.3 * sprintK));
      _q.multiply(_q2);
      off.x += 0.06 * sprintK;
      off.y -= 0.12 * sprintK;
    }
    if (proneK > 0.5) off.y += 0.05;
    // Melee: jab the weapon forward.
    if (a.melee >= 0) {
      const t = Math.sin(a.melee * Math.PI);
      off.z += 0.3 * t;
      _q2.setFromAxisAngle(AZ, 0.6 * t);
      _q.multiply(_q2);
    }
    // Reload: tilt the weapon.
    if (a.reload >= 0) {
      const t = Math.sin(a.reload * Math.PI);
      _q2.setFromEuler(_e.set(-0.25 * t, 0, 0.45 * t));
      _q.multiply(_q2);
      off.y -= 0.03 * t;
    }
    // Recoil kick.
    off.z -= a.kick * 0.05;
    _v.copy(off).multiplyScalar(SOLDIER_SCALE).applyQuaternion(_q).add(_head);
    this.weaponMatrix.compose(_v, _q, _s.set(TP_WEAPON_SCALE, TP_WEAPON_SCALE, TP_WEAPON_SCALE));

    // Hand targets.
    _right.copy(w.anchors.grip).applyMatrix4(this.weaponMatrix);
    _left.copy(w.anchors.fore).applyMatrix4(this.weaponMatrix);
    if (a.reload >= 0) {
      // Left hand: to magazine, down to the belt, back, then to the foregrip.
      const t = a.reload;
      _v.copy(w.anchors.mag).applyMatrix4(this.weaponMatrix);
      _fwd.set(0.12, -0.15, 0).applyMatrix4(this.mats[J.hips]);
      if (t < 0.25) _left.lerp(_v, t / 0.25);
      else if (t < 0.5) _left.copy(_v).lerp(_fwd, (t - 0.25) / 0.25);
      else if (t < 0.75) _left.copy(_fwd).lerp(_v, (t - 0.5) / 0.25);
      else _left.copy(_v).lerp(_left, (t - 0.75) / 0.25);
    }
    _fwd.set(0, 0, 1).applyQuaternion(_q);
    // Elbows: right points down and out to the right, left down and slightly inward.
    _pole.set(0, -1, 0).addScaledVector(_v.set(-1, 0, 0).applyQuaternion(_q), 0.8);
    solveArmIK(this.mats, this.out, J.shoulderR, _right, _pole, _fwd, _q, SOLDIER_SCALE);
    _pole.set(0, -1, 0).addScaledVector(_v.set(1, 0, 0).applyQuaternion(_q), 0.35);
    solveArmIK(this.mats, this.out, J.shoulderL, _left, _pole, _fwd, _q, SOLDIER_SCALE);
  }

  /** Vertical hip offset applied this frame (used by camera bob in third person). */
  get hipBob(): number {
    return this.bob;
  }
}

function armPose(p: Pose, a: AnimInput, phase: number): void {
  switch (a.mode) {
    case 'ladder': {
      const c = Math.sin(phase * 1.4);
      p.setEuler(J.shoulderL, -2.6 + c * 0.35, 0, 0.1);
      p.setEuler(J.elbowL, -0.5, 0, 0);
      p.setEuler(J.shoulderR, -2.6 - c * 0.35, 0, -0.1);
      p.setEuler(J.elbowR, -0.5, 0, 0);
      return;
    }
    case 'zipline':
    case 'parachute':
      p.setEuler(J.shoulderL, -2.9, 0, -0.25);
      p.setEuler(J.elbowL, -0.3, 0, 0);
      p.setEuler(J.shoulderR, -2.9, 0, 0.25);
      p.setEuler(J.elbowR, -0.3, 0, 0);
      return;
    case 'wingsuit':
      p.setEuler(J.shoulderL, -0.2, 0, 1.35);
      p.setEuler(J.shoulderR, -0.2, 0, -1.35);
      return;
    case 'downed':
      p.setEuler(J.shoulderL, -0.9, 0, -0.5);
      p.setEuler(J.elbowL, -1.6, 0, 0);
      p.setEuler(J.shoulderR, 0.2, 0, -0.5);
      return;
    case 'dead':
      p.setEuler(J.shoulderL, -0.6 - a.seed, 0, 0.9);
      p.setEuler(J.elbowL, -0.3, 0, 0);
      p.setEuler(J.shoulderR, 0.3, 0, -0.7 - a.seed * 0.5);
      p.setEuler(J.elbowR, -0.6, 0, 0);
      return;
    case 'seated':
      if (a.driving) {
        p.setEuler(J.shoulderL, -1.1, 0, -0.25);
        p.setEuler(J.elbowL, -0.6, 0, 0);
        p.setEuler(J.shoulderR, -1.1, 0, 0.25);
        p.setEuler(J.elbowR, -0.6, 0, 0);
      }
      return;
    default:
      if (a.throwing >= 0) {
        // Overhand throw with the right arm; left arm points at the target.
        const t = a.throwing;
        const windup = t < 0.4 ? t / 0.4 : 1 - (t - 0.4) / 0.6;
        p.setEuler(J.shoulderR, -2.4 * windup - 0.6, 0, 0.2);
        p.setEuler(J.elbowR, -1.4 * windup, 0, 0);
        p.setEuler(J.shoulderL, -1.4, 0, -0.2);
        return;
      }
      // Empty-handed: relaxed swing.
      p.setEuler(J.shoulderL, Math.sin(phase) * 0.3, 0, 0.1);
      p.setEuler(J.shoulderR, -Math.sin(phase) * 0.3, 0, -0.1);
      p.setEuler(J.elbowL, -0.25, 0, 0);
      p.setEuler(J.elbowR, -0.25, 0, 0);
  }
}
