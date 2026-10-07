// Code-built vehicles in the faction's colors. Local frame: nose toward -Z, up +Y, origin at the
// hull center on the ground plane of the hover pads. Animated parts (turret, barrel, rotors,
// nacelles, chin turret) are separate objects; anchors give seats, muzzles and thrusters.
import * as THREE from 'three';
import { box, cyl, cone, merge, outlinedMesh, MATS, glowMaterial, GLOW_RIG, prism, shade, type Xform } from '../render/toon';
import { FACTION_PALETTES } from './palette';
import type { TeamId, VehicleKind } from '../config/content';

export interface VehicleModel {
  root: THREE.Group;
  turret: THREE.Object3D | null;
  barrel: THREE.Object3D | null;
  coax: THREE.Object3D | null;
  rotor: THREE.Object3D | null;
  tailRotor: THREE.Object3D | null;
  nacelles: THREE.Object3D[];
  chin: THREE.Object3D | null;
  chinGun: THREE.Object3D | null;
  /** Seat hip positions (local). */
  seats: THREE.Vector3[];
  /** Muzzles: in the barrel / coax / chinGun / root frames respectively. */
  muzzleMain: THREE.Vector3;
  muzzleCoax: THREE.Vector3;
  muzzleChin: THREE.Vector3;
  muzzleRockets: THREE.Vector3[];
  /** Hover pad / thruster points (local), for dust and glow. */
  pads: THREE.Vector3[];
  half: THREE.Vector3;
  centerY: number;
  glowMat: THREE.MeshBasicMaterial;
}

class Kit {
  toon: THREE.BufferGeometry[] = [];
  glow: THREE.BufferGeometry[] = [];
  b(w: number, h: number, d: number, c: number, t?: Xform): this {
    this.toon.push(box(w, h, d, c, t));
    return this;
  }
  c(rt: number, rb: number, h: number, seg: number, c: number, t?: Xform): this {
    this.toon.push(cyl(rt, rb, h, seg, c, t));
    return this;
  }
  g(w: number, h: number, d: number, c: number, t?: Xform): this {
    this.glow.push(box(w, h, d, c, t));
    return this;
  }
  p(pts: [number, number][], d: number, c: number, t?: Xform): this {
    this.toon.push(prism(pts, d, c, t));
    return this;
  }
  build(glowMat: THREE.Material): THREE.Group {
    const g = new THREE.Group();
    if (this.toon.length) g.add(outlinedMesh(merge(this.toon, true), MATS.outlineChar, MATS.toon, true));
    if (this.glow.length) g.add(new THREE.Mesh(merge(this.glow, false), glowMat));
    this.toon = [];
    this.glow = [];
    return g;
  }
}

function empty(glowMat: THREE.MeshBasicMaterial): VehicleModel {
  return {
    root: new THREE.Group(),
    turret: null,
    barrel: null,
    coax: null,
    rotor: null,
    tailRotor: null,
    nacelles: [],
    chin: null,
    chinGun: null,
    seats: [],
    muzzleMain: new THREE.Vector3(),
    muzzleCoax: new THREE.Vector3(),
    muzzleChin: new THREE.Vector3(),
    muzzleRockets: [],
    pads: [],
    half: new THREE.Vector3(1, 1, 1),
    centerY: 0.5,
    glowMat,
  };
}

export function buildVehicleModel(kind: VehicleKind, team: TeamId): VehicleModel {
  const glowMat = glowMaterial(GLOW_RIG);
  switch (kind) {
    case 'wisp':
      return wisp(team, glowMat);
    case 'basalt':
      return basalt(team, glowMat);
    case 'condor':
      return condor(team, glowMat);
    case 'midge':
      return midge(team, glowMat);
  }
}

