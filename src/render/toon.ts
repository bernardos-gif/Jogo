// Elemental Brawl's shading, adapted for Vector Front (see STYLE_GUIDE.md sections 2 and 3):
// a shared 3-step toon ramp, vertex-colored flat-shaded primitive parts merged per material,
// unlit glow materials pushed above 1.0 so they bloom, and inverted-hull outlines with welded
// normals. The outline shader also supports InstancedMesh.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ------------------------------------------------------------------------------------------------
// Constants (style values; not gameplay numbers)
export const OUTLINE_WORLD = 0x140a10;
export const OUTLINE_CHAR = 0x0b0610;
export const OUTLINE_WORLD_THICKNESS = 0.035;
export const OUTLINE_CHAR_THICKNESS = 0.032;
/** Outline growth with view depth: a constant ~2 px line on screen. */
export const OUTLINE_DEPTH_SCALE = 0.0021;
export const GLOW_RIG = 1.9;
export const GLOW_LAMP = 1.5;
export const GLOW_CORE = 2.2;
export const GLOW_ADD = 2.0;

// ------------------------------------------------------------------------------------------------
let gradient: THREE.DataTexture | null = null;
/** The shared 3-step ramp: 90 / 175 / 255. */
export function toonGradient(): THREE.DataTexture {
  if (gradient) return gradient;
  const data = new Uint8Array([90, 90, 90, 255, 175, 175, 175, 255, 255, 255, 255, 255]);
  gradient = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  gradient.minFilter = THREE.NearestFilter;
  gradient.magFilter = THREE.NearestFilter;
  gradient.generateMipmaps = false;
  gradient.needsUpdate = true;
  return gradient;
}

export function toonMaterial(color: THREE.ColorRepresentation = 0xffffff, vertexColors = false): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color: vertexColors ? 0xffffff : color, gradientMap: toonGradient(), vertexColors });
}

/** Unlit glowing material for emissive details; `k` > 1 makes it bloom. */
export function glowMaterial(k = GLOW_RIG, vertexColors = true, color: THREE.ColorRepresentation = 0xffffff): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ color: vertexColors ? 0xffffff : color, vertexColors, toneMapped: false });
  m.color.multiplyScalar(k);
  return m;
}

/** Additive translucent shell (effect halos). */
export function additiveMaterial(color: THREE.ColorRepresentation, opacity = 0.6): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  m.color.multiplyScalar(GLOW_ADD);
  return m;
}

// ------------------------------------------------------------------------------------------------
// Inverted-hull outline
const OUTLINE_VERT = /* glsl */ `
  attribute vec3 outlineNormal;
  uniform float thickness;
  uniform float depthScale;
  #include <common>
  #include <fog_pars_vertex>
  void main() {
    vec4 local = vec4(position, 1.0);
    vec3 n = outlineNormal;
    #ifdef USE_INSTANCING
      local = instanceMatrix * local;
      n = mat3(instanceMatrix) * n;
    #endif
    vec4 mvPosition = modelViewMatrix * local;
    vec3 vn = normalize(normalMatrix * n);
    float w = max(thickness, -mvPosition.z * depthScale);
    mvPosition.xyz += vn * w;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;
const OUTLINE_FRAG = /* glsl */ `
  uniform vec3 color;
  uniform float opacity;
  #include <common>
  #include <fog_pars_fragment>
  void main() {
    gl_FragColor = vec4(color, opacity);
    #include <fog_fragment>
  }
