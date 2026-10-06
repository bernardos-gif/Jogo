// Instanced model helper: one toon mesh, its inverted-hull outline and its glow mesh, each an
// InstancedMesh, refilled every frame (begin / add / end). Used for deployables and props that
// appear many times, so each kind costs at most three draw calls.
import * as THREE from 'three';
import { MATS, addOutlineNormals } from './toon';

export class InstancedModel {
  private meshes: THREE.InstancedMesh[] = [];
  private n = 0;

  constructor(
    scene: THREE.Object3D,
    geo: { toon: THREE.BufferGeometry | null; glow: THREE.BufferGeometry | null },
    readonly cap: number,
    opts: { outline?: boolean; shadow?: boolean } = {},
  ) {
    const add = (g: THREE.BufferGeometry, m: THREE.Material, name: string, shadow: boolean) => {
      const im = new THREE.InstancedMesh(g, m, cap);
      im.count = 0;
      im.frustumCulled = false;
      im.castShadow = shadow;
      im.receiveShadow = shadow;
      im.name = name;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(im);
      this.meshes.push(im);
    };
    if (geo.toon) {
      add(geo.toon, MATS.toon, 'gadget', opts.shadow ?? true);
      if (opts.outline !== false) {
        if (!geo.toon.getAttribute('outlineNormal')) addOutlineNormals(geo.toon);
        add(geo.toon, MATS.outline, 'outline', false);
      }
    }
    if (geo.glow) add(geo.glow, MATS.glow, 'glow', false);
  }

  begin(): void {
    this.n = 0;
  }

  add(m: THREE.Matrix4): void {
    if (this.n >= this.cap) return;
    for (const im of this.meshes) im.setMatrixAt(this.n, m);
    this.n++;
  }

  end(): void {
    for (const im of this.meshes) {
      im.count = this.n;
      im.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const im of this.meshes) im.removeFromParent();
  }
}
