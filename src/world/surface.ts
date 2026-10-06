// Surface materials: drive bullet penetration, impact effects, impact sounds and footsteps.

export type Surface = 'concrete' | 'metal' | 'sheet' | 'glass' | 'wood' | 'dirt' | 'sand' | 'grass' | 'water' | 'armor' | 'energy';

export const SURFACES: Surface[] = ['concrete', 'metal', 'sheet', 'glass', 'wood', 'dirt', 'sand', 'grass', 'water', 'armor', 'energy'];

/** Compact numeric code for storing per-triangle surfaces. */
export const SURFACE_CODE: Record<Surface, number> = Object.fromEntries(SURFACES.map((s, i) => [s, i])) as Record<Surface, number>;
