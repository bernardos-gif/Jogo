// Small math helpers shared across systems.
import * as THREE from 'three';

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x);
export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const invLerp = (a: number, b: number, x: number): number => (b === a ? 0 : (x - a) / (b - a));
export const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** Frame-rate independent exponential smoothing factor. */
export const damp = (rate: number, dt: number): number => 1 - Math.exp(-rate * dt);
export const sign = (x: number): number => (x < 0 ? -1 : 1);

/** Wraps an angle to (-PI, PI]. */
export function wrapAngle(a: number): number {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

/** Shortest signed angular difference b - a. */
export function angleDiff(a: number, b: number): number {
  return wrapAngle(b - a);
}

/** Moves `a` toward `b` by at most `step`. */
export function approach(a: number, b: number, step: number): number {
  return a < b ? Math.min(b, a + step) : Math.max(b, a - step);
}

/** Forward vector for a yaw (yaw 0 faces -Z, north). */
export function yawForward(yaw: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(-Math.sin(yaw), 0, -Math.cos(yaw));
}

/** View direction for yaw and pitch (pitch positive looks up). */
export function viewDir(yaw: number, pitch: number, out = new THREE.Vector3()): THREE.Vector3 {
  const c = Math.cos(pitch);
  return out.set(-Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c);
}

/** Yaw that looks along a direction. */
export function yawOf(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

/** Compass bearing in degrees (0 north, 90 east) for a yaw. */
export function bearingDeg(yaw: number): number {
  const d = (-yaw * 180) / Math.PI;
  return ((d % 360) + 360) % 360;
}

/** Piecewise-linear lookup over sorted [x, y] points (clamped at both ends). */
export function curve(points: readonly (readonly [number, number])[], x: number): number {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i];
    if (x <= x1) {
      const [x0, y0] = points[i - 1];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return points[points.length - 1][1];
}

/** Ray vs sphere: distance along unit direction or -1. */
export function raySphere(o: THREE.Vector3, d: THREE.Vector3, c: THREE.Vector3, r: number, maxDist: number): number {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return -1;
  const s = Math.sqrt(disc);
  let t = -b - s;
  if (t < 0) t = -b + s;
  if (t < 0 || t > maxDist) return -1;
  return t;
}

/** Ray vs capsule (segment a-b, radius r): distance along unit direction or -1. */
export function rayCapsule(o: THREE.Vector3, d: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, r: number, maxDist: number): number {
  // Closest approach between the ray and the capsule axis, then a sphere test at that point.
  const bax = b.x - a.x, bay = b.y - a.y, baz = b.z - a.z;
  const oax = o.x - a.x, oay = o.y - a.y, oaz = o.z - a.z;
  const baba = bax * bax + bay * bay + baz * baz;
  const bard = bax * d.x + bay * d.y + baz * d.z;
  const baoa = bax * oax + bay * oay + baz * oaz;
  const rdoa = d.x * oax + d.y * oay + d.z * oaz;
  const oaoa = oax * oax + oay * oay + oaz * oaz;
  const A = baba - bard * bard;
  let B = baba * rdoa - baoa * bard;
  const C = baba * oaoa - baoa * baoa - r * r * baba;
  let h = B * B - A * C;
  if (h >= 0 && A > 1e-9) {
    const t = (-B - Math.sqrt(h)) / A;
    const y = baoa + t * bard;
    if (y > 0 && y < baba && t >= 0 && t <= maxDist) return t;
    // Caps
    const cx = y <= 0 ? oax : o.x - b.x, cy = y <= 0 ? oay : o.y - b.y, cz = y <= 0 ? oaz : o.z - b.z;
    B = d.x * cx + d.y * cy + d.z * cz;
    const C2 = cx * cx + cy * cy + cz * cz - r * r;
    h = B * B - C2;
    if (h > 0) {
      const t2 = -B - Math.sqrt(h);
      if (t2 >= 0 && t2 <= maxDist) return t2;
    }
    return -1;
  }
  // Ray parallel to the axis: test both caps.
  const t1 = raySphere(o, d, a, r, maxDist);
  const t2 = raySphere(o, d, b, r, maxDist);
  if (t1 < 0) return t2;
  if (t2 < 0) return t1;
  return Math.min(t1, t2);
}

/** Ray vs oriented box given by inverse world matrix and half extents. Returns distance or -1. */
export function rayObb(o: THREE.Vector3, d: THREE.Vector3, inv: THREE.Matrix4, half: THREE.Vector3, maxDist: number, outNormal?: THREE.Vector3): number {
  const e = inv.elements;
  const lox = e[0] * o.x + e[4] * o.y + e[8] * o.z + e[12];
  const loy = e[1] * o.x + e[5] * o.y + e[9] * o.z + e[13];
  const loz = e[2] * o.x + e[6] * o.y + e[10] * o.z + e[14];
  const ldx = e[0] * d.x + e[4] * d.y + e[8] * d.z;
  const ldy = e[1] * d.x + e[5] * d.y + e[9] * d.z;
  const ldz = e[2] * d.x + e[6] * d.y + e[10] * d.z;
  let tmin = -Infinity, tmax = Infinity;
  let axis = -1;
  let sgn = 1;
  const lo = [lox, loy, loz], ld = [ldx, ldy, ldz], hh = [half.x, half.y, half.z];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(ld[i]) < 1e-9) {
      if (lo[i] < -hh[i] || lo[i] > hh[i]) return -1;
      continue;
    }
    const inv1 = 1 / ld[i];
    let t1 = (-hh[i] - lo[i]) * inv1;
    let t2 = (hh[i] - lo[i]) * inv1;
    let s = -1;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      s = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      axis = i;
      sgn = s;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  if (tmax < 0) return -1;
  const t = tmin >= 0 ? tmin : 0;
  if (t > maxDist) return -1;
  if (outNormal) {
    // Local normal back to world (inverse transpose of inv == transpose of world rotation).
    const ln = [0, 0, 0];
    if (axis >= 0) ln[axis] = sgn;
    outNormal.set(e[0] * ln[0] + e[1] * ln[1] + e[2] * ln[2], e[4] * ln[0] + e[5] * ln[1] + e[6] * ln[2], e[8] * ln[0] + e[9] * ln[1] + e[10] * ln[2]).normalize();
  }
  return t;
}
