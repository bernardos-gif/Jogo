// Destruction: wall panels, fences, container doors, solar panels, crates and fuel tanks are
// instanced per kind, stop bullets and soldiers, take damage, and break into pooled debris chunks.
// Fuel tanks explode and chain-react; tagged groups (the rocket's fuel) report to scripted events.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { addOutlineNormals, MATS } from '../render/toon';
import { G, type Physics } from '../physics/physics';
import { dustKick } from '../render/recipes';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { CollisionWorld, DynBox } from '../physics/collision';
import type { DestructibleSpec } from './builder';
import type { VFX } from '../render/vfx';
import type { Surface } from './surface';

export interface Destructible {
  id: number;
  kind: string;
  index: number;
  matrix: THREE.Matrix4;
  center: THREE.Vector3;
  half: THREE.Vector3;
  rotY: number;
  hp: number;
  maxHp: number;
  surface: Surface;
  explosive: boolean;
  debris: boolean;
  colors: number[];
  alive: boolean;
  collider: RAPIER.Collider | null;
  box: DynBox | null;
  tag?: string;
}

interface KindMesh {
  body: THREE.InstancedMesh;
  outline: THREE.InstancedMesh;
  glow: THREE.InstancedMesh | null;
}

const _zero = new THREE.Matrix4().makeScale(0, 0, 0);
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();

export class Destructibles {
  readonly items: Destructible[] = [];
  private kinds = new Map<string, KindMesh>();
  /** Explosion requests from destroyed explosive items (handled by the battle). */
  onExplode: ((d: Destructible) => void) | null = null;
  onDestroyed: ((d: Destructible) => void) | null = null;
  destroyedCount = 0;

  constructor(
    scene: THREE.Scene,
    specs: DestructibleSpec[],
    private physics: Physics,
    private collision: CollisionWorld,
    private vfx: VFX,
  ) {
    // Group by kind; the first spec's geometry becomes the shared template.
    const groups = new Map<string, DestructibleSpec[]>();
    for (const s of specs) {
      let l = groups.get(s.kind);
      if (!l) groups.set(s.kind, (l = []));
      l.push(s);
    }
    let id = 1;
    for (const [kind, list] of groups) {
      const tpl = list[0].geo;
      const toon = tpl.toon.length > 1 ? mergeGeometries(tpl.toon, false)! : tpl.toon[0];
      addOutlineNormals(toon);
      const glow = tpl.glow.length ? (tpl.glow.length > 1 ? mergeGeometries(tpl.glow, false)! : tpl.glow[0]) : null;
      const n = list.length;
      const body = new THREE.InstancedMesh(toon, MATS.toon, n);
      body.castShadow = true;
      body.receiveShadow = true;
      const outline = new THREE.InstancedMesh(toon, MATS.outline, n);
      outline.name = 'outline';
      const glowMesh = glow ? new THREE.InstancedMesh(glow, MATS.lamp, n) : null;
      for (const m of [body, outline, glowMesh]) if (m) scene.add(m);
      this.kinds.set(kind, { body, outline, glow: glowMesh });
      for (let i = 1; i < list.length; i++) for (const g of [...list[i].geo.toon, ...list[i].geo.glow]) g.dispose();
      list.forEach((s, i) => {
        s.matrix.decompose(_p, _q, _s);
        const rotY = new THREE.Euler().setFromQuaternion(_q, 'YXZ').y;
        const center = tpl.center.clone().multiply(_s).applyQuaternion(_q).add(_p);
        const half = tpl.half.clone().multiply(_s);
        const d: Destructible = {
          id: id++,
          kind,
          index: i,
          matrix: s.matrix.clone(),
          center,
          half,
          rotY,
          hp: s.hp,
          maxHp: s.hp,
          surface: s.surface,
          explosive: s.explosive,
          debris: s.debris,
          colors: tpl.colors,
          alive: true,
          collider: null,
          box: null,
          tag: s.tag,
        };
        this.items.push(d);
        this.spawn(d);
      });
      for (const m of [body, outline, glowMesh]) {
        if (!m) continue;
        m.instanceMatrix.needsUpdate = true;
        m.computeBoundingSphere();
      }
    }
  }

  private spawn(d: Destructible): void {
    const km = this.kinds.get(d.kind)!;
    km.body.setMatrixAt(d.index, d.matrix);
    km.outline.setMatrixAt(d.index, d.matrix);
    km.glow?.setMatrixAt(d.index, d.matrix);
    d.alive = true;
    d.hp = d.maxHp;
    d.collider = this.physics.addStaticBox(d.center, d.half, d.rotY, G.DESTRUCT);
    d.box = this.collision.addBox(d.center, d.half, d.rotY, d.surface, 'destructible', d, { thin: d.surface === 'sheet' || d.surface === 'glass' || d.surface === 'wood', opaque: d.kind !== 'fence4' });
  }

  damage(d: Destructible, amount: number): boolean {
    if (!d.alive) return false;
    d.hp -= amount;
    if (d.hp <= 0) this.destroy(d);
    return true;
  }

  destroy(d: Destructible): void {
    if (!d.alive) return;
    d.alive = false;
    this.destroyedCount++;
    const km = this.kinds.get(d.kind)!;
    km.body.setMatrixAt(d.index, _zero);
    km.outline.setMatrixAt(d.index, _zero);
    km.glow?.setMatrixAt(d.index, _zero);
    km.body.instanceMatrix.needsUpdate = true;
    km.outline.instanceMatrix.needsUpdate = true;
    if (km.glow) km.glow.instanceMatrix.needsUpdate = true;
    if (d.collider) this.physics.removeCollider(d.collider);
    d.collider = null;
    if (d.box) this.collision.remove(d.box);
    d.box = null;
    if (d.debris) {
      const vol = d.half.x * d.half.y * d.half.z * 8;
      this.vfx.debris(d.center, d.colors, Math.min(18, 4 + Math.round(vol * 1.5)), { size: [0.12, Math.min(0.7, 0.2 + vol * 0.03)], speed: [2, 7], up: 3 });
      dustKick(this.vfx, d.center.clone().setY(d.center.y - d.half.y), 2);
    }
    if (d.explosive) this.onExplode?.(d);
    this.onDestroyed?.(d);
  }

  /** Damages every destructible within the radius (explosions, vehicle rams). */
  radiusDamage(pos: THREE.Vector3, radius: number, damage: number): void {
    for (const d of this.items) {
      if (!d.alive) continue;
      const dist = d.center.distanceTo(pos) - Math.max(d.half.x, d.half.z) * 0.5;
      if (dist > radius) continue;
      this.damage(d, damage * (1 - Math.max(0, dist) / radius));
    }
  }

  /** Restores everything (new match). */
  reset(): void {
    for (const d of this.items) {
      if (d.alive) continue;
      this.spawn(d);
    }
    for (const km of this.kinds.values()) {
      km.body.instanceMatrix.needsUpdate = true;
      km.outline.instanceMatrix.needsUpdate = true;
      if (km.glow) km.glow.instanceMatrix.needsUpdate = true;
    }
    this.destroyedCount = 0;
  }

  aliveWithTag(tag: string): number {
    return this.items.filter((d) => d.tag === tag && d.alive).length;
  }
}
