// Code-built weapons and attachments. Local frame: barrel along +Z, up +Y, origin at the top of
// the pistol grip (the trigger hand). Models expose anchors for hands, muzzle, ejection port,
// magazine and the sight line, and separately animated parts (magazine, bolt, pump).
import * as THREE from 'three';
import { box, cyl, merge, outlinedMesh, MATS, glowMaterial, GLOW_RIG, prism as prismPart, type Xform } from '../render/toon';
import { WEAPON_COLORS as W } from './palette';
import { WEAPON_BY_ID, type AmmoId, type BarrelId, type SightId, type UnderbarrelId, type WeaponCategory, type WeaponId } from '../config/content';

export interface AttachmentSet {
  sight: SightId;
  barrel: BarrelId;
  underbarrel: UnderbarrelId;
  ammo: AmmoId;
}

export interface WeaponAnchors {
  muzzle: THREE.Vector3;
  sight: THREE.Vector3;
  grip: THREE.Vector3;
  fore: THREE.Vector3;
  mag: THREE.Vector3;
  eject: THREE.Vector3;
}

export interface WeaponModel extends WeaponAnchors {
  group: THREE.Group;
  magObj: THREE.Object3D | null;
  boltObj: THREE.Object3D | null;
  pumpObj: THREE.Object3D | null;
  /** Optic glass, hidden while the scoped overlay is up. */
  opticObj: THREE.Object3D | null;
}

interface Parts {
  toon: THREE.BufferGeometry[];
  glow: THREE.BufferGeometry[];
}

const ENERGY_GLOW: Record<string, number> = { cyan: 0x3fe0ff, violet: 0xb56bff, kinetic: 0xffb52e, rocket: 0xff5a1f };

interface Frame {
  /** Receiver length (behind and ahead of the grip). */
  back: number;
  front: number;
  height: number;
  width: number;
  /** Top rail height (sights sit here). */
  rail: number;
  barrel: number;
  barrelR: number;
  stock: number;
  magH: number;
  magZ: number;
  foreZ: number;
}

const FRAMES: Record<WeaponId, Frame> = {
  tern: { back: 0.16, front: 0.26, height: 0.1, width: 0.065, rail: 0.075, barrel: 0.28, barrelR: 0.014, stock: 0.24, magH: 0.17, magZ: 0.1, foreZ: 0.34 },
  lumen: { back: 0.15, front: 0.3, height: 0.11, width: 0.07, rail: 0.08, barrel: 0.24, barrelR: 0.018, stock: 0.22, magH: 0.12, magZ: 0.11, foreZ: 0.36 },
  wasp: { back: 0.1, front: 0.2, height: 0.09, width: 0.06, rail: 0.065, barrel: 0.12, barrelR: 0.013, stock: 0.18, magH: 0.22, magZ: 0.08, foreZ: 0.24 },
  flicker: { back: 0.14, front: 0.2, height: 0.12, width: 0.075, rail: 0.09, barrel: 0.1, barrelR: 0.016, stock: 0.12, magH: 0.08, magZ: -0.06, foreZ: 0.22 },
  anvil: { back: 0.2, front: 0.32, height: 0.13, width: 0.085, rail: 0.095, barrel: 0.38, barrelR: 0.02, stock: 0.24, magH: 0.14, magZ: 0.08, foreZ: 0.42 },
  torrent: { back: 0.22, front: 0.34, height: 0.13, width: 0.09, rail: 0.1, barrel: 0.3, barrelR: 0.03, stock: 0.2, magH: 0.1, magZ: -0.12, foreZ: 0.44 },
  sable: { back: 0.16, front: 0.32, height: 0.1, width: 0.065, rail: 0.075, barrel: 0.42, barrelR: 0.015, stock: 0.26, magH: 0.12, magZ: 0.1, foreZ: 0.4 },
  prism: { back: 0.16, front: 0.34, height: 0.11, width: 0.07, rail: 0.082, barrel: 0.36, barrelR: 0.02, stock: 0.26, magH: 0.1, magZ: 0.11, foreZ: 0.42 },
  longbow: { back: 0.18, front: 0.32, height: 0.09, width: 0.065, rail: 0.075, barrel: 0.62, barrelR: 0.016, stock: 0.3, magH: 0.08, magZ: 0.1, foreZ: 0.46 },
  maul: { back: 0.14, front: 0.26, height: 0.1, width: 0.075, rail: 0.07, barrel: 0.42, barrelR: 0.022, stock: 0.26, magH: 0.0, magZ: 0.1, foreZ: 0.42 },
  sparrow: { back: 0.05, front: 0.13, height: 0.05, width: 0.035, rail: 0.04, barrel: 0.0, barrelR: 0.008, stock: 0, magH: 0.03, magZ: -0.01, foreZ: 0.0 },
  hammerhead: { back: 0.42, front: 0.62, height: 0.15, width: 0.15, rail: 0.13, barrel: 0, barrelR: 0.072, stock: 0, magH: 0, magZ: 0, foreZ: 0.3 },
};

