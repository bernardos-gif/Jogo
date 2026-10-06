// World builder: collects static solids, decorative parts, props, destructibles and traversal
// objects, then produces chunked outlined toon meshes, Rapier colliders, the bullet BVH and the
// navmesh input in one pass.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { addOutlineNormals, box, MATS, part } from '../render/toon';
import { CollisionWorld } from '../physics/collision';
import type { Physics } from '../physics/physics';
import type { Surface } from './surface';
import type { PropGeo } from '../art/props';
import { Elevator, Interactives } from './interactives';

const CHUNK = 150;

export interface DestructibleSpec {
  kind: string;
  geo: PropGeo;
  matrix: THREE.Matrix4;
  hp: number;
  surface: Surface;
  explosive: boolean;
  /** Breaks into debris (false: just disappears, e.g. glass). */
  debris: boolean;
  /** Group id (e.g. a rocket fuel tank cluster) for scripted events. */
  tag?: string;
}

export interface CoverPoint {
  pos: THREE.Vector3;
  /** Direction from the cover toward the threat side (outward normal of the cover). */
  normal: THREE.Vector3;
  /** True for full-height cover (peek around), false for low cover (peek over). */
  tall: boolean;
}

interface Solid {
  center: THREE.Vector3;
  half: THREE.Vector3;
  rotY: number;
  surface: Surface;
  thin: boolean;
  nav: boolean;
}

export class WorldBuilder {
  private chunks = new Map<string, { toon: THREE.BufferGeometry[]; glow: THREE.BufferGeometry[]; lamp: THREE.BufferGeometry[] }>();
  private solids: Solid[] = [];
  readonly destructibles: DestructibleSpec[] = [];
  readonly covers: CoverPoint[] = [];
  readonly interactives = new Interactives();
  private elevatorSpecs: { base: THREE.Vector3; height: number; half: THREE.Vector3; color: number; glow: number }[] = [];
  private nextId = 1;
  /** Extra walkable triangles for the navmesh (world space). */
  readonly navExtra: THREE.BufferGeometry[] = [];

