// Terrain: a height grid from a generator, rendered as flat-shaded toon chunks (frustum culled),
// with height / normal / surface lookups, a Rapier heightfield and a BVH for bullets.
import * as THREE from 'three';
import { MATS } from '../render/toon';
import { buildTerrainChunk, sampleGrid, type ColorFn, type HeightGrid } from './terrainMesh';
import type { Surface } from './surface';
import type { Physics } from '../physics/physics';
import type { CollisionWorld } from '../physics/collision';

export interface TerrainSpec {
  size: number;
  cell: number;
  height: (x: number, z: number) => number;
  color: ColorFn;
  surface: (x: number, z: number) => Surface;
  chunkCells: number;
}

export class Terrain {
  readonly grid: HeightGrid;
  readonly group = new THREE.Group();
  readonly surfaceAt: (x: number, z: number) => Surface;
  readonly size: number;

  constructor(spec: TerrainSpec) {
    const n = Math.round(spec.size / spec.cell) + 1;
    const origin = -spec.size / 2;
    const h = new Float32Array(n * n);
    for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) h[iz * n + ix] = spec.height(origin + ix * spec.cell, origin + iz * spec.cell);
    this.grid = { n, cell: spec.cell, origin, h };
    this.surfaceAt = spec.surface;
    this.size = spec.size;
    const cells = n - 1;
    const step = spec.chunkCells;
    for (let z0 = 0; z0 < cells; z0 += step)
      for (let x0 = 0; x0 < cells; x0 += step) {
        const geo = buildTerrainChunk(this.grid, x0, z0, Math.min(cells, x0 + step), Math.min(cells, z0 + step), spec.color);
        const mesh = new THREE.Mesh(geo, MATS.toon);
        mesh.receiveShadow = true;
        mesh.castShadow = false;
        this.group.add(mesh);
      }
  }

  heightAt(x: number, z: number): number {
    return sampleGrid(this.grid, x, z);
  }

  normalAt(x: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
    const e = this.grid.cell * 0.5;
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return out.set(-hx, 2 * e, -hz).normalize();
  }

  /** Indexed geometry of the whole terrain (for the bullet BVH and the navmesh). */
  indexedGeometry(): THREE.BufferGeometry {
    const g = this.grid;
    const pos = new Float32Array(g.n * g.n * 3);
    for (let iz = 0; iz < g.n; iz++)
      for (let ix = 0; ix < g.n; ix++) {
        const i = iz * g.n + ix;
        pos[i * 3] = g.origin + ix * g.cell;
        pos[i * 3 + 1] = g.h[i];
        pos[i * 3 + 2] = g.origin + iz * g.cell;
      }
    const cells = g.n - 1;
    const idx = new Uint32Array(cells * cells * 6);
    let o = 0;
    for (let iz = 0; iz < cells; iz++)
      for (let ix = 0; ix < cells; ix++) {
        const a = iz * g.n + ix, b = a + 1, c = a + g.n, d = c + 1;
        idx[o++] = a;
        idx[o++] = d;
        idx[o++] = b;
        idx[o++] = a;
        idx[o++] = c;
        idx[o++] = d;
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    return geo;
  }

  install(scene: THREE.Scene, physics: Physics, collision: CollisionWorld): void {
    scene.add(this.group);
    physics.addHeightfield(this.grid);
    collision.setTerrain(this.indexedGeometry(), this.surfaceAt);
  }
}
