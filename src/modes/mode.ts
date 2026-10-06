// Game mode interface: rules layered on top of the Battle runtime.
import type { Battle } from './battle';

export interface BattleMode {
  readonly id: string;
  setup(b: Battle): void;
  update(dt: number): void;
  /** Per rendered frame (HUD readouts). */
  frame?(dt: number): void;
  dispose?(): void;
}
