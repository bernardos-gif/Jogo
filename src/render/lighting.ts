// Light rig from Elemental Brawl: hemisphere fill, ambient and one low warm shadow-casting sun,
// driven by the sky state. The shadow box follows the camera across the battlefield.
import * as THREE from 'three';
import type { SkyState } from './sky';
import type { QualityProfile } from './quality';

export class Lighting {
  readonly hemi = new THREE.HemisphereLight(0xffd6b0, 0x6a4a7a, 1.15);
  readonly ambient = new THREE.AmbientLight(0xffffff, 0.35);
  readonly sun = new THREE.DirectionalLight(0xffe0b8, 2.4);
  readonly sunDir = new THREE.Vector3(-0.62, 0.22, -0.75).normalize();
  private shadowRadius = 70;
  private texel = 1;

  constructor(scene: THREE.Scene) {
    scene.add(this.hemi, this.ambient, this.sun, this.sun.target);
  }

  applyQuality(q: QualityProfile): void {
    this.sun.castShadow = q.shadows;
    if (!q.shadows) return;
    this.shadowRadius = q.shadowRadius;
    const cam = this.sun.shadow.camera;
    cam.left = -q.shadowRadius;
    cam.right = q.shadowRadius;
    cam.top = q.shadowRadius;
    cam.bottom = -q.shadowRadius;
    cam.near = 1;
    cam.far = 600;
    cam.updateProjectionMatrix();
    this.sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.03;
    this.texel = (q.shadowRadius * 2) / q.shadowMapSize;
    if (this.sun.shadow.map) {
      this.sun.shadow.map.dispose();
      this.sun.shadow.map = null as unknown as THREE.WebGLRenderTarget;
    }
  }

  applySky(s: SkyState): void {
    this.sunDir.copy(s.sunDir);
    this.sun.color.copy(s.sunLight);
    this.sun.intensity = s.sunIntensity;
    this.hemi.color.copy(s.hemiSky);
    this.hemi.groundColor.copy(s.hemiGround);
    this.hemi.intensity = s.hemiIntensity;
    this.ambient.intensity = s.ambientIntensity;
  }

  /** Centers the shadow box on the focus point, snapped to shadow texels to avoid shimmering. */
  follow(focus: THREE.Vector3): void {
    const snap = this.texel;
    const fx = Math.round(focus.x / snap) * snap;
    const fz = Math.round(focus.z / snap) * snap;
    this.sun.target.position.set(fx, focus.y, fz);
    const dist = this.shadowRadius * 3;
    this.sun.position.set(fx + this.sunDir.x * dist, focus.y + this.sunDir.y * dist, fz + this.sunDir.z * dist);
    this.sun.target.updateMatrixWorld();
  }
}
