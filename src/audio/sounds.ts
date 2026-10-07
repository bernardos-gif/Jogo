// Sound recipes, all synthesized: layered gunshots (transient, body, tail) per weapon with energy
// zaps for pulse weapons, vehicle mounts, impacts by material, bullet cracks and whizzes,
// explosions, footsteps by surface, reload and handling clicks, hit and kill confirms, damage
// thumps, lightning and thunder, UI blips and tonal stingers.
import * as THREE from 'three';
import { TUNING } from '../config/tuning';
import { audio, type Spot } from './engine';
import { mtof } from './synth';
import type { EnergyFamily, WeaponCategory } from '../config/content';
import type { Surface } from '../world/surface';

const H = TUNING.audio.hear;

interface ShotProfile {
  body: number;
  punch: number;
  tail: number;
  level: number;
}

const PROFILES: Record<WeaponCategory, ShotProfile> = {
  ar: { body: 950, punch: 115, tail: 0.55, level: 0.9 },
  smg: { body: 1350, punch: 140, tail: 0.38, level: 0.72 },
  lmg: { body: 780, punch: 95, tail: 0.7, level: 1 },
  dmr: { body: 680, punch: 86, tail: 0.95, level: 1.1 },
  sniper: { body: 540, punch: 70, tail: 1.5, level: 1.35 },
  shotgun: { body: 500, punch: 68, tail: 1, level: 1.3 },
  sidearm: { body: 1150, punch: 130, tail: 0.42, level: 0.68 },
  launcher: { body: 320, punch: 55, tail: 1.3, level: 1.2 },
};

/** Attack-decay envelope on a gain param. */
function env(p: AudioParam, t: number, peak: number, attack: number, decay: number): void {
  p.setValueAtTime(0.0001, t);
  p.linearRampToValueAtTime(peak, t + attack);
  p.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

function noise(s: Spot, kind: 'white' | 'pink' | 'brown', t: number, dur: number, filter: BiquadFilterType, freq: number, q: number, peak: number, attack: number, decay: number, offset = Math.random()): void {
  const ctx = audio.ctx!;
  const src = audio.noiseSource(kind);
  const f = ctx.createBiquadFilter();
  f.type = filter;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  env(g.gain, t, peak, attack, decay);
  src.connect(f).connect(g).connect(s.out);
  src.start(t, offset * 1.5);
  src.stop(t + dur);
}

function tone(s: Spot, type: OscillatorType, t: number, f0: number, f1: number, sweep: number, peak: number, attack: number, decay: number): void {
  const ctx = audio.ctx!;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + sweep);
  const g = ctx.createGain();
  env(g.gain, t, peak, attack, decay);
  o.connect(g).connect(s.out);
  o.start(t);
  o.stop(t + attack + decay + 0.05);
}

// ---- Weapons ---------------------------------------------------------------------------------
export function gunshot(cat: WeaponCategory, energy: EnergyFamily, suppressed: boolean, pos: THREE.Vector3 | null, own: boolean): void {
  const P = PROFILES[cat];
  const range = suppressed ? H.shotSuppressed : H.shot;
  const s = own ? audio.flat(0.55 * P.level, 'sfx', 0.25) : audio.spot(pos!, range, 0.9 * P.level, suppressed ? 0.1 : 0.45);
  if (!s) return;
  const t = s.t0;
  const far = !own && s.d > TUNING.audio.farShot;
  const lvl = suppressed ? 0.35 : 1;
  const energyShot = energy === 'cyan' || energy === 'violet';
  if (!far) {
    // Transient: a hard broadband click (softer on energy weapons).
    noise(s, 'white', t, 0.03, 'highpass', suppressed ? 4000 : 2500, 0.7, (energyShot ? 0.35 : 0.9) * lvl, 0.0008, 0.018);
    // Low punch.
    tone(s, 'sine', t, P.punch * 1.8, P.punch, 0.06, (suppressed ? 0.25 : 0.8) * lvl, 0.002, 0.09);
  }
  // Body: band-limited pink noise.
  noise(s, 'pink', t, 0.25, 'bandpass', suppressed ? P.body * 1.6 : P.body, 0.9, (far ? 0.9 : 1.1) * lvl, 0.002, suppressed ? 0.05 : 0.11);
  // Tail: low rumble that rings out (most of what you hear from far away).
  if (!suppressed) noise(s, 'brown', t, P.tail + 0.1, 'lowpass', far ? 700 : 1300, 0.5, far ? 0.9 : 0.55, 0.004, P.tail);
  if (energyShot) {
    if (energy === 'cyan') tone(s, 'square', t, 2400, 420, 0.09, 0.16 * lvl, 0.001, 0.1);
    else tone(s, 'sawtooth', t, 1100, 160, 0.14, 0.18 * lvl, 0.001, 0.14);
  }
  if (cat === 'launcher') noise(s, 'pink', t, 0.7, 'bandpass', 900, 0.6, 0.6, 0.02, 0.6);
  s.done(P.tail + 0.4);
}

