import { describe, expect, it } from 'vitest';
import { TUNING } from '../../src/config/tuning';

describe('tuning', () => {
  it('runs the simulation at 60 Hz', () => {
    expect(TUNING.loop.hz).toBe(60);
  });
  it('keeps the smoke test at 90 seconds', () => {
    expect(TUNING.test.smokeSeconds).toBe(90);
  });
});
