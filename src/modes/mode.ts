// Game mode interface: rules layered on top of the Battle runtime.
import type { Battle } from './battle';
import type { ZoneState } from './sector/logic';

/** What the HUD shows about the mode (objectives, scores, clock). */
export interface ModeHudInfo {
  modeName: string;
  zones: readonly ZoneState[];
  tickets: [number, number] | null;
  ticketMax: number;
  bleed: [number, number];
  kills: [number, number] | null;
  killTarget: number;
  roundT: number;
  timeLeft: number | null;
}

export interface BattleMode {
  readonly id: string;
  setup(b: Battle): void;
  update(dt: number): void;
  /** Per rendered frame (HUD readouts). */
  frame?(dt: number): void;
  hudInfo?(): ModeHudInfo;
  /** Squad callsign for a soldier (scoreboard). */
  squadName?(squadId: number): string;
  dispose?(): void;
}
