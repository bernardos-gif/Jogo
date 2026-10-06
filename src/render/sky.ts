// Banded gradient sky dome (Elemental Brawl's shader) with Vector Front's day-to-dusk drift:
// three keys (afternoon, EB's exact sunset, dusk) interpolated by a 0..1 time value, plus storm
// darkening. Low-poly toon cloud puffs ring the horizon.
import * as THREE from 'three';
import { toonMaterial } from './toon';
import type { Rng } from '../core/rng';

export interface SkyKey {
  elevationDeg: number;
  top: number;
  mid: number;
  horizon: number;
  below: number;
  fog: number;
  sunSky: number;
  sunLight: number;
  sunIntensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  ambientIntensity: number;
  cloudTint: number;
}

export const SKY_KEYS: SkyKey[] = [
  {
    elevationDeg: 24,
    top: 0x3a4a8c,
    mid: 0xd9839a,
    horizon: 0xffc27a,
    below: 0xefb08a,
    fog: 0xf4bf92,
    sunSky: 0xfff6d0,
    sunLight: 0xfff0d0,
    sunIntensity: 2.6,
    hemiSky: 0xffe6c8,
    hemiGround: 0x7a6a8a,
    hemiIntensity: 1.22,
    ambientIntensity: 0.38,
    cloudTint: 0xfff4ea,
  },
  {
    // Elemental Brawl's sunset, exact.
    elevationDeg: 12.7,
    top: 0x2b2766,
    mid: 0xc4567e,
    horizon: 0xffa860,
    below: 0xe98d73,
    fog: 0xf2a77a,
    sunSky: 0xfff0b0,
    sunLight: 0xffe0b8,
    sunIntensity: 2.4,
    hemiSky: 0xffd6b0,
    hemiGround: 0x6a4a7a,
    hemiIntensity: 1.15,
    ambientIntensity: 0.35,
    cloudTint: 0xffe0d0,
  },
  {
    elevationDeg: 4,
    top: 0x1a1840,
    mid: 0x7a3a6a,
    horizon: 0xe0704a,
    below: 0x9a5a6a,
    fog: 0xb07068,
    sunSky: 0xffc890,
    sunLight: 0xffb890,
    sunIntensity: 1.6,
    hemiSky: 0xd890a0,
    hemiGround: 0x3a2a50,
    hemiIntensity: 0.98,
    ambientIntensity: 0.3,
    cloudTint: 0xd8a0a8,
  },
];

/** Storm tint target (sky, fog and cloud colors shift toward it). */
export const STORM_TINT = 0x3a3550;
/** Sun azimuth from Elemental Brawl's SUN_DIR (-0.62, *, -0.75). */
export const SUN_AZIMUTH = Math.atan2(-0.62, -0.75);

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * p;
    gl_Position.z = gl_Position.w;
  }
`;
const SKY_FRAG = /* glsl */ `
  varying vec3 vDir;
  uniform vec3 sunDir;
  uniform vec3 top;
  uniform vec3 mid;
  uniform vec3 horizon;
  uniform vec3 below;
  uniform vec3 sunColor;
  uniform vec3 stormTint;
  uniform float storm;
  void main() {
    vec3 d = normalize(vDir);
    float y = d.y;
    vec3 col;
    if (y > 0.0) {
      float t1 = smoothstep(0.0, 0.18, y);
      float t2 = smoothstep(0.12, 0.75, y);
      col = mix(horizon, mid, t1);
      col = mix(col, top, t2);
    } else {
      col = mix(horizon, below, smoothstep(0.0, 0.25, -y));
    }
    float s = max(dot(d, sunDir), 0.0);
    col += sunColor * (pow(s, 600.0) * 1.6 + pow(s, 40.0) * 0.4 + pow(s, 6.0) * 0.16) * (1.0 - storm * 0.85);
    col = mix(col, stormTint * (0.8 + 0.4 * y), storm * 0.75);
    col = floor(col * 28.0) / 28.0;
    gl_FragColor = vec4(col, 1.0);
  }
