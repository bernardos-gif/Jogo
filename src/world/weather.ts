// Weather around the camera: wind-driven dust motes and rain streaks. Both are single draw calls
// that wrap their particles inside a box that follows the camera, so their cost does not depend on
// where the weather is; intensities come from the event system (rain bands ahead of the storm).
import * as THREE from 'three';
import { TUNING } from '../config/tuning';

const W = TUNING.weather;

export class WeatherFx {
  readonly group = new THREE.Group();
  private dust: THREE.Points;
  private dustPos: Float32Array;
  private dustSeed: Float32Array;
  private rain: THREE.LineSegments;
  private rainPos: Float32Array;
  private drops: Float32Array;
  private dustMat: THREE.PointsMaterial;
  private rainMat: THREE.LineBasicMaterial;
  private t = 0;

  constructor(scene: THREE.Scene, scale = 1) {
    const nd = Math.max(1, Math.round(W.dustCount * scale));
    this.dustPos = new Float32Array(nd * 3);
    this.dustSeed = new Float32Array(nd);
    const B = W.dustBox;
    for (let i = 0; i < nd; i++) {
      this.dustPos[i * 3] = (Math.random() - 0.5) * B;
      this.dustPos[i * 3 + 1] = Math.random() * B * 0.4;
      this.dustPos[i * 3 + 2] = (Math.random() - 0.5) * B;
      this.dustSeed[i] = Math.random() * 100;
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(this.dustPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.dustMat = new THREE.PointsMaterial({ color: 0xe8c9a0, size: 0.16, sizeAttenuation: true, transparent: true, opacity: 0.5, depthWrite: false, fog: true });
    this.dust = new THREE.Points(dg, this.dustMat);
    this.dust.frustumCulled = false;

    const nr = Math.max(1, Math.round(W.rainCount * scale));
    this.drops = new Float32Array(nr * 3);
    this.rainPos = new Float32Array(nr * 6);
    const R = W.rainBox;
    for (let i = 0; i < nr; i++) {
      this.drops[i * 3] = (Math.random() - 0.5) * R;
      this.drops[i * 3 + 1] = Math.random() * R * 0.8;
      this.drops[i * 3 + 2] = (Math.random() - 0.5) * R;
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.rainMat = new THREE.LineBasicMaterial({ color: 0xc8dcf0, transparent: true, opacity: 0.38, depthWrite: false, fog: true });
    this.rain = new THREE.LineSegments(rg, this.rainMat);
    this.rain.frustumCulled = false;
    this.group.add(this.dust, this.rain);
    scene.add(this.group);
  }

  /**
   * @param wind wind velocity (m/s, x/z)
   * @param rain 0..1 rain intensity at the camera
   * @param dust 0..1 dust intensity at the camera
   */
  update(dt: number, cam: THREE.Vector3, wind: THREE.Vector3, rain: number, dust: number, tint: THREE.Color): void {
    this.t += dt;
    // Dust: drift with the wind, bob, wrap around the camera.
    const nd = this.dustSeed.length;
    const showDust = Math.round(nd * Math.min(1, dust));
    this.dust.visible = showDust > 0;
    if (showDust > 0) {
      const B = W.dustBox;
      const half = B / 2;
      const p = this.dustPos;
      for (let i = 0; i < showDust; i++) {
        const k = i * 3;
        const sd = this.dustSeed[i];
        p[k] += (wind.x * (0.8 + (sd % 1) * 0.5) + Math.sin(this.t * 0.7 + sd) * 0.4) * dt;
        p[k + 1] += (Math.sin(this.t * 1.3 + sd * 1.7) * 0.25 + wind.length() * 0.02) * dt;
        p[k + 2] += (wind.z * (0.8 + (sd % 1) * 0.5) + Math.cos(this.t * 0.6 + sd) * 0.4) * dt;
        // Wrap relative to the camera.
        let rx = p[k] - cam.x, rz = p[k + 2] - cam.z, ry = p[k + 1] - cam.y;
        if (rx > half) rx -= B;
        else if (rx < -half) rx += B;
        if (rz > half) rz -= B;
        else if (rz < -half) rz += B;
        if (ry > B * 0.3) ry -= B * 0.4;
        else if (ry < -B * 0.1) ry += B * 0.4;
        p[k] = cam.x + rx;
        p[k + 1] = cam.y + ry;
        p[k + 2] = cam.z + rz;
      }
      this.dust.geometry.setDrawRange(0, showDust);
      (this.dust.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      this.dustMat.opacity = 0.25 + 0.4 * Math.min(1, dust);
      this.dustMat.color.setHex(0xe8c9a0).lerp(tint, 0.35);
    }
    // Rain: fall with the wind, streak along the velocity, wrap in the box.
    const nr = this.drops.length / 3;
    const showRain = Math.round(nr * Math.min(1, rain));
    this.rain.visible = showRain > 0;
    if (showRain > 0) {
      const R = W.rainBox;
      const half = R / 2;
      const d = this.drops;
      const o = this.rainPos;
      const vx = wind.x * 0.6, vy = -W.rainSpeed, vz = wind.z * 0.6;
      const sl = 0.035;
      for (let i = 0; i < showRain; i++) {
        const k = i * 3;
        // Drops live in camera-relative space so they never leave the box.
        d[k] += vx * dt;
        d[k + 1] += vy * dt;
        d[k + 2] += vz * dt;
        if (d[k + 1] < -R * 0.2) d[k + 1] += R * 0.8;
        if (d[k] > half) d[k] -= R;
        else if (d[k] < -half) d[k] += R;
        if (d[k + 2] > half) d[k + 2] -= R;
        else if (d[k + 2] < -half) d[k + 2] += R;
        const x = cam.x + d[k], y = cam.y + d[k + 1], z = cam.z + d[k + 2];
        const j = i * 6;
        o[j] = x;
        o[j + 1] = y;
        o[j + 2] = z;
        o[j + 3] = x - vx * sl;
        o[j + 4] = y - vy * sl;
        o[j + 5] = z - vz * sl;
      }
      this.rain.geometry.setDrawRange(0, showRain * 2);
      (this.rain.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      this.rainMat.opacity = 0.22 + 0.3 * Math.min(1, rain);
    }
  }

  dispose(): void {
    this.dust.geometry.dispose();
    this.rain.geometry.dispose();
    this.dustMat.dispose();
    this.rainMat.dispose();
    this.group.removeFromParent();
  }
}