/** Default attachments: the first option of each slot. */
export function defaultAttachments(id: WeaponId): AttachmentSet {
  const w = WEAPON_BY_ID[id];
  return { sight: w.sights[0], barrel: w.barrels[0], underbarrel: w.underbarrels[0], ammo: w.ammos[0] };
}

export function categoryOf(id: WeaponId): WeaponCategory {
  return WEAPON_BY_ID[id].category;
}

function add(p: Parts, g: THREE.BufferGeometry): void {
  p.toon.push(g);
}
function glow(p: Parts, g: THREE.BufferGeometry): void {
  p.glow.push(g);
}

/** Builds geometry for a weapon; returns parts plus anchor points. Separate parts are returned on their own. */
function buildParts(id: WeaponId, att: AttachmentSet): { main: Parts; mag: Parts; bolt: Parts; pump: Parts; optic: Parts; anchors: WeaponAnchors } {
  const info = WEAPON_BY_ID[id];
  const f = FRAMES[id];
  const main: Parts = { toon: [], glow: [] };
  const mag: Parts = { toon: [], glow: [] };
  const bolt: Parts = { toon: [], glow: [] };
  const pump: Parts = { toon: [], glow: [] };
  const optic: Parts = { toon: [], glow: [] };
  const eg = ENERGY_GLOW[info.energy];
  const energy = info.energy === 'cyan' || info.energy === 'violet';
  const recLen = f.back + f.front;
  const recZ = (f.front - f.back) / 2;
  const top = f.height * 0.5 + 0.02;
  let muzzleZ = f.front + f.barrel;
  const anchors: WeaponAnchors = {
    muzzle: new THREE.Vector3(0, 0.03, muzzleZ),
    sight: new THREE.Vector3(0, f.rail + 0.045, 0),
    grip: new THREE.Vector3(0, -0.02, 0),
    fore: new THREE.Vector3(0, -0.02, f.foreZ),
    mag: new THREE.Vector3(0, -f.magH * 0.6, f.magZ),
    eject: new THREE.Vector3(-f.width * 0.6, 0.04, 0.06),
  };

  if (info.category === 'launcher') {
    // Shoulder tube, grips, sight box, warhead visible at the front.
    add(main, cyl(f.barrelR, f.barrelR, f.back + f.front, 10, W.rocket, { z: recZ, rx: Math.PI / 2, y: 0.06 }));
    add(main, cyl(f.barrelR * 1.15, f.barrelR * 1.15, 0.1, 10, W.dark, { z: f.front - 0.02, rx: Math.PI / 2, y: 0.06 }));
    add(main, cyl(f.barrelR * 1.2, f.barrelR * 1.05, 0.14, 10, W.dark, { z: -f.back + 0.05, rx: Math.PI / 2, y: 0.06 }));
    add(main, box(0.05, 0.12, 0.06, W.polymer, { y: -0.04, z: 0 }));
    add(main, box(0.05, 0.12, 0.06, W.polymer, { y: -0.04, z: 0.3, rx: 0.2 }));
    add(main, box(0.03, 0.03, 0.5, W.dark, { y: 0.06 + f.barrelR + 0.012, z: 0.1 }));
    add(main, box(0.06, 0.07, 0.12, W.body, { x: -0.1, y: 0.1, z: 0.05 }));
    glow(main, box(0.04, 0.04, 0.01, 0xff5a1f, { x: -0.1, y: 0.1, z: -0.012 }));
    for (const z of [-0.3, 0.2, 0.45]) add(main, cyl(f.barrelR * 1.06, f.barrelR * 1.06, 0.03, 10, 0xc04a3a, { z, rx: Math.PI / 2, y: 0.06 }));
    // Loaded rocket nose (shown as the "magazine" so reloads can hide and reveal it).
    add(mag, cone(f.barrelR * 0.85, 0.16, 8, 0xd8d2c4, { z: f.front + 0.08, rx: Math.PI / 2, y: 0.06 }));
    glow(mag, box(0.02, 0.02, 0.02, 0xff5a1f, { z: f.front + 0.165, y: 0.06 }));
    anchors.muzzle.set(0, 0.06, f.front + 0.05);
    anchors.sight.set(-0.1, 0.13, 0);
    anchors.fore.set(0, -0.04, 0.3);
    anchors.mag.set(0, 0.06, f.front + 0.08);
    anchors.eject.set(0, 0.06, -f.back);
    if (att.sight !== 'iron') addSight(main, optic, att.sight, -0.1, 0.17, 0.02, anchors);
    return { main, mag, bolt, pump, optic, anchors };
  }

  if (info.category === 'sidearm') {
    add(main, box(f.width, f.height, recLen, W.body, { y: 0.03, z: recZ }));
    add(bolt, box(f.width * 1.05, f.height * 0.6, recLen * 1.02, W.mid, { y: 0.065, z: recZ }));
    add(main, box(f.width * 0.95, 0.12, 0.05, W.polymer, { y: -0.05, z: -0.01, rx: -0.25 }));
    add(main, box(0.012, 0.03, 0.04, W.dark, { y: -0.005, z: 0.04 }));
    add(main, cyl(0.007, 0.007, 0.02, 6, W.dark, { y: 0.03, z: f.front + 0.005, rx: Math.PI / 2 }));
    add(mag, box(f.width * 0.8, 0.1, 0.035, W.dark, { y: -0.08, z: -0.015, rx: -0.25 }));
    add(main, box(0.008, 0.012, 0.008, W.dark, { y: 0.1, z: f.front - 0.01 }));
    add(main, box(0.02, 0.012, 0.008, W.dark, { y: 0.1, z: -f.back + 0.01 }));
    glow(main, box(0.006, 0.006, 0.02, eg, { x: f.width * 0.52, y: 0.03, z: 0.05 }));
    anchors.muzzle.set(0, 0.03, f.front + 0.015);
    anchors.sight.set(0, 0.105, 0);
    anchors.fore.set(0.01, -0.05, 0.01);
    anchors.mag.set(0, -0.09, -0.015);
    anchors.eject.set(-0.02, 0.07, 0.03);
    if (att.sight !== 'iron') addSight(main, optic, att.sight, 0, 0.1, 0.02, anchors);
    muzzleZ = addBarrelAttachment(main, att.barrel, f, f.front + 0.012, 0.03, 0.012, anchors);
    if (att.underbarrel === 'laser') {
      add(main, box(0.025, 0.025, 0.05, W.dark, { y: -0.005, z: 0.1 }));
      glow(main, box(0.008, 0.008, 0.005, 0xff3040, { y: -0.005, z: 0.126 }));
    }
    void muzzleZ;
    return { main, mag, bolt, pump, optic, anchors };
  }

  // ---- Long guns: receiver, handguard, barrel, stock, grip, magazine.
  add(main, box(f.width, f.height, recLen, W.body, { y: 0.03, z: recZ }));
  add(main, box(f.width * 0.9, 0.02, recLen * 0.96, W.dark, { y: 0.03 + top - 0.012, z: recZ }));
  add(main, box(f.width * 0.95, 0.13, 0.055, W.polymer, { y: -0.055, z: -0.01, rx: -0.3 }));
  add(main, box(0.012, 0.035, 0.05, W.dark, { y: -0.01, z: 0.05 }));
  // Handguard ahead of the receiver.
  const hgLen = Math.max(0.12, f.foreZ - f.front + 0.12);
  add(main, box(f.width * 1.08, f.height * 0.8, hgLen, energy ? W.mid : W.polymer, { y: 0.03, z: f.front + hgLen / 2 - 0.04 }));
  // Barrel.
  if (f.barrel > 0) add(main, cyl(f.barrelR, f.barrelR, f.barrel + 0.02, 8, W.dark, { y: 0.035, z: f.front + f.barrel / 2, rx: Math.PI / 2 }));
  // Top rail.
  add(main, box(0.03, 0.012, recLen * 0.9, W.dark, { y: f.rail - 0.006, z: recZ }));
  // Stock.
  if (f.stock > 0) {
    add(main, box(f.width * 0.8, 0.05, f.stock, W.polymer, { y: 0.03, z: -f.back - f.stock / 2 }));
    add(main, box(f.width * 0.9, f.height * 1.3, 0.05, W.polymer, { y: 0.0, z: -f.back - f.stock + 0.02 }));
    add(main, box(f.width * 0.7, 0.03, f.stock * 0.7, W.dark, { y: -0.02, z: -f.back - f.stock * 0.6, rx: -0.15 }));
  }
  // Energy coils / kinetic details.
  if (energy) {
    for (let i = 0; i < 3; i++) glow(main, box(f.width * 1.12, 0.012, 0.018, eg, { y: 0.03, z: f.front + 0.02 + i * 0.05 }));
    glow(main, box(0.006, 0.02, recLen * 0.6, eg, { x: f.width * 0.52, y: 0.04, z: recZ }));
  } else {
    add(main, box(0.004, 0.03, 0.06, W.mid, { x: -f.width * 0.52, y: 0.045, z: 0.06 }));
    glow(main, box(0.006, 0.006, 0.006, 0xffb52e, { x: f.width * 0.52, y: 0.06, z: -0.06 }));
  }

  // Category specifics.
  switch (id) {
    case 'tern':
      add(mag, box(0.045, f.magH, 0.07, W.dark, { y: -f.magH / 2 - 0.02, z: f.magZ, rx: 0.18 }));
      break;
    case 'lumen':
      add(mag, box(0.05, f.magH, 0.08, W.mid, { y: -f.magH / 2 - 0.02, z: f.magZ }));
      glow(mag, box(0.052, 0.02, 0.06, eg, { y: -f.magH * 0.6 - 0.02, z: f.magZ }));
      add(main, box(f.width * 1.2, 0.05, 0.2, W.body, { y: 0.09, z: f.front + 0.06 }));
      break;
    case 'wasp':
      add(mag, box(0.035, f.magH, 0.05, W.dark, { y: -f.magH / 2 - 0.02, z: f.magZ }));
      break;
    case 'flicker':
      // Bullpup-style rear cell.
      add(mag, box(0.06, f.magH, 0.12, W.mid, { y: -0.03, z: f.magZ - 0.05 }));
      glow(mag, box(0.062, 0.015, 0.1, eg, { y: -0.03 + f.magH * 0.2, z: f.magZ - 0.05 }));
      add(main, box(f.width * 1.1, 0.04, 0.24, W.body, { y: 0.1, z: 0.06 }));
      break;
    case 'anvil':
      add(mag, box(0.1, f.magH, 0.14, W.rocket, { y: -f.magH / 2 - 0.02, z: f.magZ }));
      add(main, box(0.02, 0.06, 0.16, W.dark, { y: f.rail + 0.05, z: 0.08 }));
      add(main, box(0.02, 0.02, 0.18, W.dark, { y: f.rail + 0.08, z: 0.08 }));
      add(main, cyl(f.barrelR * 1.5, f.barrelR * 1.5, 0.16, 8, W.mid, { y: 0.035, z: f.front + 0.12, rx: Math.PI / 2 }));
      break;
    case 'torrent':
      // Rear battery and heat fins along the barrel shroud.
      add(mag, box(0.1, f.magH, 0.14, W.mid, { y: 0.0, z: f.magZ - 0.1 }));
      glow(mag, box(0.102, 0.02, 0.1, eg, { y: 0.03, z: f.magZ - 0.1 }));
      for (let i = 0; i < 5; i++) add(main, box(f.width * 1.5, 0.012, 0.02, W.light, { y: 0.035, z: f.front + 0.04 + i * 0.05 }));
      add(main, cyl(f.barrelR * 1.2, f.barrelR, f.barrel * 0.6, 8, W.mid, { y: 0.035, z: f.front + f.barrel * 0.3, rx: Math.PI / 2 }));
      break;
    case 'sable':
      add(mag, box(0.045, f.magH, 0.06, W.dark, { y: -f.magH / 2 - 0.02, z: f.magZ }));
      break;
    case 'prism':
      add(main, prismPart([[-0.045, -0.03], [0.045, -0.03], [0.0, 0.06]], 0.32, W.mid, { y: 0.04, z: f.front + 0.12 }));
      glow(main, box(0.008, 0.008, 0.3, eg, { y: 0.085, z: f.front + 0.12 }));
      add(mag, box(0.05, f.magH, 0.07, W.mid, { y: -f.magH / 2 - 0.02, z: f.magZ }));
      glow(mag, box(0.052, 0.015, 0.05, eg, { y: -f.magH * 0.55 - 0.02, z: f.magZ }));
      break;
    case 'longbow':
      add(mag, box(0.045, f.magH, 0.07, W.dark, { y: -f.magH / 2 - 0.02, z: f.magZ }));
      add(bolt, box(0.06, 0.016, 0.016, W.light, { x: -0.05, y: 0.06, z: -0.06 }));
      add(bolt, box(0.02, 0.02, 0.02, W.light, { x: -0.08, y: 0.05, z: -0.06 }));
      add(main, cyl(f.barrelR * 1.6, f.barrelR * 1.6, 0.05, 8, W.mid, { y: 0.035, z: f.front + f.barrel - 0.02, rx: Math.PI / 2 }));
      break;
    case 'maul':
      add(main, cyl(0.016, 0.016, f.barrel - 0.06, 8, W.mid, { y: -0.01, z: f.front + f.barrel / 2 - 0.03, rx: Math.PI / 2 }));
      add(pump, box(f.width * 1.15, 0.05, 0.14, W.polymer, { y: -0.01, z: f.foreZ }));
      for (let i = 0; i < 3; i++) add(pump, box(f.width * 1.18, 0.008, 0.01, W.dark, { y: -0.01, z: f.foreZ - 0.04 + i * 0.04 }));
      for (let i = 0; i < 4; i++) add(main, box(0.012, 0.022, 0.03, 0xc04a3a, { x: f.width * 0.55, y: 0.0, z: -0.08 + i * 0.035 }));
      anchors.mag.set(0, -0.04, 0.12);
      break;
  }

  // Iron sights always present on the rail (folded behind optics).
  if (att.sight === 'iron') {
    add(main, box(0.012, 0.035, 0.01, W.dark, { y: f.rail + 0.018, z: muzzleZ - 0.03 > f.front ? f.front + 0.02 : f.front - 0.02 }));
    add(main, box(0.03, 0.03, 0.012, W.dark, { y: f.rail + 0.016, z: -f.back + 0.04 }));
    anchors.sight.set(0, f.rail + 0.03, 0);
  } else addSight(main, optic, att.sight, 0, f.rail, recZ - 0.02, anchors);

  muzzleZ = addBarrelAttachment(main, att.barrel, f, f.front + f.barrel, 0.035, f.barrelR, anchors);
  addUnderbarrel(main, att.underbarrel, f, anchors);
  addAmmoMark(mag, att.ammo, f, id);
  void muzzleZ;
  return { main, mag, bolt, pump, optic, anchors };
}

