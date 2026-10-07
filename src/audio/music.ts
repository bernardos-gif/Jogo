// Adaptive synthesized score: a lookahead step sequencer over a minor progression. Intensity
// (from the round state) opens the pad filter, raises the tempo and layers in bass, arpeggio and
// drums; low tickets push it toward the top. In menus only the slow pad plays.
import { TUNING } from '../config/tuning';
import { audio } from './engine';
import { mtof } from './synth';

const A = TUNING.audio;

/** i - VI - III - VII in D minor: root MIDI note and whether the triad is minor. */
const PROGRESSION: [number, boolean][] = [
  [50, true],
  [46, false],
  [41, false],
  [48, false],
];
const STEPS_PER_CHORD = 32;

export class Music {
  private nextT = 0;
  private step = 0;
  private chord = 0;
  intensity = 0.12;
  private target = 0.12;
  private started = false;

  setTarget(v: number): void {
    this.target = Math.max(0, Math.min(1, v));
  }

  /** Schedules the next notes (call every frame). */
  update(dt: number): void {
    const ctx = audio.ctx;
    const bus = audio.bus('music');
    if (!ctx || !bus || ctx.state !== 'running') return;
    this.intensity += (this.target - this.intensity) * Math.min(1, dt * 0.25);
    if (!this.started || this.nextT < ctx.currentTime - 0.5) {
      this.started = true;
      this.nextT = ctx.currentTime + 0.1;
    }
    const tempo = A.musicTempo[0] + (A.musicTempo[1] - A.musicTempo[0]) * this.intensity;
    const sixteenth = 60 / tempo / 4;
    while (this.nextT < ctx.currentTime + 0.25) {
      this.schedule(this.nextT, sixteenth, bus);
      this.nextT += sixteenth;
      this.step++;
      if (this.step % STEPS_PER_CHORD === 0) this.chord = (this.chord + 1) % PROGRESSION.length;
    }
  }

  private schedule(t: number, sixteenth: number, bus: GainNode): void {
    const k = this.intensity;
    const s = this.step % STEPS_PER_CHORD;
    const [root, minor] = PROGRESSION[this.chord];
    const triad = [root, root + (minor ? 3 : 4), root + 7];
    if (s === 0) this.pad(t, triad, sixteenth * STEPS_PER_CHORD, bus);
    if (k > 0.25 && (s % 4 === 0 || (k > 0.6 && s % 2 === 0))) this.bass(t, root - 12, sixteenth * 1.6, bus);
    if (k > 0.4 && s % 2 === 0) {
      const pattern = [0, 1, 2, 1, 2, 0, 1, 2];
      const n = triad[pattern[(s / 2) % pattern.length]] + 12 + (s >= 16 && k > 0.7 ? 12 : 0);
      this.pluck(t, n, bus, 0.035 + k * 0.03);
    }
    if (k > 0.5 && (s % 8 === 0 || (k > 0.75 && s % 4 === 0))) this.kick(t, bus);
    if (k > 0.65 && s % 8 === 4) this.snare(t, bus);
    if (k > 0.45 && (s % 2 === 0 || k > 0.82)) this.hat(t, bus, s % 4 === 2 ? 0.05 : 0.03);
  }

  private pad(t: number, triad: number[], dur: number, bus: GainNode): void {
    const ctx = audio.ctx!;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 600 + this.intensity * 2600;
    f.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.05, t + Math.min(1.2, dur * 0.3));
    g.gain.setValueAtTime(0.05, t + dur * 0.85);
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.4);
    f.connect(g).connect(bus);
    for (const n of triad) {
      for (const det of [-7, 7]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = mtof(n + 12);
        o.detune.value = det;
        o.connect(f);
        o.start(t);
        o.stop(t + dur + 0.5);
      }
    }
    setTimeout(() => g.disconnect(), (t - ctx.currentTime + dur + 1) * 1000);
  }

  private bass(t: number, note: number, len: number, bus: GainNode): void {
    const ctx = audio.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = mtof(note);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 260 + this.intensity * 300;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.11, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(f).connect(g).connect(bus);
    o.start(t);
    o.stop(t + len + 0.05);
  }

  private pluck(t: number, note: number, bus: GainNode, level: number): void {
    const ctx = audio.ctx!;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = mtof(note);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(level, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g).connect(bus);
    o.start(t);
    o.stop(t + 0.25);
  }

  private kick(t: number, bus: GainNode): void {
    const ctx = audio.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.13);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.3, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g).connect(bus);
    o.start(t);
    o.stop(t + 0.25);
  }

  private snare(t: number, bus: GainNode): void {
    const ctx = audio.ctx!;
    const src = audio.noiseSource('white');
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1900;
    f.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.12, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    src.connect(f).connect(g).connect(bus);
    src.start(t, Math.random());
    src.stop(t + 0.18);
  }

  private hat(t: number, bus: GainNode, level: number): void {
    const ctx = audio.ctx!;
    const src = audio.noiseSource('white');
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(level, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    src.connect(f).connect(g).connect(bus);
    src.start(t, Math.random());
    src.stop(t + 0.05);
  }
}
