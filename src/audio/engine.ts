// Web Audio engine: buses (sfx, music, ui, voice) into a compressor, a reverb send that crossfades
// between generated outdoor and indoor impulses, positional one-shots with distance gain, air
// absorption (low-pass), speed-of-sound delay and equal-power 3D panning, and a voice budget.
// Automated runs (smoke, soak) never create an AudioContext unless --audio=on.
import * as THREE from 'three';
import { TUNING } from '../config/tuning';
import { distanceModel, impulseSamples, noiseSamples } from './synth';
import type { Settings } from '../core/save';

const A = TUNING.audio;

export type Bus = 'sfx' | 'music' | 'ui' | 'voice';

export interface Spot {
  /** Connect sources here. */
  out: AudioNode;
  /** Start time (includes the distance delay). */
  t0: number;
  /** Distance to the listener. */
  d: number;
  /** Frees the chain after the sound has played for `seconds`. */
  done(seconds: number): void;
}

export class AudioEngine {
  ctx: AudioContext | null = null;
  enabled = true;
  private master!: GainNode;
  private comp!: DynamicsCompressorNode;
  private buses = {} as Record<Bus, GainNode>;
  private reverbIn!: GainNode;
  private revOutGain!: GainNode;
  private revInGain!: GainNode;
  noise = {} as Record<'white' | 'pink' | 'brown', AudioBuffer>;
  readonly listener = new THREE.Vector3();
  private voices = 0;
  private indoor = 0;
  private vols: Partial<Settings> = {};
  private meter: AnalyserNode | null = null;
  private meterBuf: Float32Array<ArrayBuffer> | null = null;
  /** Running peak and RMS of the output (debug readout and automated checks). */
  peakDb = -120;
  rmsDb = -120;