/** Vehicle weapons. */
export function mountShot(kind: string, pos: THREE.Vector3): void {
  const big = kind === 'cannon';
  const s = audio.spot(pos, big ? H.explosion : H.shot, big ? 1.4 : kind === 'rockets' ? 0.8 : 0.75, big ? 0.6 : 0.35);
  if (!s) return;
  const t = s.t0;
  switch (kind) {
    case 'cannon':
      noise(s, 'white', t, 0.05, 'highpass', 1800, 0.7, 1, 0.001, 0.03);
      tone(s, 'sine', t, 120, 38, 0.25, 1.2, 0.003, 0.35);
      noise(s, 'brown', t, 1.8, 'lowpass', 900, 0.6, 1, 0.005, 1.6);
      s.done(2);
      return;
    case 'rockets':
      noise(s, 'pink', t, 0.5, 'bandpass', 1200, 0.8, 0.8, 0.005, 0.4);
      tone(s, 'sawtooth', t, 300, 140, 0.3, 0.12, 0.005, 0.3);
      s.done(0.6);
      return;
    case 'coax':
      tone(s, 'square', t, 2000, 600, 0.06, 0.14, 0.001, 0.07);
      noise(s, 'pink', t, 0.08, 'bandpass', 1800, 1, 0.5, 0.001, 0.05);
      s.done(0.15);
      return;
    case 'chin':
      tone(s, 'sine', t, 160, 70, 0.05, 0.7, 0.002, 0.08);
      noise(s, 'pink', t, 0.3, 'bandpass', 700, 0.8, 0.9, 0.002, 0.12);
      s.done(0.4);
      return;
    default:
      // Miniguns and the door gun: a short buzzy burst.
      noise(s, 'pink', t, 0.08, 'bandpass', 1500, 0.9, 0.8, 0.001, 0.05);
      tone(s, 'sawtooth', t, 220, 160, 0.05, 0.12, 0.001, 0.06);
      s.done(0.15);
  }
}

export function reload(pos: THREE.Vector3, own: boolean): void {
  const s = own ? audio.flat(0.35, 'sfx') : audio.spot(pos, H.reload, 0.4, 0.1);
  if (!s) return;
  noise(s, 'white', s.t0, 0.04, 'bandpass', 2600, 2, 0.6, 0.001, 0.03);
  noise(s, 'pink', s.t0 + 0.32, 0.12, 'bandpass', 1400, 1.5, 0.5, 0.01, 0.08);
  noise(s, 'white', s.t0 + 0.62, 0.05, 'bandpass', 3200, 2.5, 0.7, 0.001, 0.03);
  s.done(0.8);
}

export function dryFire(): void {
  const s = audio.flat(0.3, 'sfx');
  if (!s) return;
  noise(s, 'white', s.t0, 0.03, 'bandpass', 3800, 3, 0.7, 0.001, 0.02);
  s.done(0.1);
}

