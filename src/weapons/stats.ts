// Resolves a weapon's effective stats from tuning.ts and its attachments.
import { TUNING } from '../config/tuning';
import { WEAPON_BY_ID, type FireMode, type WeaponId, type EnergyFamily, type WeaponCategory } from '../config/content';
import type { AttachmentSet } from '../art/weaponModels';

export interface HeatStats {
  perShot: number;
  cool: number;
  coolDelay: number;
  lockout: number;
}

export interface WeaponStats {
  id: WeaponId;
  category: WeaponCategory;
  energy: EnergyFamily;
  damage: [number, number];
  range: [number, number];
  headMul: number;
  limbMul: number;
  armorMul: number;
  vehicleMul: number;
  rpm: number;
  modes: FireMode[];
  burst: number;
  mag: number;
  reserve: number;
  reload: number;
  reloadEmpty: number;
  perShell: boolean;
  velocity: number;
  gravityMul: number;
  adsTime: number;
  sprintToFire: number;
  equip: number;
  hip: number;
  ads: number;
  move: number;
  bloom: number;
  bloomHip: number;
  bloomMax: number;
  bloomRecover: number;
  recoil: { pattern: [number, number][]; random: number; recover: number; v: number; h: number };
  penetration: number;
  pellets: number;
  pelletSpread: number;
  moveMul: number;
  bolt: number;
  heat: HeatStats | null;
  zoom: number;
  scoped: boolean;
  suppressed: boolean;
  braced: number;
}

interface RawWeapon {
  damage: [number, number];
  range: [number, number];
  rpm: number;
  modes: FireMode[];
  mag: number;
  reserve: number;
  reload: number;
  reloadEmpty: number;
  velocity: number;
  adsTime: number;
  sprintToFire: number;
  hip: number;
  ads: number;
  move: number;
  bloom: number;
  bloomHip: number;
  bloomMax: number;
  bloomRecover: number;
  recoil: { pattern: number[][]; random: number; recover: number };
  penetration: number;
  headMul?: number;
  limbMul?: number;
  armorMul?: number;
  vehicleMul?: number;
  burst?: number;
  perShell?: boolean;
  gravityMul?: number;
  equip?: number;
  pellets?: number;
  pelletSpread?: number;
  moveMul?: number;
  bolt?: number;
  heat?: HeatStats;
}

export function rawWeapon(id: WeaponId): RawWeapon {
  return (TUNING.weapons.list as unknown as Record<WeaponId, RawWeapon>)[id];
}

const cache = new Map<string, WeaponStats>();

export function weaponStats(id: WeaponId, att: AttachmentSet): WeaponStats {
  const key = `${id}|${att.sight}|${att.barrel}|${att.underbarrel}|${att.ammo}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const r = rawWeapon(id);
  const d = TUNING.weapons.defaults;
  const A = TUNING.attachments;
  const sight = A.sights[att.sight];
  const barrel = A.barrels[att.barrel];
  const ub = A.underbarrels[att.underbarrel];
  const ammo = A.ammo[att.ammo];
  const info = WEAPON_BY_ID[id];
  const s: WeaponStats = {
    id,
    category: info.category,
    energy: info.energy,
    damage: [r.damage[0] * ammo.damage, r.damage[1] * ammo.damage],
    range: [r.range[0] * barrel.range * ammo.range, r.range[1] * barrel.range * ammo.range],
    headMul: r.headMul ?? d.headMul,
    limbMul: r.limbMul ?? d.limbMul,
    armorMul: (r.armorMul ?? d.armorMul) * ammo.armor,
    vehicleMul: r.vehicleMul ?? d.vehicleMul,
    rpm: r.rpm * ammo.rpm,
    modes: r.modes,
    burst: r.burst ?? d.burst,
    mag: Math.max(r.mag > 0 ? 1 : 0, Math.round(r.mag * ammo.mag)),
    reserve: r.reserve,
    reload: r.reload,
    reloadEmpty: r.reloadEmpty,
    perShell: !!r.perShell,
    velocity: r.velocity * barrel.velocity * ammo.velocity,
    gravityMul: (r.gravityMul ?? d.gravityMul) * ammo.drop,
    adsTime: r.adsTime * sight.adsTime * barrel.adsTime * ub.adsTime,
    sprintToFire: r.sprintToFire,
    equip: r.equip ?? d.equip,
    hip: r.hip * ub.hip * ammo.spread,
    ads: r.ads * ammo.spread,
    move: r.move,
    bloom: r.bloom,
    bloomHip: r.bloomHip,
    bloomMax: r.bloomMax,
    bloomRecover: r.bloomRecover,
    recoil: {
      pattern: r.recoil.pattern.map((p) => [p[0], p[1]] as [number, number]),
      random: r.recoil.random,
      recover: r.recoil.recover,
      v: barrel.recoilV * ub.recoilV,
      h: barrel.recoilH * ub.recoilH,
    },
    penetration: r.penetration + ammo.penetration,
    pellets: r.pellets ?? d.pellets,
    pelletSpread: r.pelletSpread ?? d.pelletSpread,
    moveMul: r.moveMul ?? d.moveMul,
    bolt: r.bolt ?? 0,
    heat: r.heat ? { ...r.heat, perShot: r.heat.perShot * ammo.heat } : null,
    zoom: sight.zoom,
    scoped: sight.scoped,
    suppressed: barrel.suppressed,
    braced: ub.braced,
  };
  cache.set(key, s);
  return s;
}

/** Seconds between shots. */
export function fireInterval(s: WeaponStats): number {
  return 60 / s.rpm;
}