function wisp(team: TeamId, gm: THREE.MeshBasicMaterial): VehicleModel {
  const P = FACTION_PALETTES[team];
  const m = empty(gm);
  const k = new Kit();
  // Low wedge chassis on four hover pods.
  k.b(2.0, 0.35, 3.6, P.vehicleBase, { y: 0.55 });
  k.p([[-1.0, 0], [1.0, 0], [0.8, 0.35], [-0.8, 0.35]], 1.0, P.vehicleBase, { y: 0.72, z: -1.3 });
  k.b(2.1, 0.12, 3.7, P.dark, { y: 0.38 });
  k.b(1.8, 0.25, 0.4, P.vehicleShade, { y: 0.78, z: 1.6 });
  // Roll cage.
  // Tall enough that seated heads (and first-person cameras) sit under the top rails.
  for (const x of [-0.85, 0.85]) {
    k.b(0.08, 1.4, 0.08, P.dark, { x, y: 1.4, z: 0.3 });
    k.b(0.08, 0.08, 1.6, P.dark, { x, y: 2.08, z: -0.35 });
    k.b(0.08, 1.2, 0.08, P.dark, { x, y: 1.45, z: -1.1, rx: 0.42 });
  }
  k.b(1.78, 0.08, 0.08, P.dark, { y: 2.08, z: 0.3 });
  // Seats.
  k.b(0.55, 0.15, 0.55, P.dark, { x: 0.45, y: 0.85, z: -0.2 });
  k.b(0.55, 0.6, 0.12, P.dark, { x: 0.45, y: 1.15, z: 0.08 });
  k.b(0.55, 0.15, 0.55, P.dark, { x: -0.45, y: 0.85, z: -0.2 });
  k.b(0.55, 0.6, 0.12, P.dark, { x: -0.45, y: 1.15, z: 0.08 });
  k.b(1.4, 0.15, 0.6, P.dark, { y: 0.95, z: 1.1 });
  // Steering column and fins.
  k.b(0.08, 0.4, 0.08, P.dark, { x: 0.45, y: 1.05, z: -0.75, rx: -0.5 });
  k.b(0.4, 0.06, 0.06, P.dark, { x: 0.45, y: 1.22, z: -0.85 });
  k.p([[0, 0], [0.7, 0], [0.1, 0.6]], 0.06, P.vehicleShade, { x: 0.95, y: 0.7, z: 1.4, ry: Math.PI / 2 });
  k.p([[0, 0], [0.7, 0], [0.1, 0.6]], 0.06, P.vehicleShade, { x: -0.95, y: 0.7, z: 1.4, ry: Math.PI / 2 });
  // Hover pods with glowing undersides.
  for (const [x, z] of [[-0.95, -1.3], [0.95, -1.3], [-0.95, 1.3], [0.95, 1.3]]) {
    k.c(0.38, 0.45, 0.3, 10, P.dark, { x, y: 0.32, z });
    k.glow.push(cyl(0.32, 0.32, 0.04, 10, P.glow, { x, y: 0.16, z }));
    m.pads.push(new THREE.Vector3(x, 0.1, z));
  }
  k.g(0.3, 0.1, 0.04, 0xfff0c0, { x: 0.6, y: 0.7, z: -1.81 });
  k.g(0.3, 0.1, 0.04, 0xfff0c0, { x: -0.6, y: 0.7, z: -1.81 });
  k.g(1.6, 0.04, 0.04, P.glow, { y: 0.66, z: 1.82 });
  m.root.add(k.build(gm));
  m.seats = [new THREE.Vector3(0.45, 0.95, -0.2), new THREE.Vector3(-0.45, 0.95, -0.2), new THREE.Vector3(0, 1.05, 1.1)];
  m.half.set(1.05, 0.9, 1.85);
  m.centerY = 0.9;
  return m;
}