export function handling(kind: 'throw' | 'melee' | 'mode' | 'swap', pos: THREE.Vector3 | null): void {
  const s = pos ? audio.spot(pos, 25, 0.5, 0.1) : audio.flat(0.35, 'sfx');
  if (!s) return;
  if (kind === 'throw') noise(s, 'pink', s.t0, 0.3, 'bandpass', 900, 1.2, 0.5, 0.05, 0.2);
  else if (kind === 'melee') {
    noise(s, 'pink', s.t0, 0.15, 'lowpass', 600, 0.7, 0.9, 0.002, 0.1);
    tone(s, 'sine', s.t0, 140, 60, 0.08, 0.6, 0.002, 0.1);
  } else noise(s, 'white', s.t0, 0.03, 'bandpass', kind === 'mode' ? 3000 : 2000, 2, 0.6, 0.001, 0.025);
  s.done(0.4);
}

// ---- Bullets ---------------------------------------------------------------------------------
export function impact(surface: Surface, energy: EnergyFamily, pos: THREE.Vector3): void {
  const s = audio.spot(pos, H.impact, 0.55, 0.15);
  if (!s) return;
  const t = s.t0;
  switch (surface) {
    case 'metal':
    case 'sheet':
    case 'armor':
      tone(s, 'triangle', t, 2600 + Math.random() * 1600, 2200, 0.1, 0.25, 0.001, 0.12);
      noise(s, 'white', t, 0.04, 'highpass', 3000, 0.8, 0.5, 0.001, 0.02);
      if (Math.random() < 0.18) tone(s, 'sine', t + 0.02, 3800, 1200, 0.35, 0.08, 0.01, 0.35);
      break;
    case 'glass':
      noise(s, 'white', t, 0.12, 'highpass', 4500, 0.7, 0.6, 0.001, 0.08);
      tone(s, 'sine', t, 5200, 4800, 0.1, 0.12, 0.001, 0.15);
      break;
    case 'wood':
      noise(s, 'pink', t, 0.08, 'bandpass', 520, 1.4, 0.8, 0.001, 0.05);
      break;
    case 'water':
      noise(s, 'white', t, 0.3, 'lowpass', 2200, 0.7, 0.5, 0.005, 0.22);
      break;
    case 'energy':
      tone(s, 'sine', t, 1400, 900, 0.1, 0.2, 0.001, 0.12);
      noise(s, 'white', t, 0.1, 'bandpass', 5000, 2, 0.3, 0.001, 0.08);
      break;
    case 'concrete':
      noise(s, 'white', t, 0.06, 'bandpass', 2200, 1, 0.8, 0.001, 0.04);
      break;
    default:
      noise(s, 'pink', t, 0.08, 'bandpass', surface === 'sand' ? 650 : 850, 0.9, 0.7, 0.002, 0.05);
  }
  if (energy === 'cyan' || energy === 'violet') tone(s, 'square', t, 900, 300, 0.05, 0.05, 0.001, 0.05);
  s.done(0.5);
}

/** A round passing close: a supersonic crack or a subsonic whiz. */
export function nearMiss(pos: THREE.Vector3, crack: boolean): void {
  const s = audio.spot(pos, 30, 0.9, 0.05);
  if (!s) return;
  if (crack) {
    noise(s, 'white', s.t0, 0.02, 'highpass', 3500, 0.7, 1, 0.0005, 0.012);
    noise(s, 'pink', s.t0, 0.1, 'bandpass', 1800, 1.2, 0.3, 0.002, 0.07);
  } else {
    const ctx = audio.ctx!;
    const src = audio.noiseSource('white');
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 4;
    f.frequency.setValueAtTime(2600, s.t0);
    f.frequency.exponentialRampToValueAtTime(700, s.t0 + 0.16);
    const g = ctx.createGain();
    env(g.gain, s.t0, 0.6, 0.03, 0.14);
    src.connect(f).connect(g).connect(s.out);
    src.start(s.t0, Math.random());
    src.stop(s.t0 + 0.2);
  }
  s.done(0.3);
}

