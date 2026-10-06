// Data the in-match HUD reads each frame (assembled by the battle from the runtime and the mode).
import type * as THREE from 'three';
import type { Soldier } from '../../player/soldier';
import type { ZoneState } from '../../modes/sector/logic';
import type { TacticalImage } from '../../render/tacticalMap';
import type { Ping } from '../../net-sim/pings';
import type { TeamId } from '../../config/content';

export interface HudPrompt {
  key: string;
  text: string;
  /** Hold progress 0..1 for hold interactions (revive), or null. */
  hold: number | null;
}

export interface HudWorld {
  time: number;
  player: Soldier;
  camera: THREE.PerspectiveCamera;
  soldiers: readonly Soldier[];
  squad: readonly Soldier[];
  squadName: string;
  zones: readonly ZoneState[];
  /** Friendly then enemy are resolved by the HUD from the player's team. */
  tickets: [number, number] | null;
  ticketMax: number;
  bleed: [number, number];
  /** Score target mode (Skirmish): kills per team and the target. */
  kills: [number, number] | null;
  killTarget: number;
  roundT: number;
  timeLeft: number | null;
  modeName: string;
  hqs: readonly { team: TeamId; x: number; z: number }[];
  limit: number;
  map: TacticalImage | null;
  pings: readonly Ping[];
  frags: readonly { pos: THREE.Vector3 }[];
  prompt: HudPrompt | null;
  hazards: readonly { x: number; z: number; r: number; label: string }[];
  /** Piloted drone readout (battery fraction, altitude above ground, hp fraction). */
  drone: { battery: number; altitude: number; hp: number } | null;
}
