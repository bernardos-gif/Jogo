// Faction palettes for 3D models (STYLE_GUIDE.md section 7). The HUD uses relative friend/foe
// colors instead (UI_GUIDE.md).
import type { TeamId } from '../config/content';

export interface FactionPalette {
  armor: number;
  armorShade: number;
  secondary: number;
  dark: number;
  suit: number;
  boots: number;
  accent: number;
  glow: number;
  vehicleBase: number;
  vehicleShade: number;
}

export const FACTION_PALETTES: Record<TeamId, FactionPalette> = {
  0: {
    armor: 0xe8e2d4,
    armorShade: 0xc8c0b0,
    secondary: 0x3d6fa8,
    dark: 0x232838,
    suit: 0x3a4256,
    boots: 0x2a2f3c,
    accent: 0x9aa6b8,
    glow: 0x3fe0ff,
    vehicleBase: 0xd8d2c4,
    vehicleShade: 0x3d6fa8,
  },
  1: {
    armor: 0x4a4450,
    armorShade: 0x3a3440,
    secondary: 0xb03a3a,
    dark: 0x221c24,
    suit: 0x2e2a34,
    boots: 0x1e1a22,
    accent: 0x8a7a70,
    glow: 0xff3a5c,
    vehicleBase: 0x55505c,
    vehicleShade: 0xb03a3a,
  },
};

/** Neutral weapon colors (weapons are shared by both factions). */
export const WEAPON_COLORS = {
  body: 0x4c5466,
  dark: 0x2c3038,
  mid: 0x66708a,
  light: 0x98a2b8,
  polymer: 0x3a4050,
  brass: 0xd8a040,
  rocket: 0x6a7048,
};