// ---- Explosions and weather -----------------------------------------------------------------
export function explosion(pos: THREE.Vector3, radius: number, kind: string): void {
  const big = kind === 'fuel' || kind === 'vehicle' || kind === 'launch';
  const size = Math.min(2.2, radius / 5) * (big ? 1.4 : 1);
  const s = audio.spot(pos, H.explosion, 1.1 * size, 0.7);
  if (!s) return;
  const t = s.t0;
  noise(s, 'white', t, 0.06, 'highpass', 1500, 0.6, 1, 0.001, 0.04);
  tone(s, 'sine', t, 110, 28, 0.6, 1.3, 0.004, 0.7 + size * 0.2);
  noise(s, 'brown', t, 2.6, 'lowpass', 500, 0.6, 1.2, 0.006, 1.2 + size * 0.6);
  // Debris patter.
  for (let i = 0; i < 4; i++) noise(s, 'white', t + 0.15 + i * 0.09 + Math.random() * 0.1, 0.05, 'bandpass', 2500 + Math.random() * 2000, 2, 0.15, 0.001, 0.04);
  s.done(3.2);
}

export function thunder(pos: THREE.Vector3): void {
  const s = audio.spot(pos, H.thunder, 1.4, 0.8);
  if (!s) return;
  const t = s.t0;
  if (s.d < 300) noise(s, 'white', t, 0.12, 'highpass', 2000, 0.6, 1, 0.0005, 0.08);
  noise(s, 'brown', t + 0.05, 4, 'lowpass', 220, 0.7, 1.4, 0.05, 3.2);
  noise(s, 'brown', t + 0.6 + Math.random() * 0.5, 3, 'lowpass', 160, 0.7, 0.8, 0.2, 2.4);
  s.done(4.5);
}

// ---- Footsteps --------------------------------------------------------------------------------
export function footstep(surface: Surface, pos: THREE.Vector3, own: boolean, loud: number): void {
  const s = own ? audio.flat(0.16 * loud, 'sfx', 0.05) : audio.spot(pos, H.footstep, 0.5 * loud, 0.05);
  if (!s) return;
  const t = s.t0;
  switch (surface) {
    case 'metal':
    case 'sheet':
      noise(s, 'pink', t, 0.08, 'bandpass', 1100, 1.5, 0.7, 0.002, 0.05);
      tone(s, 'triangle', t, 420 + Math.random() * 120, 380, 0.08, 0.12, 0.002, 0.12);
      break;
    case 'wood':
      noise(s, 'pink', t, 0.07, 'bandpass', 480, 1.6, 0.8, 0.002, 0.05);
      break;
    case 'concrete':
    case 'glass':
      noise(s, 'white', t, 0.05, 'bandpass', 1900, 1.2, 0.5, 0.002, 0.035);
      break;
    case 'water':
      noise(s, 'white', t, 0.2, 'lowpass', 1800, 0.8, 0.5, 0.01, 0.15);
      break;
    case 'sand':
      noise(s, 'white', t, 0.12, 'highpass', 1800, 0.6, 0.35, 0.01, 0.08);
      break;
    default:
      // Grass and dirt: soft, dull.
      noise(s, 'pink', t, 0.1, 'lowpass', surface === 'grass' ? 1300 : 900, 0.8, 0.6, 0.004, 0.06);
  }
  s.done(0.3);
}

// ---- Feedback -------------------------------------------------------------------------------
export function hitConfirm(kind: 'hit' | 'head' | 'armor' | 'kill'): void {
  const s = audio.flat(kind === 'kill' ? 0.35 : 0.22, 'ui');
  if (!s) return;
  const t = s.t0;
  if (kind === 'kill') {
    tone(s, 'sine', t, 1320, 1320, 0, 0.5, 0.002, 0.12);
    tone(s, 'sine', t + 0.07, 1980, 1980, 0, 0.45, 0.002, 0.2);
  } else if (kind === 'head') {
    tone(s, 'sine', t, 2400, 2400, 0, 0.5, 0.001, 0.05);
    tone(s, 'sine', t + 0.035, 3000, 3000, 0, 0.35, 0.001, 0.05);
  } else tone(s, kind === 'armor' ? 'triangle' : 'sine', t, kind === 'armor' ? 1600 : 2100, kind === 'armor' ? 1500 : 2100, 0.04, 0.45, 0.001, 0.04);
  s.done(0.35);
}

