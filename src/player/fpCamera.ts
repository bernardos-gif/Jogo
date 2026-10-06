// First-person camera: eye position with interpolation, FOV from settings (horizontal at 16:9,
// Hor+ on wider screens), head bob, landing dip, trauma-based shake, recoil offsets and zoom.
import * as THREE from 'three';
import { TUNING } from '../config/tuning';
import { clamp, damp } from '../core/math';
import { noise2 } from '../world/noise';

const C = TUNING.camera;
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');

/** Vertical FOV (degrees) for a horizontal FOV setting at a 16:9 reference aspect. */
export function verticalFov(horizontalDeg: number, zoom = 1): number {
  const h = THREE.MathUtils.degToRad(horizontalDeg);
  const v = 2 * Math.atan(Math.tan(h / 2) / (16 / 9));
  return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(v / 2) / zoom));
}

export class FpCamera {
  readonly camera: THREE.PerspectiveCamera;
  private trauma = 0;
  private t = 0;
  private bobPhase = 0;
  private fovAdd = 0;
  /** Visual recoil offsets (radians) applied on top of the aim. */
  recoilPitch = 0;
  recoilYaw = 0;
  shakeScale = 1;
  headBob = true;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(verticalFov(C.defaultFov), aspect, C.near, C.far);
    this.camera.rotation.order = 'YXZ';
  }

  addTrauma(amount: number): void {
    this.trauma = clamp(this.trauma + amount, 0, 1);
  }

  /**
   * @param eye interpolated eye position
   * @param speed horizontal speed for bob
   * @param fovSetting horizontal FOV setting
   * @param zoom sight magnification blended by ADS
   * @param extraFov sprint / slide FOV boost (degrees)
   */
  update(dt: number, eye: THREE.Vector3, yaw: number, pitch: number, speed: number, grounded: boolean, landKick: number, fovSetting: number, zoom: number, extraFov: number, aspect: number): void {
    this.t += dt;
    this.trauma = Math.max(0, this.trauma - C.shakeDecay * dt);
    // Bob.
    let bx = 0, by = 0;
    if (this.headBob && grounded && speed > 0.5) {
      this.bobPhase += dt * speed * 1.9 * C.bobRate;
      const a = C.bobAmplitude * clamp(speed / 6, 0, 1.3) / Math.max(1, zoom * 0.8);
      bx = Math.sin(this.bobPhase) * a * 0.6;
      by = -Math.abs(Math.cos(this.bobPhase)) * a;
    }
    by -= landKick * C.landKick;
    // Shake.
    const sh = this.trauma * this.trauma * this.shakeScale;
    const sx = noise2(this.t * 18, 3.1) * sh;
    const sy = noise2(this.t * 18, 9.7) * sh;
    const sr = noise2(this.t * 14, 15.3) * sh;
    _e.set(pitch + this.recoilPitch + sy * C.shakeMaxAngle, yaw + this.recoilYaw + sx * C.shakeMaxAngle, sr * C.shakeMaxAngle);
    _q.setFromEuler(_e);
    this.camera.quaternion.copy(_q);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(_q);
    this.camera.position.copy(eye).addScaledVector(right, bx + sx * C.shakeMaxOffset * 0.3);
    this.camera.position.y += by + sy * C.shakeMaxOffset * 0.3;
    // FOV.
    this.fovAdd += (extraFov - this.fovAdd) * damp(8, dt);
    const fov = verticalFov(fovSetting + this.fovAdd, Math.max(1, zoom));
    if (Math.abs(this.camera.fov - fov) > 0.01 || this.camera.aspect !== aspect) {
      this.camera.fov = fov;
      this.camera.aspect = aspect;
      this.camera.updateProjectionMatrix();
    }
    this.camera.updateMatrixWorld();
  }
}