function cone(r: number, h: number, seg: number, color: number, t?: Xform): THREE.BufferGeometry {
  return cyl(0.001, r, h, seg, color, t);
}

function addSight(main: Parts, optic: Parts, sight: SightId, x: number, rail: number, z: number, a: WeaponAnchors): void {
  const lens = 0x6ab0c8;
  switch (sight) {
    case 'holo':
      add(main, box(0.04, 0.012, 0.07, W.dark, { x, y: rail + 0.006, z }));
      add(main, box(0.006, 0.045, 0.012, W.dark, { x: x - 0.018, y: rail + 0.032, z: z + 0.02 }));
      add(main, box(0.006, 0.045, 0.012, W.dark, { x: x + 0.018, y: rail + 0.032, z: z + 0.02 }));
      add(main, box(0.042, 0.008, 0.012, W.dark, { x, y: rail + 0.056, z: z + 0.02 }));
      // The red dot itself is drawn by the HUD at the exact aim point while aiming (a 3D dot this
      // close to the eye renders far too large); only a faint emitter glints on the frame.
      glow(optic, box(0.003, 0.002, 0.002, 0xff3a5c, { x, y: rail + 0.014, z: z + 0.03 }));
      a.sight.set(x, rail + 0.035, z);
      break;
    case 'prism2':
      // Open housing: base, side walls and a top strap around a clear window, thin lens rims.
      add(main, box(0.058, 0.01, 0.09, W.body, { x, y: rail + 0.005, z }));
      for (const sx of [-1, 1]) add(main, box(0.007, 0.052, 0.09, W.body, { x: x + sx * 0.0255, y: rail + 0.032, z }));
      add(main, box(0.062, 0.01, 0.1, W.dark, { x, y: rail + 0.062, z }));
      for (const dz of [-0.046, 0.046]) {
        glow(optic, box(0.044, 0.0015, 0.002, lens, { x, y: rail + 0.0105, z: z + dz }));
        glow(optic, box(0.044, 0.0015, 0.002, lens, { x, y: rail + 0.0565, z: z + dz }));
      }
      a.sight.set(x, rail + 0.033, z);
      break;
    case 'optic4':
    case 'optic8':
    case 'thermal6': {
      const len = sight === 'optic8' ? 0.26 : sight === 'thermal6' ? 0.16 : 0.18;
      const r = sight === 'optic8' ? 0.022 : 0.02;
      if (sight === 'thermal6') add(main, box(0.05, 0.05, len, W.body, { x, y: rail + 0.045, z }));
      else add(main, cyl(r, r, len, 10, W.body, { x, y: rail + 0.045, z, rx: Math.PI / 2 }));
      add(main, cyl(r * 1.35, r * 1.1, 0.04, 10, W.body, { x, y: rail + 0.045, z: z + len / 2, rx: Math.PI / 2 }));
      add(main, cyl(r * 1.25, r * 1.05, 0.035, 10, W.body, { x, y: rail + 0.045, z: z - len / 2, rx: Math.PI / 2 }));
      add(main, box(0.02, 0.025, 0.02, W.dark, { x, y: rail + 0.012, z: z + len * 0.25 }));
      add(main, box(0.02, 0.025, 0.02, W.dark, { x, y: rail + 0.012, z: z - len * 0.25 }));
      glow(optic, cyl(r * 1.15, r * 1.15, 0.004, 10, sight === 'thermal6' ? 0xffb340 : lens, { x, y: rail + 0.045, z: z + len / 2 + 0.02, rx: Math.PI / 2 }));
      a.sight.set(x, rail + 0.045, z);
      break;
    }
    case 'iron':
      break;
  }
}

