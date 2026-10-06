// Code-built soldier: Elemental Brawl's chunky toy-figure body (boxes per joint, EB proportions)
// dressed as futuristic hard-surface infantry. Each faction/class combination becomes one merged
// geometry with an `aJoint` attribute so the crowd renderer can skin it on the GPU.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { addOutlineNormals, box, cyl, shade, type Xform } from '../render/toon';
import { BUILD as B, J, ANKLE, JOINT_COUNT } from './skeleton';
import { FACTION_PALETTES, type FactionPalette } from './palette';
import type { ClassId, TeamId } from '../config/content';

export interface SkinnedGeometries {
  toon: THREE.BufferGeometry;
  glow: THREE.BufferGeometry;
}

class SkinBuilder {
  private toon: THREE.BufferGeometry[][] = Array.from({ length: JOINT_COUNT }, () => []);
  private glow: THREE.BufferGeometry[][] = Array.from({ length: JOINT_COUNT }, () => []);
  box(j: number, w: number, h: number, d: number, c: number, t?: Xform): void {
    this.toon[j].push(box(w, h, d, c, t));
  }
  cyl(j: number, rt: number, rb: number, h: number, seg: number, c: number, t?: Xform): void {
    this.toon[j].push(cyl(rt, rb, h, seg, c, t));
  }
  glowBox(j: number, w: number, h: number, d: number, c: number, t?: Xform): void {
    this.glow[j].push(box(w, h, d, c, t));
  }
  build(): SkinnedGeometries {
    return { toon: this.mergeJoints(this.toon, true), glow: this.mergeJoints(this.glow, false) };
  }
  private mergeJoints(parts: THREE.BufferGeometry[][], outline: boolean): THREE.BufferGeometry {
    const perJoint: THREE.BufferGeometry[] = [];
    for (let j = 0; j < JOINT_COUNT; j++) {
      if (!parts[j].length) continue;
      const g = parts[j].length === 1 ? parts[j][0] : mergeGeometries(parts[j], false)!;
      // Weld outline normals within the joint only (joints share local coordinates).
      if (outline) addOutlineNormals(g);
      const n = g.getAttribute('position').count;
      g.setAttribute('aJoint', new THREE.BufferAttribute(new Float32Array(n).fill(j), 1));
      perJoint.push(g);
    }
    const merged = perJoint.length ? mergeGeometries(perJoint, false)! : new THREE.BufferGeometry();
    merged.computeBoundingSphere();
    return merged;
  }
}

export function buildSoldierGeometry(team: TeamId, cls: ClassId): SkinnedGeometries {
  const p = FACTION_PALETTES[team];
  const s = new SkinBuilder();
  body(s, p);
  classGear(s, p, cls);
  return s.build();
}

