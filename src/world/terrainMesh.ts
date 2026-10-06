// Terrain mesh builder: a height grid turned into flat-shaded, vertex-colored facets drawn with
// the shared toon material (STYLE_GUIDE.md: terrain facets carry the shape, no outline).
import * as THREE from 'three';

export interface HeightGrid {
  /** Samples per side (cells + 1). */
  n: number;
  /** World size of one cell. */
  cell: number;
  /** World x/z of sample (0, 0). */
  origin: number;
  h: Float32Array;
}

export function sampleGrid(g: HeightGrid, x: number, z: number): number {
  const fx = (x - g.origin) / g.cell;
  const fz = (z - g.origin) / g.cell;
  const ix = Math.max(0, Math.min(g.n - 2, Math.floor(fx)));
  const iz = Math.max(0, Math.min(g.n - 2, Math.floor(fz)));
  const tx = Math.max(0, Math.min(1, fx - ix));
  const tz = Math.max(0, Math.min(1, fz - iz));
  const i = iz * g.n + ix;
  const h00 = g.h[i], h10 = g.h[i + 1], h01 = g.h[i + g.n], h11 = g.h[i + g.n + 1];
  // Match the triangle split used by the mesh (diagonal from (0,0) to (1,1)).
  if (tx >= tz) return h00 + (h10 - h00) * tx + (h11 - h10) * tz;
  return h00 + (h11 - h01) * tx + (h01 - h00) * tz;
}

export type ColorFn = (x: number, z: number, y: number, slope: number, out: THREE.Color) => void;

/** Builds one chunk covering grid cells [x0, x1) x [z0, z1). */
export function buildTerrainChunk(g: HeightGrid, x0: number, z0: number, x1: number, z1: number, color: ColorFn): THREE.BufferGeometry {
  const cells = (x1 - x0) * (z1 - z0);
  const pos = new Float32Array(cells * 6 * 3);
  const col = new Float32Array(cells * 6 * 3);
  const c = new THREE.Color();
  let o = 0;
  const v = (ix: number, iz: number, k: number) => {
    pos[o + k * 3] = g.origin + ix * g.cell;
    pos[o + k * 3 + 1] = g.h[iz * g.n + ix];
    pos[o + k * 3 + 2] = g.origin + iz * g.cell;
  };
  for (let iz = z0; iz < z1; iz++) {
    for (let ix = x0; ix < x1; ix++) {
      // Two triangles: (00, 11, 10) and (00, 01, 11), counter-clockwise from above.
      for (let t = 0; t < 2; t++) {
        if (t === 0) {
          v(ix, iz, 0);
          v(ix + 1, iz + 1, 1);
          v(ix + 1, iz, 2);
        } else {
          v(ix, iz, 0);
          v(ix, iz + 1, 1);
          v(ix + 1, iz + 1, 2);
        }
        // Face color from the centroid and slope.
        const ax = pos[o], ay = pos[o + 1], az = pos[o + 2];
        const bx = pos[o + 3], by = pos[o + 4], bz = pos[o + 5];
        const cx = pos[o + 6], cy = pos[o + 7], cz = pos[o + 8];
        const ux = bx - ax, uy = by - ay, uz = bz - az;
        const wx = cx - ax, wy = cy - ay, wz = cz - az;
        const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
        const nl = Math.hypot(nx, ny, nz) || 1;
        const slope = 1 - Math.abs(ny / nl);
        color((ax + bx + cx) / 3, (az + bz + cz) / 3, (ay + by + cy) / 3, slope, c);
        for (let k = 0; k < 3; k++) {
          col[o + k * 3] = c.r;
          col[o + k * 3 + 1] = c.g;
          col[o + k * 3 + 2] = c.b;
        }
        o += 9;
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}
