// Synthesis helpers: noise buffers, generated reverb impulses, the distance model and small
// scheduling utilities. The pure functions here are unit tested.
import { TUNING } from '../config/tuning';

const A = TUNING.audio;

/** Distance attenuation, low-pass cutoff and arrival delay for a source `d` meters away. */
export function distanceModel(d: number): { gain: number; cutoff: number; delay: number } {
  const ref = A.refDistance;
  const gain = d <= ref ? 1 : ref / (ref + A.rolloff * (d - ref));
  const t = Math.min(1, d / A.cutoffDistance);
  // Exponential sweep from the near to the far cutoff (air absorbs highs first).
  const cutoff = A.cutoffNear * Math.pow(A.cutoffFar / A.cutoffNear, Math.sqrt(t));
  return { gain, cutoff, delay: d / A.speedOfSound };
}

/** Deterministic xorshift noise for reproducible buffers. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) / 4294967296) * 2 - 1;
  };
}

/** White, pink (Paul Kellet's filter) or brown noise samples. */
export function noiseSamples(kind: 'white' | 'pink' | 'brown', length: number, seed = 7): Float32Array {
  const out = new Float32Array(length);
  const r = rng(seed);
  if (kind === 'white') {
    for (let i = 0; i < length; i++) out[i] = r();
    return out;
  }
  if (kind === 'pink') {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < length; i++) {
      const w = r();
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
    return out;
  }
  let last = 0;
  for (let i = 0; i < length; i++) {
    last = (last + 0.02 * r()) / 1.02;
    out[i] = last * 3.5;
  }
  return out;
}

/**
 * Generated reverb impulse: exponentially decaying noise, darker over time, with a few early
 * reflections. `brightness` 0..1 sets how quickly the highs die.
 */
export function impulseSamples(sampleRate: number, seconds: number, decay: number, brightness: number, seed = 11): [Float32Array, Float32Array] {
  const n = Math.max(1, Math.floor(sampleRate * seconds));
  const out: [Float32Array, Float32Array] = [new Float32Array(n), new Float32Array(n)];
  for (let c = 0; c < 2; c++) {
    const r = rng(seed + c * 101);
    let lp = 0;
    const ch = out[c];
    for (let i = 0; i < n; i++) {
      const t = i / n;
      // Low-pass coefficient closes over the tail (darker late reflections).
      const k = 0.05 + brightness * 0.9 * (1 - t);
      lp += (r() - lp) * k;
      ch[i] = lp * Math.pow(1 - t, decay);
    }
    // Early reflections.
    for (let e = 0; e < 6; e++) {
      const at = Math.floor(sampleRate * (0.008 + e * 0.011 + (r() + 1) * 0.004));
      if (at < n) ch[at] += (0.5 - e * 0.07) * (e % 2 ? -1 : 1);
    }
  }
  return out;
}

/** Music intensity 0..1 from the lowest team score fraction and recent combat. */
export function musicIntensity(scoreFrac: number, combat: number, inMatch: boolean): number {
  if (!inMatch) return 0.12;
  const low = Math.max(0, (TUNING.audio.lowScore - scoreFrac) / TUNING.audio.lowScore);
  return Math.min(1, 0.28 + combat * 0.35 + low * 0.45);
}

/** Equal-tempered frequency for a MIDI note. */
export function mtof(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}