  private chunk(x: number, z: number) {
    const k = `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
    let c = this.chunks.get(k);
    if (!c) this.chunks.set(k, (c = { toon: [], glow: [], lamp: [] }));
    return c;
  }

  /** Decorative toon geometry already in world space (gets an outline). */
  deco(g: THREE.BufferGeometry): void {
    g.computeBoundingSphere();
    const c = g.boundingSphere!.center;
    addOutlineNormals(g);
    this.chunk(c.x, c.z).toon.push(g);
  }

  glow(g: THREE.BufferGeometry, lamp = false): void {
    g.computeBoundingSphere();
    const c = g.boundingSphere!.center;
    const ch = this.chunk(c.x, c.z);
    (lamp ? ch.lamp : ch.glow).push(g);
  }

  /** A solid box: visible, collides, stops bullets, walkable for the navmesh. */
  solid(center: THREE.Vector3, half: THREE.Vector3, rotY: number, color: number, surface: Surface, opts: { thin?: boolean; nav?: boolean; visible?: boolean } = {}): void {
    if (opts.visible !== false) this.deco(box(half.x * 2, half.y * 2, half.z * 2, color, { x: center.x, y: center.y, z: center.z, ry: rotY }));
    this.solids.push({ center: center.clone(), half: half.clone(), rotY, surface, thin: opts.thin ?? false, nav: opts.nav ?? true });
  }

  /** Invisible collision for a decorative shape. */
  collider(center: THREE.Vector3, half: THREE.Vector3, rotY: number, surface: Surface, thin = false, nav = true): void {
    this.solids.push({ center: center.clone(), half: half.clone(), rotY, surface, thin, nav });
  }

  /** Places a prop (static). Collision from its half-extents unless `collide` is false. */
  prop(p: PropGeo, m: THREE.Matrix4, surface: Surface, opts: { collide?: boolean; thin?: boolean; lampGlow?: boolean } = {}): void {
    for (const g of p.toon) this.deco(g.applyMatrix4(m));
    for (const g of p.glow) this.glow(g.applyMatrix4(m), opts.lampGlow ?? true);
    if (opts.collide !== false) {
      const pos = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
      m.decompose(pos, q, s);
      const rotY = new THREE.Euler().setFromQuaternion(q, 'YXZ').y;
      const c = p.center.clone().multiply(s).applyQuaternion(q).add(pos);
      this.solids.push({ center: c, half: p.half.clone().multiply(s), rotY, surface, thin: opts.thin ?? false, nav: true });
    }
  }

  destructible(spec: DestructibleSpec): void {
    this.destructibles.push(spec);
  }

  cover(pos: THREE.Vector3, normal: THREE.Vector3, tall: boolean): void {
    this.covers.push({ pos: pos.clone(), normal: normal.clone().setY(0).normalize(), tall });
  }

  ladder(base: THREE.Vector3, height: number, yaw: number): void {
    // Visual rails and rungs; base is at the wall face, the climber stands in front of it.
    const f = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const r = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const at = base.clone().addScaledVector(f, -0.12);
    for (const s of [-0.28, 0.28]) {
      const p = at.clone().addScaledVector(r, s);
      this.deco(box(0.07, height + 1, 0.07, 0x5a5f6e, { x: p.x, y: base.y + (height + 1) / 2, z: p.z }));
    }
    for (let y = 0.3; y < height + 0.9; y += 0.32) this.deco(box(0.07, 0.05, 0.6, 0x8a90a0, { x: at.x, y: base.y + y, z: at.z, ry: yaw + Math.PI / 2 }));
    const stand = base.clone().addScaledVector(f, -0.55);
    this.interactives.ladders.push({
      id: this.nextId++,
      base: stand,
      top: stand.clone().setY(base.y + height),
      yaw,
      exit: base.clone().addScaledVector(f, 0.9).setY(base.y + height + 0.05),
    });
  }

  zipline(a: THREE.Vector3, b: THREE.Vector3): void {
    const d = new THREE.Vector3().subVectors(b, a);
    const len = d.length();
    const mid = a.clone().lerp(b, 0.5);
    const g = part(new THREE.CylinderGeometry(0.025, 0.025, len, 4), 0x2e3038);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
    g.applyMatrix4(new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)));
    this.deco(g);
    for (const p of [a, b]) {
      this.deco(box(0.3, 0.3, 0.3, 0x5a5f6e, { x: p.x, y: p.y, z: p.z }));
      this.glow(box(0.12, 0.12, 0.12, 0xffcf6a, { x: p.x, y: p.y + 0.22, z: p.z }), true);
    }
    this.interactives.ziplines.push({ id: this.nextId++, a: a.clone(), b: b.clone() });
  }

  /** Elevator car in a shaft: rises `height` from `base` (base = floor top at the bottom). */
  elevator(base: THREE.Vector3, height: number, half: THREE.Vector3, color = 0x5a5f6e, glowColor = 0x7cf0ff): void {
    this.elevatorSpecs.push({ base: base.clone(), height, half: half.clone(), color, glow: glowColor });
  }

  /** Builds meshes, colliders, BVH and elevators. Returns render root and static nav geometry. */
  finalize(scene: THREE.Scene, physics: Physics, collision: CollisionWorld): { root: THREE.Group; navGeometry: THREE.BufferGeometry } {
    const root = new THREE.Group();
    for (const c of this.chunks.values()) {
      if (c.toon.length) {
        const g = mergeGeometries(c.toon, false)!;
        g.computeBoundingSphere();
        const mesh = new THREE.Mesh(g, MATS.toon);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        const o = new THREE.Mesh(g, MATS.outline);
        o.name = 'outline';
        mesh.add(o);
        root.add(mesh);
        for (const p of c.toon) p.dispose();
      }
      if (c.glow.length) {
        const g = mergeGeometries(c.glow, false)!;
        g.computeBoundingSphere();
        root.add(new THREE.Mesh(g, MATS.glow));
      }
      if (c.lamp.length) {
        const g = mergeGeometries(c.lamp, false)!;
        g.computeBoundingSphere();
        root.add(new THREE.Mesh(g, MATS.lamp));
      }
    }
    scene.add(root);

    // Colliders, bullet BVH (with surface tags) and nav input.
    const bvhParts: THREE.BufferGeometry[] = [];
    const navParts: THREE.BufferGeometry[] = [];
    for (const s of this.solids) {
      physics.addStaticBox(s.center, s.half, s.rotY);
      const g = new THREE.BoxGeometry(s.half.x * 2, s.half.y * 2, s.half.z * 2).toNonIndexed();
      g.deleteAttribute('uv');
      g.deleteAttribute('normal');
      g.applyMatrix4(new THREE.Matrix4().makeRotationY(s.rotY).setPosition(s.center));
      const n = g.getAttribute('position').count;
      g.setAttribute('surf', new THREE.BufferAttribute(new Float32Array(n).fill(CollisionWorld.surfaceCode(s.surface, s.thin)), 1));
      bvhParts.push(g);
      if (s.nav) navParts.push(g);
    }
    for (const e of this.elevatorSpecs) {
      const mesh = new THREE.Group();
      const k = box(e.half.x * 2, e.half.y * 2, e.half.z * 2, e.color, { x: e.base.x, y: e.base.y - e.half.y, z: e.base.z });
      addOutlineNormals(k);
      const m = new THREE.Mesh(k, MATS.toon);
      m.castShadow = true;
      m.receiveShadow = true;
      m.add(Object.assign(new THREE.Mesh(k, MATS.outline), { name: 'outline' }));
      mesh.add(m);
      mesh.add(new THREE.Mesh(box(e.half.x * 2 + 0.04, 0.05, e.half.z * 2 + 0.04, e.glow, { x: e.base.x, y: e.base.y + 0.01, z: e.base.z }), MATS.glow));
      root.add(mesh);
      this.interactives.elevators.push(new Elevator(this.nextId++, e.base, e.height, e.half, mesh, physics));
    }
    const merged = bvhParts.length ? mergeGeometries(bvhParts, false)! : new THREE.BufferGeometry();
    if (!merged.getAttribute('position')) merged.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
    collision.setStatic(merged);
    const navGeometry = navParts.length ? mergeGeometries(navParts.map((g) => g.clone().deleteAttribute('surf') as unknown as THREE.BufferGeometry), false)! : new THREE.BufferGeometry();
    return { root, navGeometry };
  }
}