function addBarrelAttachment(main: Parts, barrel: BarrelId, _f: Frame, endZ: number, y: number, r: number, a: WeaponAnchors): number {
  let z = endZ;
  switch (barrel) {
    case 'compensator':
      add(main, box(r * 3, r * 3, 0.05, W.mid, { y, z: endZ + 0.025 }));
      for (let i = 0; i < 2; i++) add(main, box(r * 3.2, 0.004, 0.008, W.dark, { y: y + r * 1.2, z: endZ + 0.015 + i * 0.02 }));
      z = endZ + 0.05;
      break;
    case 'suppressor':
      add(main, cyl(r * 2.2, r * 2.2, 0.16, 8, W.dark, { y, z: endZ + 0.08, rx: Math.PI / 2 }));
      add(main, cyl(r * 2.3, r * 2.3, 0.02, 8, W.mid, { y, z: endZ + 0.01, rx: Math.PI / 2 }));
      z = endZ + 0.16;
      break;
    case 'longBarrel':
      add(main, cyl(r * 0.95, r * 0.95, 0.12, 8, W.dark, { y, z: endZ + 0.06, rx: Math.PI / 2 }));
      add(main, cyl(r * 1.5, r * 1.5, 0.03, 8, W.mid, { y, z: endZ + 0.11, rx: Math.PI / 2 }));
      z = endZ + 0.125;
      break;
    case 'standard':
      add(main, cyl(r * 1.3, r * 1.3, 0.03, 8, W.mid, { y, z: endZ + 0.01, rx: Math.PI / 2 }));
      z = endZ + 0.025;
      break;
  }
  a.muzzle.set(0, y, z);
  return z;
}