  /** Creates the context on first use (or never, when disabled). */
  init(): AudioContext | null {
    if (!this.enabled) return null;
    if (this.ctx) return this.ctx;
    const Ctor = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
    if (!Ctor) {
      this.enabled = false;
      return null;
    }
    const ctx = new Ctor({ latencyHint: 'interactive' });
    this.ctx = ctx;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.knee.value = 10;
    this.comp.ratio.value = 5;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.22;
    this.master = ctx.createGain();
    this.comp.connect(this.master).connect(ctx.destination);
    this.meter = ctx.createAnalyser();
    this.meter.fftSize = 2048;
    this.meterBuf = new Float32Array(this.meter.fftSize);
    this.master.connect(this.meter);
    for (const b of ['sfx', 'music', 'ui', 'voice'] as Bus[]) {
      const g = ctx.createGain();
      g.connect(this.comp);
      this.buses[b] = g;
    }
    // Reverb: one send, two generated rooms crossfaded by the indoor factor.
    this.reverbIn = ctx.createGain();
    const room = (r: { seconds: number; decay: number; brightness: number }, seed: number) => {
      const [l, rr] = impulseSamples(ctx.sampleRate, r.seconds, r.decay, r.brightness, seed);
      const buf = ctx.createBuffer(2, l.length, ctx.sampleRate);
      buf.copyToChannel(l as Float32Array<ArrayBuffer>, 0);
      buf.copyToChannel(rr as Float32Array<ArrayBuffer>, 1);
      const conv = ctx.createConvolver();
      conv.buffer = buf;
      return conv;
    };
    const outdoor = room(A.reverbOutdoor, 3);
    const indoor = room(A.reverbIndoor, 9);
    this.revOutGain = ctx.createGain();
    this.revInGain = ctx.createGain();
    this.revInGain.gain.value = 0;
    this.reverbIn.connect(outdoor).connect(this.revOutGain).connect(this.buses.sfx);
    this.reverbIn.connect(indoor).connect(this.revInGain).connect(this.buses.sfx);
    // Noise beds.
    const mk = (kind: 'white' | 'pink' | 'brown', seconds: number, seed: number) => {
      const s = noiseSamples(kind, Math.floor(ctx.sampleRate * seconds), seed);
      const b = ctx.createBuffer(1, s.length, ctx.sampleRate);
      b.copyToChannel(s as Float32Array<ArrayBuffer>, 0);
      return b;
    };
    this.noise.white = mk('white', 2, 5);
    this.noise.pink = mk('pink', 4, 6);
    this.noise.brown = mk('brown', 4, 8);
    const l = ctx.listener;
    if (l.forwardX) {
      l.upX.value = 0;
      l.upY.value = 1;
      l.upZ.value = 0;
    }
    this.applyVolumes();
    return ctx;
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setVolumes(s: Settings): void {
    this.vols = s;
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const v = this.vols;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(v.volMaster ?? 0.8, t, 0.05);
    this.buses.sfx.gain.setTargetAtTime(v.volSfx ?? 0.9, t, 0.05);
    this.buses.music.gain.setTargetAtTime((v.volMusic ?? 0.55) * 0.7, t, 0.05);
    this.buses.ui.gain.setTargetAtTime(v.volUi ?? 0.7, t, 0.05);
    this.buses.voice.gain.setTargetAtTime(v.volVoice ?? 0.8, t, 0.05);
  }

  /** Mutes everything quickly (pause) or brings it back. */
  duck(on: boolean): void {
    if (!this.ctx) return;
    this.buses.sfx.gain.setTargetAtTime(on ? 0 : (this.vols.volSfx ?? 0.9), this.ctx.currentTime, 0.08);
  }

  bus(b: Bus): GainNode | null {
    return this.ctx ? this.buses[b] : null;
  }

  get now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  /** Listener transform (camera) and the indoor factor target (0 outside, 1 inside). */
  setListener(pos: THREE.Vector3, forward: THREE.Vector3, indoor: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.listener.copy(pos);
    const l = ctx.listener;
    if (l.positionX) {
      l.positionX.value = pos.x;
      l.positionY.value = pos.y;
      l.positionZ.value = pos.z;
      l.forwardX.value = forward.x;
      l.forwardY.value = forward.y;
      l.forwardZ.value = forward.z;
    } else {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(forward.x, forward.y, forward.z, 0, 1, 0);
    }
    if (Math.abs(indoor - this.indoor) > 0.01) {
      this.indoor = indoor;
      this.revOutGain.gain.setTargetAtTime(1 - indoor * 0.8, ctx.currentTime, 0.3);
      this.revInGain.gain.setTargetAtTime(indoor, ctx.currentTime, 0.3);
    }
  }

  /** A positional output chain for a one-shot, or null when it is out of range or over budget. */
  spot(pos: THREE.Vector3, range: number, gain: number, reverb: number, bus: Bus = 'sfx'): Spot | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    const d = pos.distanceTo(this.listener);
    if (d > range) return null;
    if (this.voices >= A.maxVoices && d > 25) return null;
    const dm = distanceModel(d);
    const g = ctx.createGain();
    g.gain.value = dm.gain * gain;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = dm.cutoff;
    const pan = ctx.createPanner();
    pan.panningModel = 'equalpower';
    pan.distanceModel = 'linear';
    pan.rolloffFactor = 0;
    if (pan.positionX) {
      pan.positionX.value = pos.x;
      pan.positionY.value = pos.y;
      pan.positionZ.value = pos.z;
    } else pan.setPosition(pos.x, pos.y, pos.z);
    g.connect(lp).connect(pan).connect(this.buses[bus]);
    let send: GainNode | null = null;
    if (reverb > 0) {
      send = ctx.createGain();
      send.gain.value = reverb * (0.35 + 0.65 * Math.min(1, d / 90));
      lp.connect(send).connect(this.reverbIn);
    }
    this.voices++;
    const t0 = ctx.currentTime + dm.delay;
    return {
      out: g,
      t0,
      d,
      done: (seconds: number) => {
        setTimeout(() => {
          this.voices--;
          g.disconnect();
          lp.disconnect();
          pan.disconnect();
          send?.disconnect();
        }, (dm.delay + seconds + 0.25) * 1000);
      },
    };
  }

  /** A non-positional output (the player's own weapon, UI, stingers). */
  flat(gain: number, bus: Bus, reverb = 0): Spot | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    const g = ctx.createGain();
    g.gain.value = gain;
    g.connect(this.buses[bus]);
    let send: GainNode | null = null;
    if (reverb > 0) {
      send = ctx.createGain();
      send.gain.value = reverb;
      g.connect(send).connect(this.reverbIn);
    }
    this.voices++;
    return {
      out: g,
      t0: ctx.currentTime,
      d: 0,
      done: (seconds: number) => {
        setTimeout(() => {
          this.voices--;
          g.disconnect();
          send?.disconnect();
        }, (seconds + 0.25) * 1000);
      },
    };
  }

  /** Connects a looping or one-shot noise source. */
  noiseSource(kind: 'white' | 'pink' | 'brown', loop = false, offset = 0): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise[kind];
    src.loop = loop;
    if (!loop) src.loopStart = offset;
    return src;
  }

  /** Samples the output level (call once per frame or less). */
  measure(): void {
    if (!this.meter || !this.meterBuf) return;
    this.meter.getFloatTimeDomainData(this.meterBuf);
    let peak = 0, sum = 0;
    for (const v of this.meterBuf) {
      const a = Math.abs(v);
      if (a > peak) peak = a;
      sum += v * v;
    }
    const db = (x: number) => (x > 1e-6 ? 20 * Math.log10(x) : -120);
    this.peakDb = Math.max(db(peak), this.peakDb - 0.5);
    this.rmsDb = db(Math.sqrt(sum / this.meterBuf.length));
  }

  get activeVoices(): number {
    return this.voices;
  }
}

export const audio = new AudioEngine();
