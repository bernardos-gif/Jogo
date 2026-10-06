// The 15-joint "toy figure" rig from Elemental Brawl (STYLE_GUIDE.md section 3), evaluated with
// forward kinematics into world matrices, plus analytic two-bone IK for arms holding weapons.
import * as THREE from 'three';

export const J = {
  hips: 0,
  spine: 1,
  neck: 2,
  shoulderL: 3,
  elbowL: 4,
  handL: 5,
  shoulderR: 6,
  elbowR: 7,
  handR: 8,
  hipL: 9,
  kneeL: 10,
  footL: 11,
  hipR: 12,
  kneeR: 13,
  footR: 14,
} as const;
export type JointIndex = (typeof J)[keyof typeof J];
export const JOINT_COUNT = 15;
export const PARENT: readonly number[] = [-1, 0, 1, 1, 3, 4, 1, 6, 7, 0, 9, 10, 0, 12, 13];

/** Elemental Brawl's default build (unscaled units). */
export const BUILD = {
  torsoW: 0.66,
  torsoH: 0.62,
  torsoD: 0.4,
  pelvisW: 0.56,
  headW: 0.5,
  headH: 0.48,
  armW: 0.21,
  upperArm: 0.36,
  foreArm: 0.32,
  handS: 0.27,
  legW: 0.26,
  thigh: 0.36,
  shin: 0.32,
  bootW: 0.31,
  bootH: 0.24,
  bootL: 0.46,
};

/** Vector Front soldiers: EB proportions at 0.86 scale (about 1.85 m tall). */
export const SOLDIER_SCALE = 0.86;
export const ANKLE = BUILD.bootH * 0.55;
export const HIP_HEIGHT = ANKLE + BUILD.shin + BUILD.thigh + 0.06;
const SHOULDER_X = BUILD.torsoW / 2 + BUILD.armW / 2 + 0.01;
const HIP_X = BUILD.pelvisW / 2 - BUILD.legW / 2 + 0.01;

/** Rest offsets of each joint relative to its parent (model faces +Z; +X is the model's left). */
export const REST: readonly THREE.Vector3[] = [
  new THREE.Vector3(0, HIP_HEIGHT, 0),
  new THREE.Vector3(0, 0.12, 0),
  new THREE.Vector3(0, BUILD.torsoH, 0),
  new THREE.Vector3(SHOULDER_X, BUILD.torsoH - 0.1, 0),
  new THREE.Vector3(0, -BUILD.upperArm, 0),
  new THREE.Vector3(0, -BUILD.foreArm, 0),
  new THREE.Vector3(-SHOULDER_X, BUILD.torsoH - 0.1, 0),
  new THREE.Vector3(0, -BUILD.upperArm, 0),
  new THREE.Vector3(0, -BUILD.foreArm, 0),
  new THREE.Vector3(HIP_X, -0.06, 0),
  new THREE.Vector3(0, -BUILD.thigh, 0),
  new THREE.Vector3(0, -BUILD.shin, 0),
  new THREE.Vector3(-HIP_X, -0.06, 0),
  new THREE.Vector3(0, -BUILD.thigh, 0),
  new THREE.Vector3(0, -BUILD.shin, 0),
];

/** Eye height above the feet when standing (center of the head, scaled). */
export const EYE_HEIGHT = (HIP_HEIGHT + 0.12 + BUILD.torsoH + 0.08 + BUILD.headH * 0.55) * SOLDIER_SCALE;

/** Per-joint local rotations (quaternions) plus hip offsets; written by the animator. */
export class Pose {
  readonly q: THREE.Quaternion[] = Array.from({ length: JOINT_COUNT }, () => new THREE.Quaternion());
  readonly hipOffset = new THREE.Vector3();
  setEuler(j: number, x: number, y: number, z: number, order: THREE.EulerOrder = 'XYZ'): void {
    _e.set(x, y, z, order);
    this.q[j].setFromEuler(_e);
  }
  reset(): void {
    for (const q of this.q) q.identity();
    this.hipOffset.set(0, 0, 0);
  }
}