function addUnderbarrel(main: Parts, ub: UnderbarrelId, f: Frame, a: WeaponAnchors): void {
  const z = f.foreZ;
  const y = 0.03 - f.height * 0.4;
  switch (ub) {
    case 'vgrip':
      add(main, box(0.032, 0.08, 0.035, W.polymer, { y: y - 0.04, z }));
      a.fore.set(0, y - 0.06, z);
      break;
    case 'agrip':
      add(main, prismPart([[-0.035, 0], [0.035, 0], [0.0, -0.04]], 0.03, W.polymer, { y, z, ry: Math.PI / 2 }));
      a.fore.set(0, y - 0.03, z);
      break;
    case 'laser':
      add(main, box(0.03, 0.03, 0.07, W.dark, { x: f.width * 0.6, y: 0.03, z: z - 0.02 }));
      glow(main, box(0.01, 0.01, 0.004, 0xff3040, { x: f.width * 0.6, y: 0.03, z: z + 0.016 }));
      a.fore.set(0, y - 0.01, z);
      break;
    case 'bipod':
      add(main, box(0.03, 0.025, 0.04, W.dark, { y: y - 0.01, z: z + 0.06 }));
      add(main, box(0.012, 0.012, 0.18, W.mid, { x: 0.012, y: y - 0.02, z: z - 0.03 }));
      add(main, box(0.012, 0.012, 0.18, W.mid, { x: -0.012, y: y - 0.02, z: z - 0.03 }));
      a.fore.set(0, y - 0.01, z - 0.06);
      break;
    case 'none':
      break;
  }
}

