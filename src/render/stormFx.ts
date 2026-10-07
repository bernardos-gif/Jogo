// Ion storm visuals: three nested funnel layers with banded, scrolling swirl and crackling arc
// lines (quantized like the sky shader so it reads as toon), a dark toon cloud cap, and instanced
// debris chunks orbiting the funnel. Lightning, dust skirts and flashes come from the VFX system.
import * as THREE from 'three';
import { toonMaterial } from './toon';

const FUNNEL_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const FUNNEL_FRAG = /* glsl */ `
  varying vec2 vUv;
  uniform float time;
  uniform float speed;
  uniform float alpha;
  uniform vec3 colA;
  uniform vec3 colB;
  uniform vec3 glow;
  void main() {
    float swirl = vUv.x * 5.0 + vUv.y * 4.0 - time * speed;
    float band = step(0.5, fract(swirl));
    vec3 c = mix(colA, colB, band * 0.55 + vUv.y * 0.45);
    float wob = sin(vUv.y * 14.0 + time * 6.0) * 0.08;
    float arc = step(0.985, fract(vUv.x * 3.0 + wob + time * 0.9 * speed));
    float flick = step(0.5, fract(sin(floor(time * 9.0) * 12.9898) * 43758.5453));
    c = mix(c, glow * 2.4, arc * flick);
    c = floor(c * 20.0) / 20.0;
    float a = alpha * smoothstep(0.0, 0.06, vUv.y) * (1.0 - smoothstep(0.8, 1.0, vUv.y)) * (0.75 + band * 0.25);
    gl_FragColor = vec4(c, a);
  }
`;

interface Layer {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  spin: number;
  phase: number;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();

export class StormVisual {
  readonly group = new THREE.Group();
  private layers: Layer[] = [];
  private cap: THREE.InstancedMesh;
  private debris: THREE.InstancedMesh;
  private orbit: { r: number; h: number; a: number; w: number; size: number; spin: number }[] = [];
  private t = 0;

  constructor(scene: THREE.Scene, height: number) {
    const specs = [
      { r0: 3, r1: 26, spin: 1.6, speed: 2.4, colA: 0x2a2440, colB: 0x6a5a8a, alpha: 0.85 },
      { r0: 6, r1: 40, spin: 1.1, speed: 1.7, colA: 0x3a3456, colB: 0x8a7aa0, alpha: 0.6 },
      { r0: 10, r1: 58, spin: 0.7, speed: 1.2, colA: 0x4a4466, colB: 0x9a8aa8, alpha: 0.38 },
    ];
    for (const sp of specs) {
      const pts: THREE.Vector2[] = [];
      const n = 12;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        pts.push(new THREE.Vector2(sp.r0 + (sp.r1 - sp.r0) * Math.pow(t, 1.8) + Math.sin(t * 9) * 0.6, t * height));
      }
      const geo = new THREE.LatheGeometry(pts, 14);
      const mat = new THREE.ShaderMaterial({
        vertexShader: FUNNEL_VERT,
        fragmentShader: FUNNEL_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: {
          time: { value: 0 },
          speed: { value: sp.speed },
          alpha: { value: sp.alpha },
          colA: { value: new THREE.Color(sp.colA) },
          colB: { value: new THREE.Color(sp.colB) },
          glow: { value: new THREE.Color(0x7cf0ff) },
        },
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      this.group.add(mesh);
      this.layers.push({ mesh, mat, spin: sp.spin, phase: Math.random() * 10 });
    }
    // Cloud cap: flattened toon puffs.
    const capN = 34;
    this.cap = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), toonMaterial(0xffffff), capN);
    this.cap.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capN * 3), 3);
    const c = new THREE.Color();
    for (let i = 0; i < capN; i++) {
      const a = (i / capN) * Math.PI * 2 * 3.1;
      const r = 20 + (i / capN) * 130;
      const sz = 22 + Math.random() * 26;
      _p.set(Math.cos(a) * r, height + (Math.random() - 0.3) * 12, Math.sin(a) * r);
      _s.set(sz * 1.5, sz * 0.45, sz * 1.3);
      _q.setFromEuler(_e.set(0, Math.random() * 6, 0));
      _m.compose(_p, _q, _s);
      this.cap.setMatrixAt(i, _m);
      this.cap.setColorAt(i, c.setHex(i % 3 === 0 ? 0x4a4466 : i % 3 === 1 ? 0x2e2a44 : 0x5a5070));
    }
    this.cap.frustumCulled = false;
    this.group.add(this.cap);
    // Debris orbiting the funnel.
    const dn = 70;
    this.debris = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), toonMaterial(0xffffff), dn);
    this.debris.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(dn * 3), 3);
    const tints = [0x6a5a50, 0x5a5f6e, 0x8a7464, 0x3a3a44, 0xc04a3a];
    for (let i = 0; i < dn; i++) {
      const h = Math.pow(Math.random(), 1.4) * height * 0.7;
      this.orbit.push({ r: 4 + (h / height) * 40 + Math.random() * 8, h, a: Math.random() * Math.PI * 2, w: 1.4 + Math.random() * 1.2, size: 0.3 + Math.random() * 1.4, spin: Math.random() * 4 });
      this.debris.setColorAt(i, c.setHex(tints[i % tints.length]));
    }
    this.debris.frustumCulled = false;
    this.debris.castShadow = true;
    this.group.add(this.debris);
    this.group.visible = false;
    scene.add(this.group);
  }

  /** Places the storm and animates it; `intensity` 0..1 fades it in and out. */
  update(dt: number, pos: THREE.Vector3, intensity: number): void {
    this.t += dt;
    this.group.visible = intensity > 0.01;
    if (!this.group.visible) return;
    this.group.position.copy(pos);
    const sc = 0.35 + 0.65 * intensity;
    this.group.scale.set(sc, 0.6 + 0.4 * intensity, sc);
    for (const l of this.layers) {
      l.mat.uniforms.time.value = this.t + l.phase;
      l.mesh.rotation.y += l.spin * dt;
      // A meandering, leaning funnel.
      l.mesh.position.set(Math.sin(this.t * 0.5 + l.phase) * 2.5, 0, Math.cos(this.t * 0.4 + l.phase) * 2.5);
      l.mesh.rotation.z = Math.sin(this.t * 0.3 + l.phase) * 0.06;
    }
    this.cap.rotation.y += dt * 0.12;
    for (let i = 0; i < this.orbit.length; i++) {
      const o = this.orbit[i];
      o.a += (o.w * dt * 18) / (6 + o.r);
      _p.set(Math.cos(o.a) * o.r, o.h + Math.sin(this.t * 1.7 + i) * 3, Math.sin(o.a) * o.r);
      _q.setFromEuler(_e.set(this.t * o.spin, this.t * o.spin * 0.7, 0));
      _s.setScalar(o.size);
      _m.compose(_p, _q, _s);
      this.debris.setMatrixAt(i, _m);
    }
    this.debris.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    for (const l of this.layers) {
      l.mesh.geometry.dispose();
      l.mat.dispose();
    }
    this.cap.geometry.dispose();
    this.debris.geometry.dispose();
    this.group.removeFromParent();
  }
}
