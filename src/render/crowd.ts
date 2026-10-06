// Skinned crowd renderer. Every soldier of one faction/class shares a merged geometry whose
// vertices carry a joint index; per-instance joint matrices live in a float texture (one row per
// instance), so the whole crowd draws in a handful of calls while keeping the toon shading,
// inverted-hull outlines, glow details, hit flashes and shadows of Elemental Brawl's rigs.
import * as THREE from 'three';
import { toonMaterial, glowMaterial, GLOW_RIG, OUTLINE_CHAR, OUTLINE_CHAR_THICKNESS, OUTLINE_DEPTH_SCALE } from './toon';
import { buildSoldierGeometry } from '../art/soldierModel';
import { JOINT_COUNT } from '../art/skeleton';
import type { ClassId, TeamId } from '../config/content';

const SLOTS = 16; // 15 joints + 1 info slot
const TEX_W = SLOTS * 4;
const INFO = JOINT_COUNT * 4;

const SKIN_PARS = /* glsl */ `
  uniform highp sampler2D boneTex;
  attribute float aJoint;
  varying float vFlash;
  mat4 vfJoint(int j) {
    int row = gl_InstanceID;
    return mat4(
      texelFetch(boneTex, ivec2(j * 4, row), 0),
      texelFetch(boneTex, ivec2(j * 4 + 1, row), 0),
      texelFetch(boneTex, ivec2(j * 4 + 2, row), 0),
      texelFetch(boneTex, ivec2(j * 4 + 3, row), 0));
  }
`;

function patchSkinned(mat: THREE.Material, tex: { value: THREE.DataTexture }, key: string, flash: boolean): void {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.boneTex = tex;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + SKIN_PARS)
      .replace(
        '#include <begin_vertex>',
        `mat4 vfJm = vfJoint(int(aJoint + 0.5));
         vec3 transformed = (vfJm * vec4(position, 1.0)).xyz;
         vFlash = texelFetch(boneTex, ivec2(${INFO}, gl_InstanceID), 0).x;`,
      );
    if (sh.vertexShader.includes('#include <beginnormal_vertex>')) {
      sh.vertexShader = sh.vertexShader.replace(
        '#include <beginnormal_vertex>',
        `vec3 objectNormal = mat3(vfJoint(int(aJoint + 0.5))) * vec3(normal);
         #ifdef USE_TANGENT
           vec3 objectTangent = vec3(tangent.xyz);
         #endif`,
      );
    }
    if (flash) {
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vFlash;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += vec3(1.0, 0.96, 0.9) * vFlash;');
    }
  };
  mat.customProgramCacheKey = () => key;
}

const OUTLINE_VERT = /* glsl */ `
  attribute vec3 outlineNormal;
  uniform float thickness;
  uniform float depthScale;
  #include <common>
  #include <fog_pars_vertex>
  ${SKIN_PARS}
  void main() {
    mat4 jm = vfJoint(int(aJoint + 0.5));
    vec4 mvPosition = modelViewMatrix * (jm * vec4(position, 1.0));
    vec3 vn = normalize(normalMatrix * (mat3(jm) * outlineNormal));
    float w = max(thickness, -mvPosition.z * depthScale);
    mvPosition.xyz += vn * w;
    gl_Position = projectionMatrix * mvPosition;
    vFlash = 0.0;
    #include <fog_vertex>
  }
`;
const OUTLINE_FRAG = /* glsl */ `
  uniform vec3 color;
  #include <common>
  #include <fog_pars_fragment>
  void main() {
    gl_FragColor = vec4(color, 1.0);
    #include <fog_fragment>
  }
`;

class ComboMesh {
  readonly tex: THREE.DataTexture;
  readonly data: Float32Array;
  readonly body: THREE.InstancedMesh;
  readonly outline: THREE.InstancedMesh;
  readonly glow: THREE.InstancedMesh;
  n = 0;