function basalt(team: TeamId, gm: THREE.MeshBasicMaterial): VehicleModel {
  const P = FACTION_PALETTES[team];
  const m = empty(gm);
  const k = new Kit();
  // Hull: wide slab with a sloped glacis and side skirts.
  k.b(3.4, 0.9, 6.2, P.vehicleBase, { y: 1.0 });
  k.p([[-1.7, 0], [1.7, 0], [1.5, 0.6], [-1.5, 0.6]], 1.4, P.vehicleBase, { y: 1.45, z: -2.5, rx: -0.15 });
  k.b(3.6, 0.5, 6.4, P.dark, { y: 0.55 });
  k.b(0.25, 0.7, 6.0, P.vehicleShade, { x: 1.8, y: 0.85 });
  k.b(0.25, 0.7, 6.0, P.vehicleShade, { x: -1.8, y: 0.85 });
  k.b(2.6, 0.3, 1.0, P.dark, { y: 1.55, z: 2.4 });
  for (let i = 0; i < 4; i++) k.b(0.5, 0.12, 0.7, shade(P.vehicleBase, -0.1), { x: -1.2 + i * 0.8, y: 1.5, z: 1.5 });
  // Hover skirts glow and rear thrusters.
  k.g(3.2, 0.05, 6.0, P.glow, { y: 0.28 });
  for (const x of [-1.0, 1.0]) {
    k.c(0.35, 0.4, 0.5, 10, P.dark, { x, y: 1.2, z: 3.2, rx: Math.PI / 2 });
    k.glow.push(cyl(0.28, 0.28, 0.05, 10, P.glow, { x, y: 1.2, z: 3.47, rx: Math.PI / 2 }));
  }
  for (const [x, z] of [[-1.4, -2.4], [1.4, -2.4], [-1.4, 2.4], [1.4, 2.4]]) m.pads.push(new THREE.Vector3(x, 0.2, z));
  m.root.add(k.build(gm));
  // Turret (yaw) with barrel (pitch) and coax beam.
  const turret = new THREE.Group();
  turret.position.set(0, 1.95, 0.2);
  const t = new Kit();
  t.p([[-1.3, 0], [1.3, 0], [1.0, 0.75], [-1.0, 0.75]], 2.6, P.vehicleBase, { y: 0, z: 0 });
  t.b(2.0, 0.2, 1.4, P.vehicleShade, { y: 0.78, z: 0.3 });
  t.b(0.6, 0.35, 0.6, P.dark, { x: 0.6, y: 0.95, z: 0.6 });
  t.g(0.4, 0.06, 0.04, P.glow, { x: 0.6, y: 1.0, z: 0.29 });
  t.b(0.5, 0.5, 0.9, P.dark, { x: -0.9, y: 0.35, z: 1.4 });
  t.g(0.06, 0.3, 0.6, P.glow, { x: 1.31, y: 0.4, z: 0 });
  t.g(0.06, 0.3, 0.6, P.glow, { x: -1.31, y: 0.4, z: 0 });
  turret.add(t.build(gm));
  const barrel = new THREE.Group();
  barrel.position.set(0, 0.4, -1.2);
  const bk = new Kit();
  bk.b(0.6, 0.5, 0.6, P.dark, { z: 0 });
  bk.c(0.14, 0.16, 3.2, 10, P.dark, { z: -1.8, rx: Math.PI / 2 });
  bk.c(0.22, 0.22, 0.5, 10, shade(P.vehicleBase, -0.2), { z: -3.3, rx: Math.PI / 2 });
  bk.glow.push(cyl(0.16, 0.16, 0.05, 10, P.glow, { z: -0.9, rx: Math.PI / 2 }));
  barrel.add(bk.build(gm));
  turret.add(barrel);
  const coax = new THREE.Group();
  coax.position.set(0.55, 0.4, -1.2);
  const ck = new Kit();
  ck.c(0.05, 0.05, 0.9, 8, P.dark, { z: -0.45, rx: Math.PI / 2 });
  ck.glow.push(cyl(0.055, 0.055, 0.05, 8, P.glow, { z: -0.6, rx: Math.PI / 2 }));
  coax.add(ck.build(gm));
  turret.add(coax);
  m.root.add(turret);
  m.turret = turret;
  m.barrel = barrel;
  m.coax = coax;
  m.muzzleMain.set(0, 0, -3.6);
  m.muzzleCoax.set(0, 0, -0.95);
  m.seats = [new THREE.Vector3(0, 1.4, -1.2), new THREE.Vector3(0.6, 2.3, 0.6)];
  m.half.set(1.8, 1.3, 3.2);
  m.centerY = 1.3;
  return m;
}

