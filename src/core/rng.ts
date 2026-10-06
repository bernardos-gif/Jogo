// Deterministic random numbers (mulberry32). World generation, recoil noise and AI use seeded
// streams so runs are reproducible.

export class Rng {
  private s: number;
  constructor(seed = 1) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }
  /** Uniform in [0, 1). */
  next(): number {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  /** Integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  sign(): number {
    return this.next() < 0.5 ? -1 : 1;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
  /** Approximately normal (mean 0, sd 1). */
  gauss(): number {
    return (this.next() + this.next() + this.next() + this.next() - 2) * 1.732;
  }
  fork(salt: number): Rng {
    return new Rng((this.s ^ Math.imul(salt + 1, 0x85ebca6b)) >>> 0);
  }
  get state(): number {
    return this.s;
  }
}

/** Stateless hash to [0, 1) for integer coordinates (used by noise and placement). */
export function hash2(x: number, y: number, seed = 0): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Global non-deterministic stream for cosmetic randomness (particles, sound variation). */
export const fxRng = new Rng((Date.now() ^ 0x5bd1e995) >>> 0);