export function hurt(amount: number): void {
  const s = audio.flat(Math.min(0.6, 0.15 + amount / 120), 'sfx');
  if (!s) return;
  tone(s, 'sine', s.t0, 95, 45, 0.15, 0.9, 0.003, 0.2);
  noise(s, 'pink', s.t0, 0.15, 'lowpass', 500, 0.7, 0.5, 0.002, 0.1);
  s.done(0.4);
}

export function spawnWhoosh(): void {
  const s = audio.flat(0.25, 'ui', 0.2);
  if (!s) return;
  const ctx = audio.ctx!;
  const src = audio.noiseSource('pink');
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = 2;
  f.frequency.setValueAtTime(300, s.t0);
  f.frequency.exponentialRampToValueAtTime(2400, s.t0 + 0.6);
  const g = ctx.createGain();
  env(g.gain, s.t0, 0.6, 0.3, 0.4);
  src.connect(f).connect(g).connect(s.out);
  src.start(s.t0);
  src.stop(s.t0 + 0.8);
  s.done(0.9);
}

/** Menu and HUD blips. */
export function ui(kind: string): void {
  const s = audio.flat(kind === 'hover' ? 0.08 : 0.2, 'ui');
  if (!s) return;
  const t = s.t0;
  switch (kind) {
    case 'hover':
      tone(s, 'sine', t, 1500, 1500, 0, 0.5, 0.002, 0.03);
      break;
    case 'click':
      tone(s, 'triangle', t, 900, 900, 0, 0.6, 0.002, 0.04);
      tone(s, 'triangle', t + 0.045, 1350, 1350, 0, 0.5, 0.002, 0.06);
      break;
    case 'back':
      tone(s, 'triangle', t, 1350, 1350, 0, 0.5, 0.002, 0.04);
      tone(s, 'triangle', t + 0.045, 900, 900, 0, 0.5, 0.002, 0.06);
      break;
    case 'ping':
      tone(s, 'sine', t, 1760, 1760, 0, 0.5, 0.003, 0.18);
      tone(s, 'sine', t + 0.06, 2640, 2640, 0, 0.3, 0.003, 0.2);
      break;
    case 'deny':
      tone(s, 'square', t, 220, 200, 0.1, 0.25, 0.002, 0.12);
      break;
    default:
      noise(s, 'white', t, 0.03, 'bandpass', 3000, 2, 0.5, 0.001, 0.025);
  }
  s.done(0.4);
}

/** Tonal stinger that goes with an announcement banner. */
export function stinger(tone_: 'good' | 'bad' | 'warn' | 'info'): void {
  const s = audio.flat(0.3, 'voice', 0.35);
  if (!s) return;
  const t = s.t0;
  const notes: Record<typeof tone_, number[]> = { good: [72, 76, 79, 84], bad: [69, 65, 62, 57], warn: [66, 72, 66, 72], info: [76, 83] };
  const type: OscillatorType = tone_ === 'bad' ? 'sawtooth' : tone_ === 'warn' ? 'square' : 'triangle';
  notes[tone_].forEach((n, i) => {
    const f = mtof(n);
    tone(s, type, t + i * 0.11, f, f, 0, tone_ === 'bad' ? 0.18 : 0.3, 0.008, 0.28 + (i === notes[tone_].length - 1 ? 0.5 : 0));
  });
  // A soft pad under the motif.
  const root = mtof(notes[tone_][0] - 12);
  tone(s, 'sine', t, root, root, 0, 0.25, 0.05, 1.1);
  s.done(1.6);
}
