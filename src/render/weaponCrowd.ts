// Third-person weapons held by soldiers: one instanced toon mesh (+ outline, + glow) per weapon.
import * as THREE from 'three';
import { MATS, GLOW_RIG, glowMaterial } from './toon';
import { buildWeaponGeometry, type WeaponAnchors } from '../art/weaponModels';
import { WEAPONS, type WeaponId } from '../config/content';

interface Entry {
  body: THREE.InstancedMesh;
  outline: THREE.InstancedMesh;
  glow: THREE.InstancedMesh | null;
  anchors: WeaponAnchors;
  n: number;
}

export class WeaponCrowd {
  readonly group = new THREE.Group();
  private entries = new Map<WeaponId, Entry>();
  private glowMat = glowMaterial(GLOW_RIG);

  constructor(
    scene: THREE.Scene,
    readonly cap = 64,
  ) {
    scene.add(this.group);
    for (const w of WEAPONS) {
      const g = buildWeaponGeometry(w.id);
      const body = new THREE.InstancedMesh(g.toon, MATS.toon, cap);
      body.castShadow = true;
      const outline = new THREE.InstancedMesh(g.toon, MATS.outlineChar, cap);
      const glow = g.glow ? new THREE.InstancedMesh(g.glow, this.glowMat, cap) : null;
      for (const m of [body, outline, glow]) {
        if (!m) continue;
        m.frustumCulled = false;
        m.count = 0;
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.group.add(m);
      }
      this.entries.set(w.id, { body, outline, glow, anchors: g.anchors, n: 0 });
    }
  }

  anchors(id: WeaponId): WeaponAnchors {
    return this.entries.get(id)!.anchors;
  }

  submit(id: WeaponId, m: THREE.Matrix4): void {
    const e = this.entries.get(id)!;
    if (e.n >= this.cap) return;
    e.body.setMatrixAt(e.n, m);
    e.outline.setMatrixAt(e.n, m);
    e.glow?.setMatrixAt(e.n, m);
    e.n++;
  }

  flush(): void {
    for (const e of this.entries.values()) {
      for (const m of [e.body, e.outline, e.glow]) {
        if (!m) continue;
        m.count = e.n;
        m.visible = e.n > 0;
        if (e.n) m.instanceMatrix.needsUpdate = true;
      }
      e.n = 0;
    }
  }

  dispose(): void {
    for (const e of this.entries.values()) {
      e.body.geometry.dispose();
      e.glow?.geometry.dispose();
    }
    this.glowMat.dispose();
    this.group.removeFromParent();
  }
}
