// 2D gradient noise and fractal Brownian motion for procedural terrain.
import { hash2 } from '../core/rng';

function grad(ix: number, iy: number, seed: number, x: number, y: number): number {
  const a = hash2(ix, iy, seed) * Math.PI * 2;
  return Math.cos(a) * x + Math.sin(a) * y;
}
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** Perlin-style gradient noise in roughly [-0.7, 0.7]. */
export function noise2(x: number, y: number, seed = 0): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const u = fade(fx), v = fade(fy);
  const n00 = grad(ix, iy, seed, fx, fy);
  const n10 = grad(ix + 1, iy, seed, fx - 1, fy);
  const n01 = grad(ix, iy + 1, seed, fx, fy - 1);
  const n11 = grad(ix + 1, iy + 1, seed, fx - 1, fy - 1);
  const a = n00 + (n10 - n00) * u;
  const b = n01 + (n11 - n01) * u;
  return a + (b - a) * v;
}

/** Fractal Brownian motion, normalized to about [-1, 1]. */
export function fbm(x: number, y: number, octaves: number, seed = 0, lacunarity = 2, gain = 0.5): number {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += noise2(x * freq, y * freq, seed + o * 1013) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return (sum / norm) * 1.6;
}

/** Ridged multifractal (sharp crests), in [0, 1]. */
export function ridged(x: number, y: number, octaves: number, seed = 0): number {
  let sum = 0, amp = 0.5, freq = 1, prev = 1;
  for (let o = 0; o < octaves; o++) {
    let n = 1 - Math.abs(noise2(x * freq, y * freq, seed + o * 733) * 1.4);
    n *= n;
    sum += n * amp * prev;
    prev = n;
    amp *= 0.5;
    freq *= 2;
  }
  return Math.min(1, sum);
}