function addAmmoMark(mag: Parts, ammo: AmmoId, f: Frame, id: WeaponId): void {
  if (!mag.toon.length || id === 'maul') return;
  const colors: Partial<Record<AmmoId, number>> = { piercing: 0xc04a3a, velocity: 0x3d6fa8, overcharge: 0xffd04a, focused: 0x8dff7a };
  const c = colors[ammo];
  if (c === undefined) return;
  const target = ammo === 'overcharge' || ammo === 'focused' ? mag.glow : mag.toon;
  target.push(box(0.052, 0.012, 0.07, c, { y: -f.magH * 0.85 - 0.02, z: f.magZ }));
}

/** First-person model (full detail, outlined, separate animated parts). */
export function buildWeaponModel(id: WeaponId, att: AttachmentSet, outline: THREE.Material = MATS.outlineChar, glowMat?: THREE.Material): WeaponModel {
  const b = buildParts(id, att);
  const group = new THREE.Group();
  const gmat = glowMat ?? glowMaterial(GLOW_RIG);
  const mk = (p: Parts): THREE.Object3D | null => {
    if (!p.toon.length && !p.glow.length) return null;
    const g = new THREE.Group();
    if (p.toon.length) g.add(outlinedMesh(merge(p.toon, true), outline, MATS.toon, false));
    if (p.glow.length) g.add(new THREE.Mesh(merge(p.glow, false), gmat));
    group.add(g);
    return g;
  };
  mk(b.main);
  const magObj = mk(b.mag);
  const boltObj = mk(b.bolt);
  const pumpObj = mk(b.pump);
  const opticObj = mk(b.optic);
  return { group, magObj, boltObj, pumpObj, opticObj, ...b.anchors };
}

