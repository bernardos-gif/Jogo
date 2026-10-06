// Navigation: a recast tiled navmesh built at load (with off-mesh links for ladders, ziplines and
// elevators), and a grid A* fallback used when the navmesh build fails.
import * as THREE from 'three';
import { init as initRecast, NavMeshQuery, type NavMesh } from 'recast-navigation';
import { generateTiledNavMesh } from 'recast-navigation/generators';
import type { Interactives } from './interactives';

export interface PathFinder {
  readonly kind: 'navmesh' | 'grid';
  /** Fills `out` with waypoints from a to b (including b). Returns false when no path exists. */
  findPath(a: THREE.Vector3, b: THREE.Vector3, out: THREE.Vector3[]): boolean;
  /** Nearest walkable point. */
  closest(p: THREE.Vector3, out: THREE.Vector3): boolean;
  /** Random walkable point within a radius. */
  randomAround(p: THREE.Vector3, r: number, out: THREE.Vector3, rnd: () => number): boolean;
}

export interface NavInput {
  positions: Float32Array;
  indices: Uint32Array;
  interactives: Interactives;
  bounds: [[number, number, number], [number, number, number]];
}

const HALF = { x: 3, y: 12, z: 3 };

class RecastNav implements PathFinder {
  readonly kind = 'navmesh' as const;
  private query: NavMeshQuery;
  constructor(readonly navMesh: NavMesh) {
    this.query = new NavMeshQuery(navMesh);
  }
  findPath(a: THREE.Vector3, b: THREE.Vector3, out: THREE.Vector3[]): boolean {
    const r = this.query.computePath(a, b, { halfExtents: HALF, maxPathPolys: 1024, maxStraightPathPoints: 256 });
    out.length = 0;
    if (!r.success || !r.path.length) return false;
    for (const p of r.path) out.push(new THREE.Vector3(p.x, p.y, p.z));
    return true;
  }
  closest(p: THREE.Vector3, out: THREE.Vector3): boolean {
    const r = this.query.findClosestPoint(p, { halfExtents: HALF });
    if (!r.success) return false;
    out.set(r.point.x, r.point.y, r.point.z);
    return true;
  }
  randomAround(p: THREE.Vector3, r: number, out: THREE.Vector3): boolean {
    const res = this.query.findRandomPointAroundCircle(p, r, { halfExtents: HALF });
    if (!res.success) return false;
    out.set(res.randomPoint.x, res.randomPoint.y, res.randomPoint.z);
    return true;
  }
}

/** Grid A* over terrain walkability (fallback). */
export class GridNav implements PathFinder {
  readonly kind = 'grid' as const;
  private n: number;
  private walk: Uint8Array;
  private g: Float32Array;
  private f: Float32Array;
  private from: Int32Array;
  private stamp: Uint32Array;
  private closedStamp: Uint32Array;
  private gen = 1;

  constructor(
    private origin: number,
    private cell: number,
    size: number,
    private height: (x: number, z: number) => number,
    blocked: (x: number, z: number) => boolean,
  ) {
    this.n = Math.ceil(size / cell);
    const n = this.n;
    this.walk = new Uint8Array(n * n);
    for (let iz = 0; iz < n; iz++)
      for (let ix = 0; ix < n; ix++) {
        const x = origin + (ix + 0.5) * cell, z = origin + (iz + 0.5) * cell;
        const h = height(x, z);
        const slope = Math.max(Math.abs(height(x + cell, z) - h), Math.abs(height(x, z + cell) - h)) / cell;
        this.walk[iz * n + ix] = slope < 0.9 && !blocked(x, z) ? 1 : 0;
      }
    this.g = new Float32Array(n * n);
    this.f = new Float32Array(n * n);
    this.from = new Int32Array(n * n);
    this.stamp = new Uint32Array(n * n);
    this.closedStamp = new Uint32Array(n * n);
  }

  private idx(p: THREE.Vector3): number {
    const ix = Math.max(0, Math.min(this.n - 1, Math.floor((p.x - this.origin) / this.cell)));
    const iz = Math.max(0, Math.min(this.n - 1, Math.floor((p.z - this.origin) / this.cell)));
    return iz * this.n + ix;
  }

