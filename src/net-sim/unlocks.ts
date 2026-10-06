// Unlocks: weapons and attachment options open up with player level; the "unlock all" setting
// bypasses every lock.
import { TUNING } from '../config/tuning';
import { WEAPON_BY_ID, type AttachmentId, type WeaponId } from '../config/content';
import { save } from '../core/save';
import { levelFor } from './progression';

const P = TUNING.progression;

export function playerLevel(): number {
  return levelFor(save.data.progression.xp).level;
}

export function weaponLevel(id: WeaponId): number {
  return P.weaponLevels[id] ?? 1;
}

export function weaponUnlocked(id: WeaponId): boolean {
  return save.settings.unlockAll || playerLevel() >= weaponLevel(id);
}

/** Level needed for an attachment option on a weapon (by its position in the slot's list). */
export function attachmentLevel(weapon: WeaponId, att: AttachmentId): number {
  const w = WEAPON_BY_ID[weapon];
  for (const list of [w.sights, w.barrels, w.underbarrels, w.ammos] as readonly AttachmentId[][]) {
    const i = list.indexOf(att);
    if (i >= 0) return P.attachmentLevels[Math.min(i, P.attachmentLevels.length - 1)];
  }
  return 1;
}

export function attachmentUnlocked(weapon: WeaponId, att: AttachmentId): boolean {
  return save.settings.unlockAll || playerLevel() >= attachmentLevel(weapon, att);
}