const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);
const _local = new THREE.Matrix4();
const _tmp = new THREE.Matrix4();

/** Forward kinematics: writes 15 world matrices (column-major, 16 floats each) into `out`. */
export function evaluateFK(root: THREE.Matrix4, pose: Pose, out: Float32Array, mats: THREE.Matrix4[]): void {
  for (let j = 0; j < JOINT_COUNT; j++) {
    _p.copy(REST[j]);
    if (j === J.hips) _p.add(pose.hipOffset);
    _local.compose(_p, pose.q[j], _one);
    const parent = PARENT[j];
    if (parent < 0) mats[j].multiplyMatrices(root, _local);
    else mats[j].multiplyMatrices(mats[parent], _local);
  }
  for (let j = 0; j < JOINT_COUNT; j++) mats[j].toArray(out, j * 16);
}

const _s = new THREE.Vector3();
const _t = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _perp = new THREE.Vector3();
const _u = new THREE.Vector3();
const _e2 = new THREE.Vector3();
const _f = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();

/** World matrix whose local -Y points along `along` and local +Z leans toward `ref`. */
function boneBasis(out: THREE.Matrix4, origin: THREE.Vector3, along: THREE.Vector3, ref: THREE.Vector3, scale: number): void {
  _y.copy(along).multiplyScalar(-1).normalize();
  _z.copy(ref).addScaledVector(_y, -ref.dot(_y));
  if (_z.lengthSq() < 1e-6) _z.set(0, 0, 1).addScaledVector(_y, -_y.z);
  _z.normalize();
  _x.crossVectors(_y, _z).normalize();
  out.makeBasis(_x.multiplyScalar(scale), _y.multiplyScalar(scale), _z.multiplyScalar(scale));
  out.setPosition(origin);
}

/**
 * Two-bone IK for an arm. Overrides the shoulder, elbow and hand world matrices so the hand
 * reaches `target`. `pole` bends the elbow toward a direction; `ref` orients the bone twist;
 * `handRot` gives the hand its world orientation (the weapon's).
 */
export function solveArmIK(
  mats: THREE.Matrix4[],
  out: Float32Array,
  shoulder: number,
  target: THREE.Vector3,
  pole: THREE.Vector3,
  ref: THREE.Vector3,
  handRot: THREE.Quaternion,
  scale: number,
): void {
  const elbow = shoulder + 1;
  const hand = shoulder + 2;
  _s.setFromMatrixPosition(mats[shoulder]);
  const a = BUILD.upperArm * scale;
  const b = BUILD.foreArm * scale;
  _t.copy(target);
  _dir.subVectors(_t, _s);
  let d = _dir.length();
  if (d < 1e-5) return;
  _dir.multiplyScalar(1 / d);
  const maxReach = (a + b) * 0.999;
  if (d > maxReach) {
    d = maxReach;
    _t.copy(_s).addScaledVector(_dir, d);
  }
  d = Math.max(d, Math.abs(a - b) + 1e-3);
  const cosA = THREE.MathUtils.clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
  const alpha = Math.acos(cosA);
  _perp.copy(pole).addScaledVector(_dir, -pole.dot(_dir));
  if (_perp.lengthSq() < 1e-6) _perp.set(0, -1, 0).addScaledVector(_dir, _dir.y);
  _perp.normalize();
  _u.copy(_dir).multiplyScalar(Math.cos(alpha)).addScaledVector(_perp, Math.sin(alpha)).normalize();
  _e2.copy(_s).addScaledVector(_u, a);
  _f.subVectors(_t, _e2).normalize();
  boneBasis(mats[shoulder], _s, _u, ref, scale);
  boneBasis(mats[elbow], _e2, _f, ref, scale);
  _tmp.compose(_t, handRot, _one.set(scale, scale, scale));
  mats[hand].copy(_tmp);
  _one.set(1, 1, 1);
  mats[shoulder].toArray(out, shoulder * 16);
  mats[elbow].toArray(out, elbow * 16);
  mats[hand].toArray(out, hand * 16);
}