  private nearestWalkable(i: number): number {
    if (this.walk[i]) return i;
    const n = this.n;
    const ix = i % n, iz = Math.floor(i / n);
    for (let r = 1; r < 12; r++)
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          const x = ix + dx, z = iz + dz;
          if (x < 0 || z < 0 || x >= n || z >= n) continue;
          if (this.walk[z * n + x]) return z * n + x;
        }
    return -1;
  }

  findPath(a: THREE.Vector3, b: THREE.Vector3, out: THREE.Vector3[]): boolean {
    out.length = 0;
    const n = this.n;
    const s = this.nearestWalkable(this.idx(a));
    const t = this.nearestWalkable(this.idx(b));
    if (s < 0 || t < 0) return false;
    const gen = ++this.gen;
    const heap: number[] = [];
    const push = (i: number) => {
      heap.push(i);
      let k = heap.length - 1;
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (this.f[heap[p]] <= this.f[heap[k]]) break;
        [heap[p], heap[k]] = [heap[k], heap[p]];
        k = p;
      }
    };
    const pop = (): number => {
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let k = 0;
        for (;;) {
          const l = k * 2 + 1, r = l + 1;
          let m = k;
          if (l < heap.length && this.f[heap[l]] < this.f[heap[m]]) m = l;
          if (r < heap.length && this.f[heap[r]] < this.f[heap[m]]) m = r;
          if (m === k) break;
          [heap[m], heap[k]] = [heap[k], heap[m]];
          k = m;
        }
      }
      return top;
    };
    const tx = t % n, tz = Math.floor(t / n);
    const hfn = (i: number) => Math.hypot((i % n) - tx, Math.floor(i / n) - tz);
    this.stamp[s] = gen;
    this.g[s] = 0;
    this.f[s] = hfn(s);
    this.from[s] = -1;
    push(s);
    let found = false;
    let expanded = 0;
    while (heap.length && expanded < 60000) {
      const c = pop();
      if (this.closedStamp[c] === gen) continue;
      this.closedStamp[c] = gen;
      expanded++;
      if (c === t) {
        found = true;
        break;
      }
      const cx = c % n, cz = Math.floor(c / n);
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const x = cx + dx, z = cz + dz;
          if (x < 0 || z < 0 || x >= n || z >= n) continue;
          const ni = z * n + x;
          if (!this.walk[ni] || this.closedStamp[ni] === gen) continue;
          const cost = this.g[c] + (dx && dz ? 1.4142 : 1);
          if (this.stamp[ni] !== gen || cost < this.g[ni]) {
            this.stamp[ni] = gen;
            this.g[ni] = cost;
            this.f[ni] = cost + hfn(ni);
            this.from[ni] = c;
            push(ni);
          }
        }
    }
    if (!found) return false;
    const cells: number[] = [];
    for (let c = t; c >= 0; c = this.from[c]) cells.push(c);
    cells.reverse();
    // Keep every 3rd cell plus corners.
    for (let i = 0; i < cells.length; i++) {
      if (i % 3 !== 0 && i !== cells.length - 1) continue;
      const c = cells[i];
      const x = this.origin + ((c % n) + 0.5) * this.cell, z = this.origin + (Math.floor(c / n) + 0.5) * this.cell;
      out.push(new THREE.Vector3(x, this.height(x, z), z));
    }
    out.push(b.clone());
    return true;
  }

  closest(p: THREE.Vector3, out: THREE.Vector3): boolean {
    const i = this.nearestWalkable(this.idx(p));
    if (i < 0) return false;
    const x = this.origin + ((i % this.n) + 0.5) * this.cell, z = this.origin + (Math.floor(i / this.n) + 0.5) * this.cell;
    out.set(x, this.height(x, z), z);
    return true;
  }

  randomAround(p: THREE.Vector3, r: number, out: THREE.Vector3, rnd: () => number): boolean {
    for (let k = 0; k < 10; k++) {
      const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * r;
      const q = new THREE.Vector3(p.x + Math.cos(a) * d, 0, p.z + Math.sin(a) * d);
      if (this.walk[this.idx(q)]) {
        out.set(q.x, this.height(q.x, q.z), q.z);
        return true;
      }
    }
    return this.closest(p, out);
  }
}

/** Builds the recast navmesh; returns null on failure (caller falls back to GridNav). */
export async function buildNavMesh(input: NavInput): Promise<PathFinder | null> {
  try {
    await initRecast();
    const off = [];
    for (const l of input.interactives.ladders) off.push({ startPosition: { x: l.base.x, y: l.base.y, z: l.base.z }, endPosition: { x: l.exit.x, y: l.exit.y, z: l.exit.z }, radius: 0.6, bidirectional: true });
    for (const z of input.interactives.ziplines) {
      const hi = z.a.y >= z.b.y ? z.a : z.b, lo = z.a.y >= z.b.y ? z.b : z.a;
      off.push({ startPosition: { x: hi.x, y: hi.y - 1.9, z: hi.z }, endPosition: { x: lo.x, y: lo.y - 1.9, z: lo.z }, radius: 1.2, bidirectional: false });
    }
    for (const e of input.interactives.elevators) off.push({ startPosition: { x: e.base.x, y: e.base.y, z: e.base.z }, endPosition: { x: e.base.x, y: e.base.y + e.height, z: e.base.z }, radius: 1.2, bidirectional: true });
    const cs = 0.5, ch = 0.25;
    const r = generateTiledNavMesh(input.positions, input.indices, {
      cs,
      ch,
      tileSize: 64,
      walkableSlopeAngle: 46,
      walkableHeight: Math.ceil(1.8 / ch),
      walkableClimb: Math.floor(0.5 / ch),
      walkableRadius: Math.ceil(0.35 / cs),
      maxEdgeLen: 24,
      maxSimplificationError: 1.3,
      minRegionArea: 12,
      mergeRegionArea: 24,
      detailSampleDist: 6,
      detailSampleMaxError: 1,
      offMeshConnections: off,
      bounds: input.bounds,
    });
    if (!r.success) {
      console.warn(`navmesh build failed: ${r.error}`);
      return null;
    }
    return new RecastNav(r.navMesh);
  } catch (e) {
    console.warn('navmesh unavailable, using grid A*', e);
    return null;
  }
}
