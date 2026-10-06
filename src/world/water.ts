// Shallow sea: a faceted toon plane with gentle vertex waves (flat-shaded facets catch the ramp).
import * as THREE from 'three';
import { toonMaterial } from '../render/toon';

export class Water {
  readonly mesh: THREE.Mesh;
  private uniforms = { uTime: { value: 0 } };

  constructor(level: number, x0: number, x1: number, z0: number, z1: number, seg = 90) {
    const geo = new THREE.PlaneGeometry(x1 - x0, z1 - z0, seg, seg).toNonIndexed();
    geo.rotateX(-Math.PI / 2);
    geo.translate((x0 + x1) / 2, level, (z0 + z1) / 2);
    // Two-tone facets.
    const n = geo.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    const a = new THREE.Color(0x3a6a8a), b = new THREE.Color(0x4a7a9a);
    for (let t = 0; t < n / 3; t++) {
      const c = (t * 7919) % 5 === 0 ? b : a;
      for (let k = 0; k < 3; k++) {
        col[(t * 3 + k) * 3] = c.r;
        col[(t * 3 + k) * 3 + 1] = c.g;
        col[(t * 3 + k) * 3 + 2] = c.b;
      }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = toonMaterial(0xffffff, true);
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.uniforms.uTime;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace(
          '#include <begin_vertex>',
          `vec3 transformed = vec3(position);
           transformed.y += sin(position.x * 0.09 + uTime * 0.8) * 0.18 + cos(position.z * 0.07 + uTime * 0.6) * 0.16;`,
        );
    };
    mat.customProgramCacheKey = () => 'vf-water';
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
  }

  update(dt: number): void {
    this.uniforms.uTime.value += dt;
  }
}
