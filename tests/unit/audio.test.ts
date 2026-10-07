import { describe, expect, it } from 'vitest';
import { distanceModel, noiseSamples, impulseSamples, musicIntensity, mtof } from '../../src/audio/synth';
import { scoringTeam, skirmishWinner } from '../../src/modes/skirmish';
import { TUNING } from '../../src/config/tuning';

const A = TUNING.audio;

describe('audio synthesis', () => {
  it('distance model: quieter, darker and later with distance', () => {
    const near = distanceModel(2);
    const mid = distanceModel(60);
    const far = distanceModel(400);
    expect(near.gain).toBe(1);
    expect(mid.gain).toBeLessThan(near.gain);
    expect(far.gain).toBeLessThan(mid.gain);
    expect(mid.cutoff).toBeLessThan(near.cutoff);
    expect(far.cutoff).toBeLessThan(mid.cutoff);
    expect(far.cutoff).toBeGreaterThanOrEqual(A.cutoffFar - 1);
    expect(far.delay).toBeCloseTo(400 / A.speedOfSound, 6);
  });

  it('noise colors: brown is smoother than white, pink stays bounded', () => {
    const n = 20000;
    const white = noiseSamples('white', n, 3);
    const brown = noiseSamples('brown', n, 3);
    const pink = noiseSamples('pink', n, 3);
    const roughness = (a: Float32Array) => {
      let s = 0;
      for (let i = 1; i < a.length; i++) s += Math.abs(a[i] - a[i - 1]);
      return s / a.length;
    };
    expect(roughness(brown)).toBeLessThan(roughness(white) * 0.2);
    for (const v of pink) expect(Math.abs(v)).toBeLessThan(2);
    // Deterministic for a seed.
    expect(noiseSamples('white', 8, 9)).toEqual(noiseSamples('white', 8, 9));
  });

  it('generated impulses decay', () => {
    const [l] = impulseSamples(8000, 1, 3, 0.5);
    const energy = (from: number, to: number) => {
      let s = 0;
      for (let i = from; i < to; i++) s += l[i] * l[i];
      return s;
    };
    expect(energy(l.length * 0.9, l.length)).toBeLessThan(energy(0, l.length * 0.1) * 0.05);
  });

  it('music intensity: calm in menus, rising with combat and low tickets', () => {
    expect(musicIntensity(1, 1, false)).toBeLessThan(0.2);
    const calm = musicIntensity(1, 0, true);
    expect(musicIntensity(1, 1, true)).toBeGreaterThan(calm);
    expect(musicIntensity(0.05, 0, true)).toBeGreaterThan(calm + 0.3);
    expect(musicIntensity(0, 1, true)).toBeLessThanOrEqual(1);
  });

  it('note frequencies', () => {
    expect(mtof(69)).toBeCloseTo(440, 6);
    expect(mtof(81)).toBeCloseTo(880, 6);
  });
});

describe('skirmish rules', () => {
  it('kills go to the killer team; suicides and environment deaths go to the other team', () => {
    expect(scoringTeam(0, 1)).toBe(1);
    expect(scoringTeam(1, 1)).toBe(0);
    expect(scoringTeam(0, null)).toBe(1);
  });

  it('the leader wins; a tie is a draw', () => {
    expect(skirmishWinner([75, 60])).toBe(0);
    expect(skirmishWinner([40, 75])).toBe(1);
    expect(skirmishWinner([30, 30])).toBe(-1);
  });
});