  constructor(
    group: THREE.Group,
    team: TeamId,
    cls: ClassId,
    readonly cap: number,
  ) {
    this.data = new Float32Array(TEX_W * cap * 4);
    this.tex = new THREE.DataTexture(this.data, TEX_W, cap, THREE.RGBAFormat, THREE.FloatType);
    this.tex.minFilter = THREE.NearestFilter;
    this.tex.magFilter = THREE.NearestFilter;
    this.tex.generateMipmaps = false;
    this.tex.needsUpdate = true;
    const uniform = { value: this.tex };
    const geo = buildSoldierGeometry(team, cls);
    const key = `crowd-${team}-${cls}`;

    const toon = toonMaterial(0xffffff, true);
    patchSkinned(toon, uniform, key + '-toon', true);
    this.body = new THREE.InstancedMesh(geo.toon, toon, cap);
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    patchSkinned(depth, uniform, key + '-depth', false);
    this.body.customDepthMaterial = depth;
    this.body.castShadow = true;
    this.body.receiveShadow = true;

    const outlineMat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { color: { value: new THREE.Color(OUTLINE_CHAR) }, thickness: { value: OUTLINE_CHAR_THICKNESS }, depthScale: { value: OUTLINE_DEPTH_SCALE } }]),
      vertexShader: OUTLINE_VERT,
      fragmentShader: OUTLINE_FRAG,
      side: THREE.BackSide,
      fog: true,
    });
    outlineMat.uniforms.boneTex = uniform;
    this.outline = new THREE.InstancedMesh(geo.toon, outlineMat, cap);
    this.outline.name = 'outline';

    const glow = glowMaterial(GLOW_RIG);
    patchSkinned(glow, uniform, key + '-glow', false);
    this.glow = new THREE.InstancedMesh(geo.glow, glow, cap);

    for (const m of [this.body, this.outline, this.glow]) {
      m.frustumCulled = false;
      m.count = 0;
      group.add(m);
    }
    this.outline.castShadow = false;
    this.glow.castShadow = false;
  }

  push(joints: Float32Array, flash: number): boolean {
    if (this.n >= this.cap) return false;
    const row = this.n * TEX_W * 4;
    this.data.set(joints.subarray(0, JOINT_COUNT * 16), row);
    this.data[row + INFO * 4] = flash;
    this.n++;
    return true;
  }

  flush(): void {
    for (const m of [this.body, this.outline, this.glow]) {
      m.count = this.n;
      m.visible = this.n > 0;
    }
    if (this.n > 0) this.tex.needsUpdate = true;
    this.n = 0;
  }

  dispose(): void {
    this.tex.dispose();
    this.body.geometry.dispose();
    this.glow.geometry.dispose();
    for (const m of [this.body, this.outline, this.glow]) {
      (m.material as THREE.Material).dispose();
      m.removeFromParent();
    }
    this.body.customDepthMaterial?.dispose();
  }
}

export class CrowdRenderer {
  readonly group = new THREE.Group();
  private combos = new Map<string, ComboMesh>();

  constructor(scene: THREE.Scene, readonly capPerCombo = 40) {
    scene.add(this.group);
  }

  private combo(team: TeamId, cls: ClassId): ComboMesh {
    const k = `${team}-${cls}`;
    let c = this.combos.get(k);
    if (!c) {
      c = new ComboMesh(this.group, team, cls, this.capPerCombo);
      this.combos.set(k, c);
    }
    return c;
  }

  /** Builds all eight faction/class meshes up front (avoids shader compiles mid-match). */
  warm(): void {
    for (const t of [0, 1] as TeamId[]) for (const c of ['assault', 'engineer', 'support', 'recon'] as ClassId[]) this.combo(t, c);
  }

  submit(team: TeamId, cls: ClassId, joints: Float32Array, flash: number): void {
    this.combo(team, cls).push(joints, flash);
  }

  flush(): void {
    for (const c of this.combos.values()) c.flush();
  }

  dispose(): void {
    for (const c of this.combos.values()) c.dispose();
    this.combos.clear();
    this.group.removeFromParent();
  }
}