function body(s: SkinBuilder, p: FactionPalette): void {
  const tW = B.torsoW, tH = B.torsoH, tD = B.torsoD;
  // ---- Pelvis and belt
  s.box(J.hips, B.pelvisW, 0.3, tD * 0.92, p.suit, { y: 0.02 });
  s.box(J.hips, B.pelvisW + 0.05, 0.1, tD * 0.98, p.dark, { y: 0.14 });
  s.box(J.hips, B.pelvisW * 0.7, 0.16, 0.05, p.armorShade, { y: -0.02, z: tD * 0.47 });
  s.glowBox(J.hips, 0.14, 0.04, 0.02, p.glow, { y: 0.14, z: tD * 0.5 });
  // ---- Torso: undersuit abdomen, armored chest plate, collar
  s.box(J.spine, tW * 0.84, tH * 0.45, tD * 0.88, p.suit, { y: tH * 0.22 });
  s.box(J.spine, tW, tH * 0.58, tD, p.armor, { y: tH * 0.7 });
  s.box(J.spine, tW * 0.9, tH * 0.2, tD * 1.06, p.secondary, { y: tH * 0.42 });
  s.box(J.spine, tW * 0.62, 0.1, tD * 0.9, p.dark, { y: tH + 0.02 });
  s.box(J.spine, tW * 0.36, tH * 0.3, 0.06, p.armorShade, { y: tH * 0.72, z: tD * 0.52 });
  s.glowBox(J.spine, tW * 0.5, 0.035, 0.02, p.glow, { y: tH * 0.52, z: tD * 0.535 });
  s.glowBox(J.spine, 0.035, 0.12, 0.02, p.glow, { x: tW * 0.36, y: tH * 0.8, z: tD * 0.505 });
  // ---- Neck and helmet (visor strip instead of a face)
  s.box(J.neck, 0.2, 0.12, 0.2, p.dark, { y: 0.04 });
  const hy = B.headH / 2 + 0.08;
  s.box(J.neck, B.headW, B.headH, B.headW * 0.95, p.armor, { y: hy });
  s.box(J.neck, B.headW + 0.04, B.headH * 0.36, B.headW * 0.98, p.secondary, { y: hy + B.headH * 0.28 });
  s.box(J.neck, B.headW * 0.86, B.headH * 0.2, 0.06, p.dark, { y: hy + 0.02, z: B.headW * 0.47 });
  s.glowBox(J.neck, B.headW * 0.78, B.headH * 0.11, 0.03, p.glow, { y: hy + 0.03, z: B.headW * 0.5 });
  s.box(J.neck, B.headW * 0.5, B.headH * 0.2, 0.08, p.armorShade, { y: hy - B.headH * 0.32, z: B.headW * 0.44 });
  s.box(J.neck, 0.08, B.headH * 0.5, B.headW * 0.6, p.armorShade, { x: B.headW * 0.53, y: hy - 0.02 });
  s.box(J.neck, 0.08, B.headH * 0.5, B.headW * 0.6, p.armorShade, { x: -B.headW * 0.53, y: hy - 0.02 });
  // ---- Arms
  for (const side of [1, -1]) {
    const sh = side > 0 ? J.shoulderL : J.shoulderR;
    const el = side > 0 ? J.elbowL : J.elbowR;
    const ha = side > 0 ? J.handL : J.handR;
    s.box(sh, B.armW * 1.45, 0.22, B.armW * 1.4, p.armor, { y: -0.03 });
    s.box(sh, B.armW * 1.5, 0.06, B.armW * 1.45, p.secondary, { y: 0.07 });
    s.box(sh, B.armW, B.upperArm, B.armW, p.suit, { y: -B.upperArm / 2 });
    s.box(el, B.armW * 0.95, B.foreArm, B.armW * 0.95, p.suit, { y: -B.foreArm / 2 });
    s.box(el, B.armW * 1.12, B.foreArm * 0.55, B.armW * 1.1, p.armorShade, { y: -B.foreArm * 0.55 });
    s.glowBox(el, 0.02, B.foreArm * 0.3, 0.06, p.glow, { x: side * B.armW * 0.57, y: -B.foreArm * 0.55 });
    s.box(ha, B.handS, B.handS, B.handS, p.boots, { y: -B.handS / 2 + 0.04 });
    s.box(ha, B.handS * 0.35, B.handS * 0.5, B.handS * 0.6, p.boots, { x: side * -B.handS * 0.45, y: -B.handS * 0.2, z: B.handS * 0.1 });
  }
  // ---- Legs
  for (const side of [1, -1]) {
    const hp = side > 0 ? J.hipL : J.hipR;
    const kn = side > 0 ? J.kneeL : J.kneeR;
    const ft = side > 0 ? J.footL : J.footR;
    s.box(hp, B.legW, B.thigh + 0.06, B.legW * 1.05, p.suit, { y: -B.thigh / 2 });
    s.box(hp, B.legW * 1.08, B.thigh * 0.55, 0.07, p.secondary, { y: -B.thigh * 0.45, z: B.legW * 0.52 });
    s.box(hp, 0.1, B.thigh * 0.4, B.legW * 0.7, p.dark, { x: side * B.legW * 0.55, y: -B.thigh * 0.4 });
    s.box(kn, B.legW * 0.95, B.shin, B.legW, p.suit, { y: -B.shin / 2 });
    s.box(kn, B.legW * 1.05, B.shin * 0.7, 0.08, p.armor, { y: -B.shin * 0.45, z: B.legW * 0.5 });
    s.box(kn, B.legW * 1.1, 0.12, B.legW * 1.12, p.armorShade, { y: -0.02, z: 0.02 });
    s.box(ft, B.bootW, B.bootH, B.bootL, p.boots, { y: -ANKLE + B.bootH / 2, z: B.bootL * 0.16 });
    s.box(ft, B.bootW * 1.06, B.bootH * 0.4, B.bootW * 1.02, p.boots, { y: -ANKLE + B.bootH + 0.02 });
    s.box(ft, B.bootW * 1.04, 0.06, B.bootL * 1.02, shade(p.boots, -0.12), { y: -ANKLE + 0.03, z: B.bootL * 0.16 });
  }
}

