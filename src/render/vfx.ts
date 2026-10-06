// Effects renderer (STYLE_GUIDE.md section 6), ported from Elemental Brawl and extended:
// instanced low-poly particle pools (additive with an HDR GLOW multiplier, or toon-lit), expanding
// rings, blast spheres, flash sprites, jagged polyline bolts, camera-facing trails, pooled point
// lights, plus Vector Front's tracer streaks, physics debris chunks and decals.
import * as THREE from 'three';
import { toonMaterial, MATS } from './toon';
import { clamp } from '../core/math';
import { fxRng } from '../core/rng';
import type { QualityProfile } from './quality';

export type Shape = 'cube' | 'tetra' | 'spark' | 'puff';

export interface BurstOpts {
  count: number;
  color: number;
  color2?: number;
  speed?: [number, number];
  dir?: THREE.Vector3;
  /** 0 = exactly along dir, 1 = full sphere. */
  spread?: number;
  up?: number;
  gravity?: number;
  drag?: number;
  life?: [number, number];
  size?: [number, number];
  sizeEnd?: number;
  shape?: Shape;
  additive?: boolean;
  radius?: number;
  flat?: boolean;
  stretch?: number;
  spin?: number;
}

interface Pool {
  mesh: THREE.InstancedMesh;
  cap: number;
  n: number;
  additive: boolean;
  shape: Shape;
  f: Float32Array;
}

const F = { px: 0, py: 1, pz: 2, vx: 3, vy: 4, vz: 5, life: 6, max: 7, s0: 8, s1: 9, r0: 10, g0: 11, b0: 12, r1: 13, g1: 14, b1: 15, grav: 16, drag: 17, rx: 18, ry: 19, spin: 20, stretch: 21 };
const STRIDE = 22;

/** HDR multiplier for effects: values above 1.0 trigger bloom. */
export const GLOW = 2.1;

interface Ring {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  t: number;
  life: number;
  r0: number;
  r1: number;
  active: boolean;
  hold: boolean;
  baseOpacity: number;
}
interface Sphere {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  t: number;
  life: number;
  r0: number;
  r1: number;
  active: boolean;
}
interface Flash {
  sprite: THREE.Sprite;
  t: number;
  life: number;
  size: number;
  active: boolean;
}
interface BoltSeg {
  mid: THREE.Vector3;
  quat: THREE.Quaternion;
  len: number;
  width: number;
  t: number;
  life: number;
  color: THREE.Color;
}
interface Chunk {
  p: THREE.Vector3;
  v: THREE.Vector3;
  r: THREE.Euler;
  w: THREE.Vector3;
  s: THREE.Vector3;
  c: THREE.Color;
  life: number;
  rest: number;
}
interface Decal {
  m: THREE.Matrix4;
  kind: number;
  life: number;
  max: number;
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _c2 = new THREE.Color();
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

export function randomUnit(out = new THREE.Vector3()): THREE.Vector3 {
  const u = fxRng.next() * 2 - 1;
  const a = fxRng.next() * Math.PI * 2;
  const r = Math.sqrt(1 - u * u);
  return out.set(r * Math.cos(a), u, r * Math.sin(a));
}
const rand = (a: number, b: number) => fxRng.range(a, b);

function radialTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.85)');
  grd.addColorStop(0.6, 'rgba(255,255,255,0.25)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function ringTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,0.0)');
  grd.addColorStop(0.62, 'rgba(255,255,255,0.12)');
  grd.addColorStop(0.86, 'rgba(255,255,255,0.9)');
  grd.addColorStop(0.94, 'rgba(255,255,255,1)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

/** Decal atlas (2x2): bullet hole, scorch, crater, energy burn. Drawn in code. */
function decalAtlas(): THREE.Texture {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S * 2;
  const g = c.getContext('2d')!;
  const cell = (ix: number, iy: number, draw: (cx: number, cy: number) => void) => {
    g.save();
    g.beginPath();
    g.rect(ix * S, iy * S, S, S);
    g.clip();
    draw(ix * S + S / 2, iy * S + S / 2);
    g.restore();
  };
  const blob = (cx: number, cy: number, r: number, stops: [number, string][]) => {
    const grd = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    for (const [o, col] of stops) grd.addColorStop(o, col);
    g.fillStyle = grd;
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();
  };
  // Bullet hole: dark core and a faceted rim (polygonal, matching the low-poly style).
  cell(0, 0, (cx, cy) => {
    g.fillStyle = 'rgba(20,12,16,0.55)';
    g.beginPath();
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const r = 26 + (i % 2) * 8;
      g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    g.fill();
    g.fillStyle = 'rgba(10,6,8,0.95)';
    g.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      g.lineTo(cx + Math.cos(a) * 12, cy + Math.sin(a) * 12);
    }
    g.fill();
  });
  // Scorch.
  cell(1, 0, (cx, cy) =>
    blob(cx, cy, 62, [
      [0, 'rgba(15,8,10,0.9)'],
      [0.5, 'rgba(30,18,20,0.6)'],
      [1, 'rgba(40,24,24,0)'],
    ]),
  );
  // Crater: dark ring with a faceted inner floor.
  cell(0, 1, (cx, cy) => {
    blob(cx, cy, 62, [
      [0, 'rgba(25,16,18,0.85)'],
      [0.55, 'rgba(45,30,28,0.8)'],
      [0.8, 'rgba(60,40,34,0.5)'],
      [1, 'rgba(60,40,34,0)'],
    ]);
    g.fillStyle = 'rgba(12,8,10,0.7)';
    g.beginPath();
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      g.lineTo(cx + Math.cos(a) * (22 + (i % 3) * 5), cy + Math.sin(a) * (22 + (i % 3) * 5));
    }
    g.fill();
  });
  // Energy burn: glassy dark spot with a faint colored rim (tinted per instance).
  cell(1, 1, (cx, cy) =>
    blob(cx, cy, 50, [
      [0, 'rgba(10,10,14,0.9)'],
      [0.6, 'rgba(40,40,50,0.6)'],
      [0.85, 'rgba(200,220,255,0.35)'],
      [1, 'rgba(200,220,255,0)'],
    ]),
  );
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export type DecalKind = 'hole' | 'scorch' | 'crater' | 'burn';
const DECAL_INDEX: Record<DecalKind, number> = { hole: 0, scorch: 1, crater: 2, burn: 3 };