/** Third-person model: all parts merged (toon with outline normals, glow). */
export function buildWeaponGeometry(id: WeaponId, att = defaultAttachments(id)): { toon: THREE.BufferGeometry; glow: THREE.BufferGeometry | null; anchors: WeaponAnchors } {
  const b = buildParts(id, att);
  const toon = [...b.main.toon, ...b.mag.toon, ...b.bolt.toon, ...b.pump.toon, ...b.optic.toon];
  const glowParts = [...b.main.glow, ...b.mag.glow, ...b.bolt.glow, ...b.pump.glow, ...b.optic.glow];
  return { toon: merge(toon, true), glow: glowParts.length ? merge(glowParts, false) : null, anchors: b.anchors };
}

/** Third-person hold offsets (from the head pivot, in the aim frame; x is the soldier's right). */
export function holdOffset(cat: WeaponCategory): THREE.Vector3 {
  switch (cat) {
    case 'sidearm':
      return new THREE.Vector3(-0.06, -0.2, 0.42);
    case 'launcher':
      return new THREE.Vector3(-0.17, -0.04, 0.05);
    case 'lmg':
      return new THREE.Vector3(-0.17, -0.22, 0.22);
    default:
      return new THREE.Vector3(-0.16, -0.17, 0.24);
  }
}