/** Class silhouettes: readable at range by backpack and helmet shapes. */
function classGear(s: SkinBuilder, p: FactionPalette, cls: ClassId): void {
  const tH = B.torsoH, tD = B.torsoD, tW = B.torsoW;
  const hy = B.headH / 2 + 0.08;
  if (cls === 'assault') {
    // Chest rig pouches and a chin guard.
    for (let i = -1; i <= 1; i++) s.box(J.spine, 0.14, 0.16, 0.1, p.secondary, { x: i * 0.17, y: tH * 0.3, z: tD * 0.55 });
    s.box(J.spine, tW * 0.7, tH * 0.4, 0.14, p.dark, { y: tH * 0.62, z: -tD * 0.55 });
    s.box(J.neck, B.headW * 0.7, 0.08, 0.1, p.armor, { y: hy - B.headH * 0.44, z: B.headW * 0.38 });
  } else if (cls === 'engineer') {
    // Tool backpack with a side antenna, welding visor brow, heavier pauldrons.
    s.box(J.spine, tW * 0.82, tH * 0.7, 0.26, p.accent, { y: tH * 0.58, z: -tD * 0.62 });
    s.box(J.spine, tW * 0.86, 0.08, 0.3, p.dark, { y: tH * 0.95, z: -tD * 0.62 });
    s.cyl(J.spine, 0.02, 0.02, 0.5, 4, p.dark, { x: tW * 0.32, y: tH * 1.2, z: -tD * 0.7 });
    s.glowBox(J.spine, 0.05, 0.05, 0.05, p.glow, { x: tW * 0.32, y: tH * 1.46, z: -tD * 0.7 });
    s.box(J.neck, B.headW * 0.96, 0.08, 0.14, p.secondary, { y: hy + B.headH * 0.14, z: B.headW * 0.46 });
    s.glowBox(J.neck, 0.06, 0.06, 0.06, 0xffcf6a, { x: B.headW * 0.6, y: hy + 0.06, z: 0.06 });
    s.box(J.shoulderL, B.armW * 1.6, 0.1, B.armW * 1.5, p.armorShade, { y: 0.11 });
    s.box(J.shoulderR, B.armW * 1.6, 0.1, B.armW * 1.5, p.armorShade, { y: 0.11 });
  } else if (cls === 'support') {
    // Large supply pack with a glowing hex emblem and a tall collar.
    s.box(J.spine, tW * 0.96, tH * 0.85, 0.34, p.secondary, { y: tH * 0.52, z: -tD * 0.66 });
    s.box(J.spine, tW * 0.7, tH * 0.2, 0.36, p.dark, { y: tH * 0.08, z: -tD * 0.66 });
    s.glowBox(J.spine, 0.16, 0.16, 0.02, p.glow, { y: tH * 0.62, z: -tD * 0.85, rz: Math.PI / 4 });
    s.box(J.spine, tW * 0.7, 0.12, tD * 0.6, p.armor, { y: tH + 0.08, z: -0.04 });
    s.box(J.neck, B.headW + 0.06, 0.06, B.headW * 0.4, p.secondary, { y: hy + B.headH * 0.5, z: -0.05 });
  } else {
    // Recon: hood cowl, mono-lens and antenna; slim back module.
    s.box(J.neck, B.headW + 0.1, B.headH * 0.6, B.headW * 0.5, p.dark, { y: hy + 0.04, z: -B.headW * 0.3 });
    s.box(J.neck, B.headW + 0.06, 0.1, B.headW * 0.7, p.dark, { y: hy + B.headH * 0.5, z: -B.headW * 0.1 });
    s.glowBox(J.neck, 0.1, 0.1, 0.05, p.glow, { x: -0.12, y: hy + 0.04, z: B.headW * 0.52 });
    s.cyl(J.neck, 0.012, 0.012, 0.42, 4, p.dark, { x: B.headW * 0.42, y: hy + B.headH * 0.65, z: -0.1 });
    s.box(J.spine, tW * 0.5, tH * 0.55, 0.16, p.dark, { y: tH * 0.6, z: -tD * 0.58 });
    s.box(J.spine, tW * 0.96, tH * 0.65, 0.04, p.dark, { y: tH * 0.45, z: -tD * 0.72 });
  }
}

/** First-person arms (shared shape language with the third-person body). */
export function buildArmsGeometry(team: TeamId): { left: THREE.BufferGeometry[]; right: THREE.BufferGeometry[]; glow: THREE.BufferGeometry[] } {
  const p = FACTION_PALETTES[team];
  const sleeve = (side: number): THREE.BufferGeometry[] => [
    // Forearm along -Z from the elbow (origin) to the wrist at z = -0.3.
    box(0.075, 0.075, 0.32, p.suit, { z: -0.16 }),
    box(0.09, 0.085, 0.18, p.armorShade, { z: -0.2 }),
    box(0.1, 0.09, 0.09, p.boots, { z: -0.355 }),
    box(0.03, 0.05, 0.06, p.boots, { x: side * -0.045, y: -0.02, z: -0.37 }),
  ];
  return {
    left: sleeve(1),
    right: sleeve(-1),
    glow: [box(0.01, 0.02, 0.08, p.glow, { x: 0.046, y: 0.0, z: -0.2 }), box(0.01, 0.02, 0.08, p.glow, { x: -0.046, y: 0.0, z: -0.2 })],
  };
}
