// Ray queries for bullets, line of sight and placement: three-mesh-bvh over the terrain and the
// static structures (surface tags live in a vertex attribute because the BVH reorders triangles),
// plus dynamic oriented boxes (destructibles, shields, vehicles, gadgets) and soldier hitboxes.
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { rayObb } from '../core/math';
import { SURFACES, SURFACE_CODE, type Surface } from '../world/surface';

export type HitKind = 'terrain' | 'static' | 'box' | 'soldier' | 'vehicle';
export type HitPart = 'head' | 'body' | 'limb';

export interface Hit {
  dist: number;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  surface: Surface;
  kind: HitKind;
  /** Penetrable surface (sheet metal, glass, wood panels, fences). */
  thin: boolean;
  box: DynBox | null;
  /** Soldier or vehicle object for those hit kinds. */
  ref: unknown;
  part: HitPart | null;
}

export interface DynBox {
  id: number;
  center: THREE.Vector3;
  half: THREE.Vector3;
  rotY: number;
  inv: THREE.Matrix4;
  surface: Surface;
  thin: boolean;
  kind: 'destructible' | 'shield' | 'gadget';
  ref: unknown;
  active: boolean;
  /** Blocks AI line of sight. */
  opaque: boolean;
  /** Team for shields (bullets from the owner side pass outward only; both sides block). */
  team: number;
  cells: number[];
}

/** Something that can be hit by rays (soldiers, vehicles), supplied by the match. */
export interface RayTargetSet {
  raycast(o: THREE.Vector3, d: THREE.Vector3, max: number, ignore: unknown, out: Hit): boolean;
}

export interface RayOpts {
  ignore?: unknown;
  /** Skip soldiers and vehicles (pure world geometry). */
  worldOnly?: boolean;
  /** Ignore non-opaque boxes (line of sight through shields and fences). */
  sight?: boolean;
  /** Skip a specific team's shields (bullets fired by that team). */
  shieldTeam?: number;
}

const CELL = 16;
const _ray = new THREE.Ray();
const _n = new THREE.Vector3();
const THIN_SURFACES: Surface[] = ['sheet', 'glass', 'wood'];

export function makeHit(): Hit {
  return { dist: Infinity, point: new THREE.Vector3(), normal: new THREE.Vector3(0, 1, 0), surface: 'concrete', kind: 'static', thin: false, box: null, ref: null, part: null };
}

export class CollisionWorld {
  private terrainBvh: MeshBVH | null = null;
  private terrainSurface: (x: number, z: number) => Surface = () => 'dirt';
  private staticBvh: MeshBVH | null = null;
  private staticGeo: THREE.BufferGeometry | null = null;
  private boxes: DynBox[] = [];
  private grid = new Map<number, DynBox[]>();
  private nextId = 1;
  targets: RayTargetSet[] = [];
  private stamp = 0;
  private stamps = new Map<number, number>();
  private tmp = makeHit();

  setTerrain(geo: THREE.BufferGeometry, surface: (x: number, z: number) => Surface): void {
    this.terrainBvh = new MeshBVH(geo, { targetLeafSize: 12 });
    this.terrainSurface = surface;
  }

  /** Static geometry with a per-vertex `surf` attribute (surface code; +100 marks thin). */
  setStatic(geo: THREE.BufferGeometry): void {
    this.staticGeo = geo;
    this.staticBvh = geo.getAttribute('position').count > 0 ? new MeshBVH(geo, { targetLeafSize: 10 }) : null;
  }

  addBox(center: THREE.Vector3, half: THREE.Vector3, rotY: number, surface: Surface, kind: DynBox['kind'], ref: unknown, opts: { thin?: boolean; opaque?: boolean; team?: number } = {}): DynBox {
    const m = new THREE.Matrix4().makeRotationY(rotY).setPosition(center);
    const b: DynBox = {
      id: this.nextId++,
      center: center.clone(),
      half: half.clone(),
      rotY,
      inv: m.invert(),
      surface,
      thin: opts.thin ?? THIN_SURFACES.includes(surface),
      kind,
      ref,
      active: true,
      opaque: opts.opaque ?? true,
      team: opts.team ?? -1,
      cells: [],
    };
    this.insert(b);
    return b;
  }

  /** Moves or rotates a dynamic box (gadgets that are carried or placed). */
  updateBox(b: DynBox, center: THREE.Vector3, rotY: number): void {
    this.remove(b);
    b.center.copy(center);
    b.rotY = rotY;
    b.inv.makeRotationY(rotY).setPosition(center).invert();
    b.active = true;
    this.insert(b);
  }