function condor(team: TeamId, gm: THREE.MeshBasicMaterial): VehicleModel {
  const P = FACTION_PALETTES[team];
  const m = empty(gm);
  const k = new Kit();
  // Fuselage, nose, canopy, wings, twin tail.
  k.b(2.0, 1.8, 7.5, P.vehicleBase, { y: 2.0 });
  k.p([[-1.0, 0], [1.0, 0], [0.5, 1.6], [-0.5, 1.6]], 2.2, P.vehicleBase, { y: 1.1, z: -4.6, rx: -Math.PI / 2 });
  k.b(1.3, 0.7, 2.0, 0x2a4058, { y: 2.95, z: -2.6 });
  k.g(1.2, 0.08, 1.8, 0x6ab0c8, { y: 3.32, z: -2.6 });
  k.b(10.5, 0.28, 2.2, P.vehicleBase, { y: 2.6, z: 0.4 });
  k.b(10.8, 0.12, 0.5, P.vehicleShade, { y: 2.6, z: -0.6 });
  k.b(1.6, 1.4, 3.0, P.vehicleBase, { y: 2.4, z: 4.6 });
  for (const x of [-1.6, 1.6]) {
    k.p([[0, 0], [1.6, 0], [0.4, 1.8]], 0.12, P.vehicleShade, { x, y: 2.9, z: 5.3, ry: Math.PI / 2 });
  }
  k.b(4.2, 0.12, 1.2, P.vehicleBase, { y: 3.0, z: 5.6 });
  // Landing skids.
  for (const x of [-0.9, 0.9]) {
    k.b(0.12, 0.12, 4.5, P.dark, { x, y: 0.35, z: -0.2 });
    k.b(0.1, 0.9, 0.1, P.dark, { x, y: 0.8, z: -1.6 });
    k.b(0.1, 0.9, 0.1, P.dark, { x, y: 0.8, z: 1.2 });
  }
  // Rocket pods under the wings.
  for (const x of [-3.0, 3.0]) {
    k.c(0.3, 0.3, 1.6, 8, P.dark, { x, y: 2.15, z: 0.2, rx: Math.PI / 2 });
    k.glow.push(cyl(0.26, 0.26, 0.04, 8, 0xff5a1f, { x, y: 2.15, z: -0.62, rx: Math.PI / 2 }));
    m.muzzleRockets.push(new THREE.Vector3(x, 2.15, -1.0));
  }
  k.g(0.08, 0.08, 3.0, P.glow, { x: 1.01, y: 2.2, z: 0 });
  k.g(0.08, 0.08, 3.0, P.glow, { x: -1.01, y: 2.2, z: 0 });
  m.root.add(k.build(gm));
  // Tilting nacelles at the wingtips.
  for (const x of [-5.3, 5.3]) {
    const n = new THREE.Group();
    n.position.set(x, 2.6, 0.4);
    const nk = new Kit();
    nk.c(0.75, 0.6, 2.4, 12, P.vehicleShade, { rx: Math.PI / 2 });
    nk.c(0.8, 0.8, 0.3, 12, P.dark, { z: -1.2, rx: Math.PI / 2 });
    nk.glow.push(cyl(0.55, 0.55, 0.06, 12, P.glow, { z: 1.22, rx: Math.PI / 2 }));
    n.add(nk.build(gm));
    m.root.add(n);
    m.nacelles.push(n);
    m.pads.push(new THREE.Vector3(x, 2.6, 0.4));
  }
  // Chin turret.
  const chin = new THREE.Group();
  chin.position.set(0, 0.95, -3.6);
  const ck = new Kit();
  ck.c(0.4, 0.45, 0.4, 10, P.dark, {});
  chin.add(ck.build(gm));
  const chinGun = new THREE.Group();
  chinGun.position.set(0, -0.15, 0);
  const gk = new Kit();
  gk.b(0.35, 0.3, 0.5, P.dark, {});
  for (const x of [-0.08, 0.08]) gk.c(0.04, 0.04, 1.1, 6, P.dark, { x, z: -0.75, rx: Math.PI / 2 });
  chinGun.add(gk.build(gm));
  chin.add(chinGun);
  m.root.add(chin);
  m.chin = chin;
  m.chinGun = chinGun;
  m.muzzleChin.set(0, 0, -1.3);
  m.seats = [new THREE.Vector3(0, 2.4, -2.6), new THREE.Vector3(0, 2.2, -1.2)];
  m.half.set(1.4, 1.5, 4.2);
  m.centerY = 2.0;
  return m;
}

