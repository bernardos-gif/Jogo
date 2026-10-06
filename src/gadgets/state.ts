// Per-soldier gadget state and the specialist passives.
import { TUNING } from '../config/tuning';
import { SPECIALIST_BY_ID, type GadgetId, type SpecialistId } from '../config/content';
import type { Soldier } from '../player/soldier';

const G = TUNING.gadgets;

export interface GadgetState {
  id: GadgetId;
  /** Seconds until usable again. */
  cooldown: number;
  cooldownMax: number;
  charges: number;
  maxCharges: number;
  /** Arc Tool heat 0..1 (overheat locks it until cooled). */
  heat: number;
  overheated: boolean;
  /** Seconds the gadget stays disabled (EMP, Arc Tool). */
  disabledT: number;
  /** Mender: how long the trigger has been held, and whether that hold already self-healed. */
  holdT: number;
  holdUsed: boolean;
  rechargeT: number;
  /** Deployables currently out in the world. */
  deployed: number;
}

export function newGadgetState(id: GadgetId): GadgetState {
  const charges = id === 'mender' ? G.mender.charges : 1;
  return { id, cooldown: 0, cooldownMax: 1, charges, maxCharges: charges, heat: 0, overheated: false, disabledT: 0, holdT: 0, holdUsed: false, rechargeT: 0, deployed: 0 };
}

export function gadgetOf(spec: SpecialistId): GadgetId {
  return SPECIALIST_BY_ID[spec].gadget;
}

export type PassiveName = 'Momentum' | 'Plated' | 'Ordnance' | 'Insulated' | 'Triage' | 'Stockpile' | 'Long Gaze' | 'Wingsuit';

export function passiveOf(s: Soldier): PassiveName {
  return SPECIALIST_BY_ID[s.specialist].passiveName as PassiveName;
}

export function hasPassive(s: Soldier, p: PassiveName): boolean {
  return SPECIALIST_BY_ID[s.specialist].passiveName === p;
}