/** A camera-facing ribbon that follows a moving point (tracers, grapple lines, rockets, wingsuit streaks). */
export class Trail {
  readonly mesh: THREE.Mesh;
  private pts: THREE.Vector3[] = [];
  private geo: THREE.BufferGeometry;
  private pos: Float32Array;
  private col: Float32Array;
  emitting = false;
  color = new THREE.Color();
  width: number;
  private fade = 0;
  constructor(
    color: number,
    width: number,
    readonly length = 14,
  ) {
    this.width = width;
    this.color.setHex(color);
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(length * 2 * 3);
    this.col = new Float32Array(length * 2 * 3);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const idx: number[] = [];
    for (let i = 0; i < length - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.geo.setIndex(idx);
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    mat.color.setScalar(GLOW);
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  update(dt: number, head: THREE.Vector3, camPos: THREE.Vector3): void {
    if (this.emitting) {
      this.fade = 1;
      const v = this.pts.length >= this.length ? this.pts.pop()!.copy(head) : head.clone();
      this.pts.unshift(v);
    } else if (this.pts.length) {
      this.fade -= dt * 5;
      this.pts.pop();
      if (this.fade <= 0) this.pts.length = 0;
    }
    const n = this.pts.length;
    this.mesh.visible = n > 1;
    if (n < 2) return;
    for (let i = 0; i < this.length; i++) {
      const p = this.pts[Math.min(i, n - 1)];
      const q = this.pts[Math.min(i + 1, n - 1)];
      const r = this.pts[Math.min(Math.max(i - 1, 0), n - 1)];
      _v.subVectors(r, q);
      if (_v.lengthSq() < 1e-6) _v.set(0, 1, 0);
      _v2.subVectors(camPos, p);
      _v.cross(_v2).normalize();
      const k = 1 - i / (this.length - 1);
      const w = this.width * k;
      const o = i * 6;
      this.pos[o] = p.x + _v.x * w;
      this.pos[o + 1] = p.y + _v.y * w;
      this.pos[o + 2] = p.z + _v.z * w;
      this.pos[o + 3] = p.x - _v.x * w;
      this.pos[o + 4] = p.y - _v.y * w;
      this.pos[o + 5] = p.z - _v.z * w;
      const a = k * k * Math.max(0, this.fade) * (i < n ? 1 : 0);
      for (let s = 0; s < 2; s++) {
        this.col[o + s * 3] = this.color.r * a;
        this.col[o + s * 3 + 1] = this.color.g * a;
        this.col[o + s * 3 + 2] = this.color.b * a;
      }
    }
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }

  reset(): void {
    this.pts.length = 0;
    this.mesh.visible = false;
  }

  dispose(): void {
    this.geo.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

export type GroundFn = (x: number, z: number) => number;

export class VFX {
  readonly group = new THREE.Group();
  private pools = new Map<string, Pool>();
  private rings: Ring[] = [];
  private spheres: Sphere[] = [];
  private flashes: Flash[] = [];
  private bolts: BoltSeg[] = [];
  private boltMesh: THREE.InstancedMesh;
  private lights: { light: THREE.PointLight; t: number; life: number; i0: number }[] = [];
  private trails: { trail: Trail; head: () => THREE.Vector3; done?: () => boolean }[] = [];
  private tracerMesh: THREE.InstancedMesh;
  private tracerN = 0;
  private readonly tracerCap = 768;
  private chunkMesh: THREE.InstancedMesh;
  private chunks: Chunk[] = [];
  private chunkCap: number;
  private decalMesh: THREE.InstancedMesh;
  private decals: Decal[] = [];
  private decalNext = 0;
  private decalCap: number;
  private radialTex = radialTexture();
  private ringTex = ringTexture();
  private decalTex = decalAtlas();
  private scale: number;
  camera: THREE.Camera | null = null;
  ground: GroundFn = () => 0;

  constructor(
    scene: THREE.Scene,
    q: QualityProfile,
  ) {
    scene.add(this.group);
    this.scale = q.particleScale;
    const cap = q.maxParticles;
    const geos: Record<Shape, THREE.BufferGeometry> = {
      cube: new THREE.BoxGeometry(1, 1, 1),
      tetra: new THREE.TetrahedronGeometry(0.75),
      spark: new THREE.BoxGeometry(0.35, 0.35, 1.6),
      puff: new THREE.IcosahedronGeometry(0.62, 0),
    };
    const make = (shape: Shape, additive: boolean, frac: number) => {
      const n = Math.max(32, Math.floor(cap * frac));
      const mat = additive ? new THREE.MeshBasicMaterial({ blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false }) : toonMaterial(0xffffff);
      const mesh = new THREE.InstancedMesh(geos[shape], mat, n);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      this.group.add(mesh);
      this.pools.set(shape + (additive ? '+' : ''), { mesh, cap: n, n: 0, additive, shape, f: new Float32Array(n * STRIDE) });
    };
    make('cube', true, 0.3);
    make('spark', true, 0.3);
    make('tetra', true, 0.12);
    make('puff', true, 0.2);
    make('cube', false, 0.3);
    make('tetra', false, 0.15);
    make('puff', false, 0.5);

    const ringGeo = new THREE.PlaneGeometry(2, 2);
    ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 32; i++) {
      const mat = new THREE.MeshBasicMaterial({ map: this.ringTex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
      const mesh = new THREE.Mesh(ringGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 2;
      this.group.add(mesh);
      this.rings.push({ mesh, mat, t: 0, life: 1, r0: 0, r1: 1, active: false, hold: false, baseOpacity: 1 });
    }
    const sphGeo = new THREE.IcosahedronGeometry(1, 1);
    for (let i = 0; i < 20; i++) {
      const mat = new THREE.MeshBasicMaterial({ blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false });
      const mesh = new THREE.Mesh(sphGeo, mat);
      mesh.visible = false;
      this.group.add(mesh);
      this.spheres.push({ mesh, mat, t: 0, life: 1, r0: 0, r1: 1, active: false });
    }
    for (let i = 0; i < 40; i++) {
      const mat = new THREE.SpriteMaterial({ map: this.radialTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      this.group.add(sprite);
      this.flashes.push({ sprite, t: 0, life: 1, size: 1, active: false });
    }
    const boltMat = new THREE.MeshBasicMaterial({ blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false });
    this.boltMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), boltMat, 400);
    this.boltMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(400 * 3), 3);
    this.boltMesh.count = 0;
    this.boltMesh.frustumCulled = false;
    this.group.add(this.boltMesh);
    for (let i = 0; i < 3; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 14, 1.6);
      this.group.add(light);
      this.lights.push({ light, t: 1, life: 1, i0: 0 });
    }
    // Tracers: unit box along +Z, stretched per segment.
    const tg = new THREE.BoxGeometry(1, 1, 1);
    tg.translate(0, 0, 0.5);
    this.tracerMesh = new THREE.InstancedMesh(tg, new THREE.MeshBasicMaterial({ blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false }), this.tracerCap);
    this.tracerMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.tracerCap * 3), 3);
    this.tracerMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.tracerMesh.count = 0;
    this.tracerMesh.frustumCulled = false;
    this.group.add(this.tracerMesh);
    // Debris chunks (toon-lit boxes with simple physics against the ground).
    this.chunkCap = q.debrisChunks;
    this.chunkMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), MATS.toon.clone(), this.chunkCap);
    (this.chunkMesh.material as THREE.MeshToonMaterial).vertexColors = false;
    this.chunkMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.chunkCap * 3), 3);
    this.chunkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.chunkMesh.count = 0;
    this.chunkMesh.castShadow = true;
    this.chunkMesh.frustumCulled = false;
    this.group.add(this.chunkMesh);
    // Decals.
    this.decalCap = q.decals;
    const dg = new THREE.PlaneGeometry(1, 1);
    dg.rotateX(-Math.PI / 2);
    const uvAttr = dg.getAttribute('uv') as THREE.BufferAttribute;
    const atlasIndex = new Float32Array(this.decalCap);
    const dmat = new THREE.MeshBasicMaterial({ map: this.decalTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    dmat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float atlas;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\n vMapUv = vMapUv * 0.5 + vec2(mod(atlas, 2.0), 1.0 - floor(atlas / 2.0)) * 0.5;\n#endif');
    };
    void uvAttr;
    this.decalMesh = new THREE.InstancedMesh(dg, dmat, this.decalCap);
    this.decalMesh.geometry.setAttribute('atlas', new THREE.InstancedBufferAttribute(atlasIndex, 1));
    this.decalMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.decalCap * 3).fill(1), 3);
    this.decalMesh.count = 0;
    this.decalMesh.frustumCulled = false;
    this.decalMesh.renderOrder = 1;
    this.group.add(this.decalMesh);
  }

  setScale(s: number): void {
    this.scale = s;
  }

  // ------------------------------------------------------------------------------------------
  burst(pos: THREE.Vector3, o: BurstOpts): void {
    const shape = o.shape ?? 'cube';
    const additive = o.additive ?? true;
    const pool = this.pools.get(shape + (additive ? '+' : '')) || this.pools.get(shape + '+')!;
    const count = Math.max(1, Math.round(o.count * this.scale));
    const c0 = _c.setHex(o.color);
    const c1 = _c2.setHex(o.color2 ?? o.color);
    const [sp0, sp1] = o.speed ?? [2, 6];
    const [l0, l1] = o.life ?? [0.3, 0.7];
    const [z0, z1] = o.size ?? [0.12, 0.25];
    const spread = o.spread ?? 1;
    for (let k = 0; k < count; k++) {
      if (pool.n >= pool.cap) break;
      const i = pool.n++ * STRIDE;
      const f = pool.f;
      randomUnit(_v);
      if (o.flat) _v.y = Math.abs(_v.y) * 0.15;
      if (o.dir) {
        _v2.copy(o.dir).normalize();
        _v.lerp(_v2, 1 - spread).normalize();
      }
      const r = o.radius ? fxRng.next() * o.radius : 0;
      if (o.flat && o.radius) {
        const a = fxRng.next() * Math.PI * 2;
        f[i + F.px] = pos.x + Math.cos(a) * r;
        f[i + F.py] = pos.y;
        f[i + F.pz] = pos.z + Math.sin(a) * r;
      } else {
        f[i + F.px] = pos.x + _v.x * r;
        f[i + F.py] = pos.y + _v.y * r;
        f[i + F.pz] = pos.z + _v.z * r;
      }
      const s = rand(sp0, sp1);
      f[i + F.vx] = _v.x * s;
      f[i + F.vy] = _v.y * s + (o.up ?? 0);
      f[i + F.vz] = _v.z * s;
      const life = rand(l0, l1);
      f[i + F.life] = life;
      f[i + F.max] = life;
      const size = rand(z0, z1);
      f[i + F.s0] = size;
      f[i + F.s1] = size * (o.sizeEnd ?? 0);
      const mix = o.color2 !== undefined && !additive ? fxRng.next() : 0;
      f[i + F.r0] = c0.r + (c1.r - c0.r) * mix;
      f[i + F.g0] = c0.g + (c1.g - c0.g) * mix;
      f[i + F.b0] = c0.b + (c1.b - c0.b) * mix;
      f[i + F.r1] = additive ? c1.r : f[i + F.r0];
      f[i + F.g1] = additive ? c1.g : f[i + F.g0];
      f[i + F.b1] = additive ? c1.b : f[i + F.b0];
      f[i + F.grav] = o.gravity ?? 0;
      f[i + F.drag] = o.drag ?? 1.5;
      f[i + F.rx] = fxRng.next() * Math.PI * 2;
      f[i + F.ry] = fxRng.next() * Math.PI * 2;
      f[i + F.spin] = (o.spin ?? 6) * (fxRng.next() - 0.5) * 2;
      f[i + F.stretch] = o.stretch ?? 1;
    }
  }

  shockwave(pos: THREE.Vector3, color: number, radius = 4, life = 0.4, opts: { r0?: number; normal?: THREE.Vector3; opacity?: number } = {}): void {
    const r = this.rings.find((x) => !x.active);
    if (!r) return;
    r.active = true;
    r.hold = false;
    r.t = 0;
    r.life = life;
    r.r0 = opts.r0 ?? radius * 0.15;
    r.r1 = radius;
    r.baseOpacity = opts.opacity ?? 1;
    r.mat.color.setHex(color).multiplyScalar(GLOW * 0.75);
    r.mesh.position.copy(pos);
    r.mesh.position.y += 0.06;
    if (opts.normal) r.mesh.quaternion.setFromUnitVectors(Y, _v.copy(opts.normal).normalize());
    else r.mesh.quaternion.identity();
    r.mesh.visible = true;
  }

  /** Static pulsing ground ring (telegraphs: grenade landing zones, call-in drop points). */
  marker(pos: THREE.Vector3, radius: number, color: number, life: number): void {
    const r = this.rings.find((x) => !x.active);
    if (!r) return;
    r.active = true;
    r.hold = true;
    r.t = 0;
    r.life = life;
    r.r0 = r.r1 = radius;
    r.baseOpacity = 0.9;
    r.mat.color.setHex(color);
    r.mesh.position.copy(pos);
    r.mesh.position.y += 0.07;
    r.mesh.quaternion.identity();
    r.mesh.visible = true;
  }

  blastSphere(pos: THREE.Vector3, color: number, radius = 2.5, life = 0.3): void {
    const s = this.spheres.find((x) => !x.active);
    if (!s) return;
    s.active = true;
    s.t = 0;
    s.life = life;
    s.r0 = radius * 0.3;
    s.r1 = radius;
    s.mat.color.setHex(color).multiplyScalar(GLOW * 0.75);
    s.mesh.position.copy(pos);
    s.mesh.visible = true;
  }

  flash(pos: THREE.Vector3, color: number, size = 2, life = 0.14): void {
    const fl = this.flashes.find((x) => !x.active);
    if (!fl) return;
    fl.active = true;
    fl.t = 0;
    fl.life = life;
    fl.size = size;
    (fl.sprite.material as THREE.SpriteMaterial).color.setHex(color).multiplyScalar(GLOW);
    fl.sprite.position.copy(pos);
    fl.sprite.visible = true;
  }

  light(pos: THREE.Vector3, color: number, intensity = 30, life = 0.25, range = 14): void {
    let best = this.lights[0];
    for (const l of this.lights) if (l.t / l.life > best.t / best.life) best = l;
    best.light.position.copy(pos);
    best.light.color.setHex(color);
    best.light.distance = range;
    best.i0 = intensity;
    best.t = 0;
    best.life = life;
  }

  /** Jagged polyline bolt between two points. */
  bolt(from: THREE.Vector3, to: THREE.Vector3, color: number, opts: { width?: number; life?: number; segments?: number; jag?: number; branches?: number } = {}): void {
    const segs = opts.segments ?? 9;
    const jag = opts.jag ?? 0.45;
    const width = opts.width ?? 0.09;
    const life = opts.life ?? 0.18;
    const pts: THREE.Vector3[] = [from.clone()];
    const dir = _v.subVectors(to, from);
    const len = dir.length();
    for (let i = 1; i < segs; i++) {
      const p = from.clone().addScaledVector(dir, i / segs);
      p.add(randomUnit(_v2).multiplyScalar(jag * Math.min(1, len / 4) * rand(0.4, 1)));
      pts.push(p);
    }
    pts.push(to.clone());
    for (let i = 0; i < pts.length - 1; i++) this.boltSeg(pts[i], pts[i + 1], width, life, color);
    const br = opts.branches ?? 1;
    for (let b = 0; b < br; b++) {
      const start = pts[1 + Math.floor(fxRng.next() * (pts.length - 2))];
      const end = start.clone().add(randomUnit(_v2).multiplyScalar(rand(0.6, 1.4) * Math.max(1, len / 12)));
      this.boltSeg(start, end, width * 0.6, life * 0.8, color);
    }
  }

  private boltSeg(a: THREE.Vector3, b: THREE.Vector3, width: number, life: number, color: number): void {
    if (this.bolts.length >= 400) return;
    const d = _v2.subVectors(b, a);
    const len = d.length();
    if (len < 1e-4) return;
    const quat = new THREE.Quaternion().setFromUnitVectors(Z, d.clone().normalize());
    this.bolts.push({ mid: a.clone().lerp(b, 0.5), quat, len, width, t: 0, life, color: new THREE.Color(color) });
  }

  addTrail(trail: Trail, head: () => THREE.Vector3, done?: () => boolean): void {
    this.group.add(trail.mesh);
    this.trails.push({ trail, head, done });
  }

  removeTrail(trail: Trail): void {
    this.trails = this.trails.filter((t) => t.trail !== trail);
    this.group.remove(trail.mesh);
    trail.dispose();
  }

  /** Immediate-mode tracer streak for this frame (from tail to head). */
  tracer(tail: THREE.Vector3, head: THREE.Vector3, color: number, width: number, intensity = 1): void {
    if (this.tracerN >= this.tracerCap) return;
    const d = _v.subVectors(head, tail);
    const len = d.length();
    if (len < 1e-3) return;
    _q.setFromUnitVectors(Z, d.multiplyScalar(1 / len));
    _s.set(width, width, len);
    _m.compose(tail, _q, _s);
    this.tracerMesh.setMatrixAt(this.tracerN, _m);
    _c.setHex(color).multiplyScalar(GLOW * 1.4 * intensity);
    this.tracerMesh.setColorAt(this.tracerN, _c);
    this.tracerN++;
  }

  /** Physics debris chunks (toon-lit boxes) thrown from a point. */
  debris(pos: THREE.Vector3, colors: number[], count: number, opts: { speed?: [number, number]; size?: [number, number]; up?: number; dir?: THREE.Vector3; spread?: number; life?: [number, number] } = {}): void {
    const n = Math.max(1, Math.round(count * this.scale));
    const [s0, s1] = opts.speed ?? [3, 9];
    const [z0, z1] = opts.size ?? [0.15, 0.45];
    const [l0, l1] = opts.life ?? [4, 8];
    for (let i = 0; i < n; i++) {
      let ch: Chunk;
      if (this.chunks.length < this.chunkCap) {
        ch = { p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), w: new THREE.Vector3(), s: new THREE.Vector3(), c: new THREE.Color(), life: 0, rest: 0 };
        this.chunks.push(ch);
      } else {
        // Recycle the oldest chunk.
        let oldest = this.chunks[0];
        for (const c of this.chunks) if (c.life < oldest.life) oldest = c;
        ch = oldest;
      }
      randomUnit(_v);
      if (opts.dir) _v.lerp(_v2.copy(opts.dir).normalize(), 1 - (opts.spread ?? 0.6)).normalize();
      const sp = rand(s0, s1);
      ch.p.copy(pos).addScaledVector(_v, 0.2);
      ch.v.copy(_v).multiplyScalar(sp);
      ch.v.y += opts.up ?? 3;
      ch.r.set(rand(0, 6), rand(0, 6), rand(0, 6));
      ch.w.set(rand(-8, 8), rand(-8, 8), rand(-8, 8));
      const z = rand(z0, z1);
      ch.s.set(z * rand(0.6, 1.4), z * rand(0.5, 1.2), z * rand(0.6, 1.4));
      ch.c.setHex(colors[Math.floor(fxRng.next() * colors.length)]).offsetHSL(0, 0, rand(-0.04, 0.04));
      ch.life = rand(l0, l1);
      ch.rest = 0;
    }
  }

  /** Projected decal on a surface (normal points away from the surface). */
  decal(pos: THREE.Vector3, normal: THREE.Vector3, size: number, kind: DecalKind, life = 40, tint?: number): void {
    if (!this.decalCap) return;
    const i = this.decalNext++ % this.decalCap;
    const d = this.decals[i] ?? (this.decals[i] = { m: new THREE.Matrix4(), kind: 0, life: 0, max: 1 });
    _q.setFromUnitVectors(Y, _v.copy(normal).normalize());
    _e.set(0, fxRng.next() * Math.PI * 2, 0);
    _q.multiply(new THREE.Quaternion().setFromEuler(_e));
    _s.set(size, 1, size);
    _v2.copy(pos).addScaledVector(_v, 0.02);
    d.m.compose(_v2, _q, _s);
    d.kind = DECAL_INDEX[kind];
    d.life = life;
    d.max = life;
    this.decalMesh.setMatrixAt(i, d.m);
    (this.decalMesh.geometry.getAttribute('atlas') as THREE.InstancedBufferAttribute).setX(i, d.kind);
    _c.setHex(tint ?? 0xffffff);
    this.decalMesh.setColorAt(i, _c);
    this.decalMesh.count = Math.max(this.decalMesh.count, i + 1);
    this.decalMesh.instanceMatrix.needsUpdate = true;
    (this.decalMesh.geometry.getAttribute('atlas') as THREE.InstancedBufferAttribute).needsUpdate = true;
    if (this.decalMesh.instanceColor) this.decalMesh.instanceColor.needsUpdate = true;
  }

  // ------------------------------------------------------------------------------------------
  update(dt: number): void {
    for (const pool of this.pools.values()) this.updatePool(pool, dt);

    for (const r of this.rings) {
      if (!r.active) continue;
      r.t += dt;
      const k = r.t / r.life;
      if (k >= 1) {
        r.active = false;
        r.mesh.visible = false;
        continue;
      }
      if (r.hold) {
        r.mesh.scale.setScalar(r.r1 * (0.96 + 0.04 * Math.sin(r.t * 18)));
        r.mat.opacity = r.baseOpacity * (0.55 + 0.45 * Math.sin(r.t * 14)) * Math.min(1, (1 - k) * 6);
      } else {
        const e = 1 - Math.pow(1 - k, 3);
        r.mesh.scale.setScalar(r.r0 + (r.r1 - r.r0) * e);
        r.mat.opacity = r.baseOpacity * (1 - k);
      }
    }
    for (const s of this.spheres) {
      if (!s.active) continue;
      s.t += dt;
      const k = s.t / s.life;
      if (k >= 1) {
        s.active = false;
        s.mesh.visible = false;
        continue;
      }
      const e = 1 - Math.pow(1 - k, 2);
      s.mesh.scale.setScalar(s.r0 + (s.r1 - s.r0) * e);
      s.mat.opacity = (1 - k) * 0.85;
    }
    for (const fl of this.flashes) {
      if (!fl.active) continue;
      fl.t += dt;
      const k = fl.t / fl.life;
      if (k >= 1) {
        fl.active = false;
        fl.sprite.visible = false;
        continue;
      }
      fl.sprite.scale.setScalar(fl.size * (0.6 + k * 0.8));
      (fl.sprite.material as THREE.SpriteMaterial).opacity = 1 - k;
    }
    for (const l of this.lights) {
      l.t += dt;
      l.light.intensity = l.t < l.life ? l.i0 * (1 - l.t / l.life) : 0;
      l.light.visible = l.light.intensity > 0;
    }
    // Bolts
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.t += dt;
      if (b.t >= b.life) this.bolts.splice(i, 1);
    }
    let bi = 0;
    for (const b of this.bolts) {
      const k = 1 - b.t / b.life;
      const flicker = 0.7 + fxRng.next() * 0.3;
      _s.set(b.width * k * 1.4, b.width * k * 1.4, b.len);
      _m.compose(b.mid, b.quat, _s);
      this.boltMesh.setMatrixAt(bi, _m);
      _c.copy(b.color).multiplyScalar(1.6 * GLOW * k * flicker);
      this.boltMesh.setColorAt(bi, _c);
      bi++;
    }
    this.boltMesh.count = bi;
    this.boltMesh.instanceMatrix.needsUpdate = true;
    if (this.boltMesh.instanceColor) this.boltMesh.instanceColor.needsUpdate = true;
    // Trails
    const camPos = this.camera ? this.camera.position : _v.set(0, 10, 10);
    for (let i = this.trails.length - 1; i >= 0; i--) {
      const t = this.trails[i];
      t.trail.update(dt, t.head(), camPos);
      if (t.done?.() && !t.trail.mesh.visible) this.removeTrail(t.trail);
    }
    this.updateChunks(dt);
    this.updateDecals(dt);
  }

  /** Uploads this frame's tracers; call once per rendered frame after all tracer() calls. */
  flushTracers(): void {
    this.tracerMesh.count = this.tracerN;
    this.tracerMesh.instanceMatrix.needsUpdate = true;
    if (this.tracerMesh.instanceColor) this.tracerMesh.instanceColor.needsUpdate = true;
    this.tracerN = 0;
  }

  private updateChunks(dt: number): void {
    let n = 0;
    for (const ch of this.chunks) {
      if (ch.life <= 0) continue;
      ch.life -= dt;
      const gy = this.ground(ch.p.x, ch.p.z);
      if (ch.rest < 1) {
        ch.v.y -= 22 * dt;
        ch.p.addScaledVector(ch.v, dt);
        ch.r.x += ch.w.x * dt;
        ch.r.y += ch.w.y * dt;
        ch.r.z += ch.w.z * dt;
        const floor = gy + ch.s.y * 0.5;
        if (ch.p.y < floor) {
          ch.p.y = floor;
          ch.v.y *= -0.32;
          ch.v.x *= 0.62;
          ch.v.z *= 0.62;
          ch.w.multiplyScalar(0.6);
          if (Math.abs(ch.v.y) < 0.6 && ch.v.x * ch.v.x + ch.v.z * ch.v.z < 0.5) ch.rest = 1;
        }
      }
      // Sink into the ground in the last second.
      const sink = ch.life < 1 ? (1 - ch.life) * ch.s.y : 0;
      _v.copy(ch.p);
      _v.y -= sink;
      _q.setFromEuler(ch.r);
      _m.compose(_v, _q, ch.s);
      this.chunkMesh.setMatrixAt(n, _m);
      this.chunkMesh.setColorAt(n, ch.c);
      n++;
    }
    this.chunkMesh.count = n;
    this.chunkMesh.instanceMatrix.needsUpdate = true;
    if (this.chunkMesh.instanceColor) this.chunkMesh.instanceColor.needsUpdate = true;
  }

  private updateDecals(dt: number): void {
    let dirty = false;
    for (let i = 0; i < this.decals.length; i++) {
      const d = this.decals[i];
      if (!d || d.life <= 0) continue;
      d.life -= dt;
      if (d.life <= 0) {
        _m.makeScale(0, 0, 0);
        this.decalMesh.setMatrixAt(i, _m);
        dirty = true;
      }
    }
    if (dirty) this.decalMesh.instanceMatrix.needsUpdate = true;
  }

  private updatePool(pool: Pool, dt: number): void {
    const f = pool.f;
    const mesh = pool.mesh;
    let i = 0;
    while (i < pool.n) {
      const o = i * STRIDE;
      f[o + F.life] -= dt;
      if (f[o + F.life] <= 0) {
        const last = (pool.n - 1) * STRIDE;
        if (last !== o) f.copyWithin(o, last, last + STRIDE);
        pool.n--;
        continue;
      }
      const drag = Math.exp(-f[o + F.drag] * dt);
      f[o + F.vx] *= drag;
      f[o + F.vz] *= drag;
      f[o + F.vy] = f[o + F.vy] * drag - f[o + F.grav] * dt;
      f[o + F.px] += f[o + F.vx] * dt;
      f[o + F.py] += f[o + F.vy] * dt;
      f[o + F.pz] += f[o + F.vz] * dt;
      if (!pool.additive && f[o + F.grav] > 0) {
        const gy = this.ground(f[o + F.px], f[o + F.pz]) + 0.05;
        if (f[o + F.py] < gy && f[o + F.py] > gy - 1) {
          f[o + F.py] = gy;
          f[o + F.vy] *= -0.3;
          f[o + F.vx] *= 0.7;
          f[o + F.vz] *= 0.7;
        }
      }
      const k = 1 - f[o + F.life] / f[o + F.max];
      const size = f[o + F.s0] + (f[o + F.s1] - f[o + F.s0]) * k;
      _v.set(f[o + F.px], f[o + F.py], f[o + F.pz]);
      if (pool.shape === 'spark') {
        _v2.set(f[o + F.vx], f[o + F.vy], f[o + F.vz]);
        const sp = _v2.length();
        if (sp > 1e-3) _q.setFromUnitVectors(Z, _v2.multiplyScalar(1 / sp));
        const st = f[o + F.stretch] * clamp(sp / 8, 0.4, 2.2);
        _s.set(size, size, size * st);
      } else {
        f[o + F.rx] += f[o + F.spin] * dt;
        _e.set(f[o + F.rx], f[o + F.ry] + f[o + F.rx] * 0.5, 0);
        _q.setFromEuler(_e);
        _s.set(size, size, size);
      }
      _m.compose(_v, _q, _s);
      mesh.setMatrixAt(i, _m);
      if (pool.additive) {
        const a = Math.pow(1 - k, 0.7) * 1.25 * GLOW;
        _c.setRGB((f[o + F.r0] + (f[o + F.r1] - f[o + F.r0]) * k) * a, (f[o + F.g0] + (f[o + F.g1] - f[o + F.g0]) * k) * a, (f[o + F.b0] + (f[o + F.b1] - f[o + F.b0]) * k) * a);
      } else {
        _c.setRGB(f[o + F.r0], f[o + F.g0], f[o + F.b0]);
      }
      mesh.setColorAt(i, _c);
      i++;
    }
    mesh.count = pool.n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  /** Clears transient effects (between matches). */
  clear(): void {
    for (const p of this.pools.values()) p.n = 0;
    for (const r of this.rings) {
      r.active = false;
      r.mesh.visible = false;
    }
    for (const s of this.spheres) {
      s.active = false;
      s.mesh.visible = false;
    }
    for (const f of this.flashes) {
      f.active = false;
      f.sprite.visible = false;
    }
    this.bolts.length = 0;
    for (const c of this.chunks) c.life = 0;
    for (const d of this.decals) if (d) d.life = 0;
    this.decalMesh.count = 0;
    for (const t of [...this.trails]) this.removeTrail(t.trail);
  }

  dispose(): void {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | undefined;
      if (mat && !Array.isArray(mat) && mat !== MATS._toon) mat.dispose();
    });
    this.radialTex.dispose();
    this.ringTex.dispose();
    this.decalTex.dispose();
    this.group.removeFromParent();
  }
}