function midge(team: TeamId, gm: THREE.MeshBasicMaterial): VehicleModel {
  const P = FACTION_PALETTES[team];
  const m = empty(gm);
  const k = new Kit();
  k.b(1.6, 1.5, 3.0, P.vehicleBase, { y: 1.6 });
  k.p([[-0.8, 0], [0.8, 0], [0.5, 1.0], [-0.5, 1.0]], 1.4, P.vehicleBase, { y: 1.0, z: -2.0, rx: -Math.PI / 2 });
  k.b(1.4, 0.9, 1.4, 0x2a4058, { y: 2.0, z: -1.2 });
  k.g(1.3, 0.06, 1.3, 0x6ab0c8, { y: 2.46, z: -1.2 });
  k.b(0.5, 0.5, 4.2, P.vehicleBase, { y: 2.0, z: 3.4 });
  k.p([[0, 0], [1.0, 0], [0.3, 1.2]], 0.1, P.vehicleShade, { y: 2.2, z: 5.2, ry: Math.PI / 2 });
  k.b(1.6, 0.08, 0.5, P.vehicleShade, { y: 2.1, z: 5.0 });
  k.c(0.15, 0.2, 0.6, 8, P.dark, { y: 2.6, z: 0.1 });
  k.b(1.0, 0.3, 1.4, P.dark, { y: 2.45, z: 0.4 });
  for (const x of [-0.8, 0.8]) {
    k.b(0.1, 0.1, 3.2, P.dark, { x, y: 0.15, z: 0 });
    k.b(0.08, 0.8, 0.08, P.dark, { x, y: 0.55, z: -0.8 });
    k.b(0.08, 0.8, 0.08, P.dark, { x, y: 0.55, z: 0.8 });
    // Minigun pods.
    k.b(0.2, 0.2, 0.6, P.dark, { x: x * 1.25, y: 1.2, z: -0.6 });
    k.c(0.08, 0.08, 0.9, 6, P.dark, { x: x * 1.25, y: 1.2, z: -1.2, rx: Math.PI / 2 });
    m.muzzleRockets.push(new THREE.Vector3(x * 1.25, 1.2, -1.7));
  }
  k.g(0.06, 0.06, 2.4, P.glow, { x: 0.81, y: 1.6, z: 0 });
  k.g(0.06, 0.06, 2.4, P.glow, { x: -0.81, y: 1.6, z: 0 });
  // Door gunner mount on the right side.
  k.b(0.3, 0.3, 0.6, P.dark, { x: -0.95, y: 1.7, z: 0.3 });
  k.c(0.05, 0.05, 0.8, 6, P.dark, { x: -1.05, y: 1.7, z: -0.2, rx: Math.PI / 2 });
  m.root.add(k.build(gm));
  const rotor = new THREE.Group();
  rotor.position.set(0, 2.95, 0.1);
  const rk = new Kit();
  for (let i = 0; i < 4; i++) rk.b(0.28, 0.05, 4.1, P.dark, { ry: (i * Math.PI) / 2, z: 0 });
  rk.c(0.25, 0.25, 0.2, 8, P.vehicleShade, {});
  rotor.add(rk.build(gm));
  m.root.add(rotor);
  m.rotor = rotor;
  const tail = new THREE.Group();
  tail.position.set(0.3, 2.3, 5.3);
  const tk = new Kit();
  for (let i = 0; i < 3; i++) tk.b(0.04, 0.9, 0.12, P.dark, { rx: (i * Math.PI * 2) / 3 });
  tail.add(tk.build(gm));
  m.root.add(tail);
  m.tailRotor = tail;
  m.seats = [new THREE.Vector3(0, 1.55, -1.2), new THREE.Vector3(-0.75, 1.5, 0.3)];
  m.half.set(1.0, 1.3, 2.6);
  m.centerY = 1.5;
  m.pads.push(new THREE.Vector3(0, 0, 0));
  return m;
}

/** Air-dropped supply pod (call-in), with a parachute canopy built from a cone. */
export function buildDropPod(team: TeamId): { pod: THREE.Group; chute: THREE.Group } {
  const P = FACTION_PALETTES[team];
  const gm = glowMaterial(GLOW_RIG);
  const k = new Kit();
  k.b(3.0, 1.6, 4.4, P.vehicleShade, { y: 0.8 });
  k.b(3.1, 0.2, 4.5, P.dark, { y: 1.65 });
  k.g(2.8, 0.06, 0.06, P.glow, { y: 1.2, z: -2.22 });
  const pod = k.build(gm);
  const c = new Kit();
  c.toon.push(cone(4.5, 2.2, 10, P.armor, { y: 9 }));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    c.b(0.03, 8, 0.03, P.dark, { x: Math.cos(a) * 2.2, y: 4.8, z: Math.sin(a) * 2.2, rz: Math.cos(a) * 0.25, rx: -Math.sin(a) * 0.25 });
  }
  const chute = c.build(gm);
  return { pod, chute };
}