`;

const _ca = new THREE.Color();
const _cb = new THREE.Color();

export function lerpColor(a: number, b: number, t: number, out = new THREE.Color()): THREE.Color {
  _ca.setHex(a);
  _cb.setHex(b);
  return out.copy(_ca).lerp(_cb, t);
}

/** Interpolated sky state for a 0..1 time (0 afternoon, 0.5 sunset, 1 dusk). */
export interface SkyState {
  sunDir: THREE.Vector3;
  top: THREE.Color;
  mid: THREE.Color;
  horizon: THREE.Color;
  below: THREE.Color;
  fog: THREE.Color;
  sunSky: THREE.Color;
  sunLight: THREE.Color;
  sunIntensity: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
  ambientIntensity: number;
  cloudTint: THREE.Color;
}

export function sampleSky(t: number, storm: number, out: SkyState): SkyState {
  const x = Math.max(0, Math.min(1, t)) * (SKY_KEYS.length - 1);
  const i = Math.min(SKY_KEYS.length - 2, Math.floor(x));
  const f = x - i;
  const a = SKY_KEYS[i];
  const b = SKY_KEYS[i + 1];
  const elev = THREE.MathUtils.degToRad(a.elevationDeg + (b.elevationDeg - a.elevationDeg) * f);
  out.sunDir.set(Math.sin(SUN_AZIMUTH) * Math.cos(elev), Math.sin(elev), Math.cos(SUN_AZIMUTH) * Math.cos(elev)).normalize();
  lerpColor(a.top, b.top, f, out.top);
  lerpColor(a.mid, b.mid, f, out.mid);
  lerpColor(a.horizon, b.horizon, f, out.horizon);
  lerpColor(a.below, b.below, f, out.below);
  lerpColor(a.fog, b.fog, f, out.fog);
  lerpColor(a.sunSky, b.sunSky, f, out.sunSky);
  lerpColor(a.sunLight, b.sunLight, f, out.sunLight);
  lerpColor(a.hemiSky, b.hemiSky, f, out.hemiSky);
  lerpColor(a.hemiGround, b.hemiGround, f, out.hemiGround);
  lerpColor(a.cloudTint, b.cloudTint, f, out.cloudTint);
  out.sunIntensity = a.sunIntensity + (b.sunIntensity - a.sunIntensity) * f;
  out.hemiIntensity = a.hemiIntensity + (b.hemiIntensity - a.hemiIntensity) * f;
  out.ambientIntensity = a.ambientIntensity + (b.ambientIntensity - a.ambientIntensity) * f;
  if (storm > 0) {
    _cb.setHex(STORM_TINT);
    out.fog.lerp(_cb, storm * 0.7);
    out.cloudTint.lerp(_cb, storm * 0.6);
    out.sunIntensity *= 1 - storm * 0.6;
    out.hemiIntensity *= 1 - storm * 0.25;
  }
  return out;
}

export function newSkyState(): SkyState {
  return {
    sunDir: new THREE.Vector3(),
    top: new THREE.Color(),
    mid: new THREE.Color(),
    horizon: new THREE.Color(),
    below: new THREE.Color(),
    fog: new THREE.Color(),
    sunSky: new THREE.Color(),
    sunLight: new THREE.Color(),
    sunIntensity: 0,
    hemiSky: new THREE.Color(),
    hemiGround: new THREE.Color(),
    hemiIntensity: 0,
    ambientIntensity: 0,
    cloudTint: new THREE.Color(),
  };
}

export class Sky {
  readonly group = new THREE.Group();
  private mat: THREE.ShaderMaterial;
  private clouds: THREE.InstancedMesh;
  private cloudMat: THREE.MeshToonMaterial;
  private cloudGroup = new THREE.Group();

  constructor(cloudCount: number, rng: Rng, radius = 1800) {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        sunDir: { value: new THREE.Vector3(0, 1, 0) },
        top: { value: new THREE.Color() },
        mid: { value: new THREE.Color() },
        horizon: { value: new THREE.Color() },
        below: { value: new THREE.Color() },
        sunColor: { value: new THREE.Color() },
        stormTint: { value: new THREE.Color(STORM_TINT) },
        storm: { value: 0 },
      },
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 20), this.mat);
    dome.renderOrder = -10;
    dome.frustumCulled = false;
    this.group.add(dome);

    this.cloudMat = toonMaterial(0xffffff);
    const n = Math.max(1, cloudCount);
    this.clouds = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), this.cloudMat, n);
    this.clouds.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    const c = new THREE.Color();
    const tints = [0xfff1e6, 0xffd7c2, 0xffc1b0, 0xf6b0b8, 0xffe3c8];
    let i = 0;
    while (i < n) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(700, 1350);
      const cy = rng.range(140, 330);
      const cx = Math.cos(a) * r;
      const cz = Math.sin(a) * r;
      const puffs = 4 + rng.int(6);
      const big = rng.range(26, 70);
      for (let k = 0; k < puffs && i < n; k++, i++) {
        p.set(cx + rng.range(-1.6, 1.6) * big, cy + rng.range(-0.3, 0.6) * big * 0.5, cz + rng.range(-1.6, 1.6) * big);
        const sc = big * rng.range(0.6, 1.2);
        s.set(sc * rng.range(1.1, 1.6), sc * rng.range(0.55, 0.8), sc * rng.range(1.1, 1.5));
        e.set(rng.range(0, 0.3), rng.range(0, Math.PI * 2), rng.range(0, 0.3));
        q.setFromEuler(e);
        m.compose(p, q, s);
        this.clouds.setMatrixAt(i, m);
        c.setHex(tints[rng.int(tints.length)]);
        this.clouds.setColorAt(i, c);
      }
    }
    this.clouds.frustumCulled = false;
    this.clouds.castShadow = false;
    this.cloudGroup.add(this.clouds);
    this.group.add(this.cloudGroup);
  }

  apply(state: SkyState, storm: number): void {
    const u = this.mat.uniforms;
    (u.sunDir.value as THREE.Vector3).copy(state.sunDir);
    (u.top.value as THREE.Color).copy(state.top);
    (u.mid.value as THREE.Color).copy(state.mid);
    (u.horizon.value as THREE.Color).copy(state.horizon);
    (u.below.value as THREE.Color).copy(state.below);
    (u.sunColor.value as THREE.Color).copy(state.sunSky);
    u.storm.value = storm;
    this.cloudMat.color.copy(state.cloudTint);
  }

  /** Keeps the dome centered on the camera and drifts the cloud ring. */
  update(dt: number, camPos: THREE.Vector3, windSpeed: number): void {
    this.group.position.set(camPos.x, 0, camPos.z);
    this.cloudGroup.rotation.y += dt * 0.004 * (0.5 + windSpeed * 0.1);
  }
}