`;

export function outlineMaterial(color: THREE.ColorRepresentation = OUTLINE_WORLD, thickness = OUTLINE_WORLD_THICKNESS): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      { color: { value: new THREE.Color(color) }, thickness: { value: thickness }, depthScale: { value: OUTLINE_DEPTH_SCALE }, opacity: { value: 1 } },
    ]),
    vertexShader: OUTLINE_VERT,
    fragmentShader: OUTLINE_FRAG,
    side: THREE.BackSide,
    fog: true,
  });
}

/** Adds the position-welded `outlineNormal` attribute (gap-free hulls on hard-edged boxes). */
export function addOutlineNormals(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const nor = geo.getAttribute('normal') as THREE.BufferAttribute;
  const acc = new Map<string, [number, number, number]>();
  const keys: string[] = new Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const k = `${Math.round(pos.getX(i) * 1000)},${Math.round(pos.getY(i) * 1000)},${Math.round(pos.getZ(i) * 1000)}`;
    keys[i] = k;
    const a = acc.get(k);
    if (a) {
      a[0] += nor.getX(i);
      a[1] += nor.getY(i);
      a[2] += nor.getZ(i);
    } else acc.set(k, [nor.getX(i), nor.getY(i), nor.getZ(i)]);
  }
  const out = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const a = acc.get(keys[i])!;
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    out[i * 3] = a[0] / l;
    out[i * 3 + 1] = a[1] / l;
    out[i * 3 + 2] = a[2] / l;
  }
  geo.setAttribute('outlineNormal', new THREE.BufferAttribute(out, 3));
  return geo;
}

// ------------------------------------------------------------------------------------------------
// Part kit: vertex-colored, non-indexed, flat-shaded pieces merged into one mesh per material.
export interface Xform {
  x?: number;
  y?: number;
  z?: number;
  rx?: number;
  ry?: number;
  rz?: number;
  sx?: number;
  sy?: number;
  sz?: number;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

export function xformMatrix(t: Xform = {}, out = _m): THREE.Matrix4 {
  _p.set(t.x || 0, t.y || 0, t.z || 0);
  _e.set(t.rx || 0, t.ry || 0, t.rz || 0);
  _q.setFromEuler(_e);
  _s.set(t.sx ?? 1, t.sy ?? 1, t.sz ?? 1);
  return out.compose(_p, _q, _s);
}

/** Converts any geometry into a non-indexed, vertex-colored, flat-shaded part. */
export function part(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, t?: Xform): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const name of Object.keys(g.attributes)) if (name !== 'position') g.deleteAttribute(name);
  g.applyMatrix4(xformMatrix(t));
  g.computeVertexNormals();
  const c = new THREE.Color(color);
  const n = g.getAttribute('position').count;
  const cols = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    cols[i * 3] = c.r;
    cols[i * 3 + 1] = c.g;
    cols[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  geo.dispose();
  return g;
}

export const box = (w: number, h: number, d: number, color: THREE.ColorRepresentation, t?: Xform) => part(new THREE.BoxGeometry(w, h, d), color, t);
export const cyl = (rt: number, rb: number, h: number, seg: number, color: THREE.ColorRepresentation, t?: Xform) =>
  part(new THREE.CylinderGeometry(rt, rb, h, seg), color, t);
export const cone = (r: number, h: number, seg: number, color: THREE.ColorRepresentation, t?: Xform) => part(new THREE.ConeGeometry(r, h, seg), color, t);
export const ico = (r: number, color: THREE.ColorRepresentation, t?: Xform, detail = 0) => part(new THREE.IcosahedronGeometry(r, detail), color, t);
export const octa = (r: number, color: THREE.ColorRepresentation, t?: Xform) => part(new THREE.OctahedronGeometry(r), color, t);
export const dodeca = (r: number, color: THREE.ColorRepresentation, t?: Xform) => part(new THREE.DodecahedronGeometry(r), color, t);
export const tetra = (r: number, color: THREE.ColorRepresentation, t?: Xform) => part(new THREE.TetrahedronGeometry(r), color, t);
export const torus = (r: number, tube: number, rs: number, ts: number, color: THREE.ColorRepresentation, t?: Xform, arc = Math.PI * 2) =>
  part(new THREE.TorusGeometry(r, tube, rs, ts, arc), color, t);
/** Extruded 2D polygon (x,y pairs) of depth d along z, centered on z. */
export function prism(points: [number, number][], d: number, color: THREE.ColorRepresentation, t?: Xform): THREE.BufferGeometry {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false });
  g.translate(0, 0, -d / 2);
  return part(g, color, t);
}

/** Merges parts into one geometry (optionally with outline normals). Consumes the inputs. */
export function merge(parts: THREE.BufferGeometry[], withOutline = true): THREE.BufferGeometry {
  if (!parts.length) {
    const empty = new THREE.BufferGeometry();
    empty.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
    return empty;
  }
  const g = parts.length === 1 ? parts[0] : mergeGeometries(parts, false)!;
  if (parts.length > 1) for (const p of parts) p.dispose();
  if (withOutline) addOutlineNormals(g);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

/** Recolors every vertex of a part (used for team variants of a shared shape). */
export function tint(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation): THREE.BufferGeometry {
  const c = new THREE.Color(color);
  const col = geo.getAttribute('color') as THREE.BufferAttribute;
  for (let i = 0; i < col.count; i++) col.setXYZ(i, c.r, c.g, c.b);
  col.needsUpdate = true;
  return geo;
}

/** Shift HSL lightness (EB's shade helper). */
export function shade(hex: number, amount: number): number {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l + amount)));
  return c.getHex();
}

// ------------------------------------------------------------------------------------------------
/** Shared materials for static world geometry. */
export const MATS = {
  _toon: null as THREE.MeshToonMaterial | null,
  _outline: null as THREE.ShaderMaterial | null,
  _outlineChar: null as THREE.ShaderMaterial | null,
  _lamp: null as THREE.MeshBasicMaterial | null,
  _glow: null as THREE.MeshBasicMaterial | null,
  get toon(): THREE.MeshToonMaterial {
    return (this._toon ||= toonMaterial(0xffffff, true));
  },
  get outline(): THREE.ShaderMaterial {
    return (this._outline ||= outlineMaterial(OUTLINE_WORLD, OUTLINE_WORLD_THICKNESS));
  },
  get outlineChar(): THREE.ShaderMaterial {
    return (this._outlineChar ||= outlineMaterial(OUTLINE_CHAR, OUTLINE_CHAR_THICKNESS));
  },
  get lamp(): THREE.MeshBasicMaterial {
    return (this._lamp ||= glowMaterial(GLOW_LAMP));
  },
  get glow(): THREE.MeshBasicMaterial {
    return (this._glow ||= glowMaterial(GLOW_RIG));
  },
};

/** A toon mesh with its outline hull attached as a child. */
export function outlinedMesh(geo: THREE.BufferGeometry, outline: THREE.Material | null = MATS.outline, mat: THREE.Material = MATS.toon, castShadow = true): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  if (outline) {
    if (!geo.getAttribute('outlineNormal')) addOutlineNormals(geo);
    const o = new THREE.Mesh(geo, outline);
    o.castShadow = false;
    o.receiveShadow = false;
    o.name = 'outline';
    mesh.add(o);
  }
  return mesh;
}

/** Collects toon and glow parts and builds a Group (toon mesh + outline, glow mesh). */
export class ModelBuilder {
  readonly toon: THREE.BufferGeometry[] = [];
  readonly glow: THREE.BufferGeometry[] = [];
  add(g: THREE.BufferGeometry): this {
    this.toon.push(g);
    return this;
  }
  addGlow(g: THREE.BufferGeometry): this {
    this.glow.push(g);
    return this;
  }
  box(w: number, h: number, d: number, color: number, t?: Xform): this {
    return this.add(box(w, h, d, color, t));
  }
  glowBox(w: number, h: number, d: number, color: number, t?: Xform): this {
    return this.addGlow(box(w, h, d, color, t));
  }
  cyl(rt: number, rb: number, h: number, seg: number, color: number, t?: Xform): this {
    return this.add(cyl(rt, rb, h, seg, color, t));
  }
  build(opts: { outline?: THREE.Material | null; glowMat?: THREE.Material; castShadow?: boolean } = {}): THREE.Group {
    const g = new THREE.Group();
    if (this.toon.length) g.add(outlinedMesh(merge(this.toon, opts.outline !== null), opts.outline === undefined ? MATS.outline : opts.outline, MATS.toon, opts.castShadow ?? true));
    if (this.glow.length) {
      const gm = new THREE.Mesh(merge(this.glow, false), opts.glowMat ?? MATS.glow);
      gm.name = 'glow';
      g.add(gm);
    }
    this.toon.length = 0;
    this.glow.length = 0;
    return g;
  }
  /** Merged geometries without creating meshes (for instancing and skinning). */
  geometries(withOutline = true): { toon: THREE.BufferGeometry | null; glow: THREE.BufferGeometry | null } {
    const toon = this.toon.length ? merge(this.toon, withOutline) : null;
    const glow = this.glow.length ? merge(this.glow, false) : null;
    this.toon.length = 0;
    this.glow.length = 0;
    return { toon, glow };
  }
}

export function disposeObject(obj: THREE.Object3D): void {
  const shared = new Set<THREE.Material | null>([MATS._toon, MATS._outline, MATS._outlineChar, MATS._lamp, MATS._glow]);
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry && !m.userData.sharedGeo) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (mat && !m.userData.sharedMat) for (const mm of Array.isArray(mat) ? mat : [mat]) if (!shared.has(mm)) mm.dispose();
  });
}
