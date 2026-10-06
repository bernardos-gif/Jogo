// Per-soldier weapon state: three slots (primary, sidearm, launcher), ammo, heat, reloads, fire
// modes, recoil strings, launcher lock-on, throwables and melee timers.
import { TUNING } from '../config/tuning';
import { weaponStats, type WeaponStats } from './stats';
import { defaultAttachments, type AttachmentSet } from '../art/weaponModels';
import type { FireMode, ThrowableId, WeaponId } from '../config/content';

export class WeaponState {
  readonly id: WeaponId;
  att: AttachmentSet;
  stats: WeaponStats;
  mag: number;
  reserve: number;
  modeIndex = 0;
  heat = 0;
  overheatT = 0;
  heatCoolT = 0;
  /** Reload progress in seconds (-1 when not reloading). */
  reloadT = -1;
  reloadDur = 0;
  /** Bolt / pump cycling after a shot (-1 when idle). */
  cycleT = -1;
  cooldown = 0;
  burstLeft = 0;
  /** Shots in the current string (resets when the trigger is released). */
  shot = 0;
  /** Counts strings so each string's recoil noise is deterministic but distinct. */
  stringIndex = 0;
  lastShotT = -999;
  bloom = 0;
  /** Accumulated vertical recoil (radians) still to be recovered. */
  recoilAccum = 0;
  /** Recoil still being returned to the aim after the string ended. */
  recoverLeft = 0;
  // Launcher lock-on.
  lockT = 0;
  lockTarget: unknown = null;
  locked = false;

  constructor(id: WeaponId, att: AttachmentSet, reserveBonus = 0) {
    this.id = id;
    this.att = att;
    this.stats = weaponStats(id, att);
    this.mag = this.stats.mag;
    this.reserve = this.stats.reserve + reserveBonus;
  }

  get mode(): FireMode {
    return this.stats.modes[this.modeIndex % this.stats.modes.length];
  }

  get usesHeat(): boolean {
    return this.stats.heat !== null;
  }

  get reloading(): boolean {
    return this.reloadT >= 0;
  }

  setAttachments(att: AttachmentSet): void {
    this.att = att;
    const prevMag = this.stats.mag;
    this.stats = weaponStats(this.id, att);
    if (this.stats.mag !== prevMag) this.mag = Math.min(this.mag, this.stats.mag);
  }

  refill(): void {
    this.mag = this.stats.mag;
    this.reserve = this.stats.reserve;
    this.heat = 0;
    this.overheatT = 0;
  }
}

export class Arsenal {
  slots: WeaponState[];
  slot = 0;
  /** Seconds left of the equip animation (0 = ready). */
  equipT = 0;
  equipDur = 0.4;
  adsK = 0;
  /** Seconds until the weapon can fire after sprinting. */
  sprintBlock = 0;
  throwable: ThrowableId;
  throwables: number;
  throwT = -1;
  meleeT = -1;
  meleeCooldown = 0;
  inspectT = -1;
  /** Time since the throwable stock last refilled (passive resupply). */
  resupplyT = 0;

  constructor(primary: WeaponId, attachments: (id: WeaponId) => AttachmentSet, throwable: ThrowableId, rocketBonus = 0) {
    this.slots = [new WeaponState(primary, attachments(primary)), new WeaponState('sparrow', attachments('sparrow')), new WeaponState('hammerhead', attachments('hammerhead'), rocketBonus)];
    this.throwable = throwable;
    this.throwables = TUNING.throwables[throwable].count;
  }

  get current(): WeaponState {
    return this.slots[this.slot];
  }

  /** Equip progress 0..1. */
  get equipK(): number {
    return this.equipDur > 0 ? 1 - this.equipT / this.equipDur : 1;
  }

  switchTo(i: number): boolean {
    if (i === this.slot || i < 0 || i >= this.slots.length) return false;
    const cur = this.current;
    if (cur.reloading && !cur.stats.perShell) cur.reloadT = -1;
    else if (cur.reloading) cur.reloadT = -1;
    this.slot = i;
    this.equipDur = this.current.stats.equip;
    this.equipT = this.equipDur;
    this.adsK = 0;
    this.inspectT = -1;
    return true;
  }

  refillAll(): void {
    for (const w of this.slots) w.refill();
    this.throwables = TUNING.throwables[this.throwable].count;
  }

  static defaults(id: WeaponId): AttachmentSet {
    return defaultAttachments(id);
  }
}