  private insert(b: DynBox): void {
    const r = Math.hypot(b.half.x, b.half.z);
    const x0 = Math.floor((b.center.x - r) / CELL), x1 = Math.floor((b.center.x + r) / CELL);
    const z0 = Math.floor((b.center.z - r) / CELL), z1 = Math.floor((b.center.z + r) / CELL);
    b.cells = [];
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++) {
        const k = (x + 1000) * 4096 + (z + 1000);
        let list = this.grid.get(k);
        if (!list) this.grid.set(k, (list = []));
        list.push(b);
        b.cells.push(k);
      }
    this.boxes.push(b);
  }

  remove(b: DynBox): void {
    b.active = false;
    for (const k of b.cells) {
      const list = this.grid.get(k);
      if (!list) continue;
      const i = list.indexOf(b);
      if (i >= 0) list.splice(i, 1);
    }
    b.cells = [];
    const i = this.boxes.indexOf(b);
    if (i >= 0) this.boxes.splice(i, 1);
  }

  /** Nearest hit along a ray, or null. */
  raycast(o: THREE.Vector3, d: THREE.Vector3, maxDist: number, opts: RayOpts = {}, out: Hit = makeHit()): Hit | null {
    let best = maxDist;
    let found = false;
    _ray.origin.copy(o);
    _ray.direction.copy(d);
    if (this.terrainBvh) {
      const h = this.terrainBvh.raycastFirst(_ray, THREE.DoubleSide, 0, best);
      if (h && h.distance < best) {
        best = h.distance;
        found = true;
        out.dist = h.distance;
        out.point.copy(h.point);
        out.normal.copy(h.face?.normal ?? _n.set(0, 1, 0));
        if (out.normal.dot(d) > 0) out.normal.negate();
        out.surface = this.terrainSurface(h.point.x, h.point.z);
        out.kind = 'terrain';
        out.thin = false;
        out.box = null;
        out.ref = null;
        out.part = null;
      }
    }
    if (this.staticBvh && this.staticGeo) {
      const h = this.staticBvh.raycastFirst(_ray, THREE.DoubleSide, 0, best);
      if (h && h.distance < best && h.face) {
        best = h.distance;
        found = true;
        const code = (this.staticGeo.getAttribute('surf') as THREE.BufferAttribute).getX(h.face.a);
        out.dist = h.distance;
        out.point.copy(h.point);
        out.normal.copy(h.face.normal);
        if (out.normal.dot(d) > 0) out.normal.negate();
        out.thin = code >= 100;
        out.surface = SURFACES[code % 100] ?? 'concrete';
        out.kind = 'static';
        out.box = null;
        out.ref = null;
        out.part = null;
      }
    }
    // Dynamic boxes along the ray: walk the grid cells covered by the segment.
    this.stamp++;
    const steps = Math.ceil(best / (CELL * 0.5)) + 1;
    for (let s = 0; s <= steps; s++) {
      const t = Math.min(best, (s / steps) * best);
      const px = o.x + d.x * t, pz = o.z + d.z * t;
      const cx = Math.floor(px / CELL), cz = Math.floor(pz / CELL);
      for (let ox = -1; ox <= 1; ox++)
        for (let oz = -1; oz <= 1; oz++) {
          const list = this.grid.get((cx + ox + 1000) * 4096 + (cz + oz + 1000));
          if (!list) continue;
          for (const b of list) {
            if (!b.active || this.stamps.get(b.id) === this.stamp) continue;
            this.stamps.set(b.id, this.stamp);
            if (opts.sight && !b.opaque) continue;
            if (b.kind === 'shield' && opts.shieldTeam !== undefined && b.team === opts.shieldTeam) continue;
            if (b.ref !== null && b.ref === opts.ignore) continue;
            const dist = rayObb(o, d, b.inv, b.half, best, _n);
            if (dist >= 0 && dist < best) {
              best = dist;
              found = true;
              out.dist = dist;
              out.point.copy(o).addScaledVector(d, dist);
              out.normal.copy(_n);
              out.surface = b.surface;
              out.kind = 'box';
              out.thin = b.thin;
              out.box = b;
              out.ref = b.ref;
              out.part = null;
            }
          }
        }
    }
    if (!opts.worldOnly) {
      for (const t of this.targets) {
        const tmp = this.tmp;
        if (t.raycast(o, d, best, opts.ignore, tmp) && tmp.dist < best) {
          best = tmp.dist;
          found = true;
          out.dist = tmp.dist;
          out.point.copy(tmp.point);
          out.normal.copy(tmp.normal);
          out.surface = tmp.surface;
          out.kind = tmp.kind;
          out.thin = false;
          out.box = null;
          out.ref = tmp.ref;
          out.part = tmp.part;
        }
      }
    }
    return found ? out : null;
  }

  /** True when the straight line between a and b is blocked by world geometry. */
  blocked(a: THREE.Vector3, b: THREE.Vector3, sight = true): boolean {
    _n.subVectors(b, a);
    const len = _n.length();
    if (len < 1e-4) return false;
    const dir = _n.multiplyScalar(1 / len).clone();
    return this.raycast(a, dir, len - 0.05, { worldOnly: true, sight }) !== null;
  }

  /** Highest static/terrain surface below a point (for placing gadgets and drops). */
  groundBelow(x: number, y: number, z: number, max = 200): number | null {
    const o = new THREE.Vector3(x, y, z);
    const h = this.raycast(o, new THREE.Vector3(0, -1, 0), max, { worldOnly: true });
    return h ? h.point.y : null;
  }

  static surfaceCode(s: Surface, thin: boolean): number {
    return SURFACE_CODE[s] + (thin ? 100 : 0);
  }
}
