// Names, descriptions and identifiers for factions, classes, specialists, weapons, attachments,
// throwables, vehicles and map districts. All invented for Vector Front. Gameplay numbers for
// these live in tuning.ts, keyed by the same ids.

export type TeamId = 0 | 1;
export type ClassId = 'assault' | 'engineer' | 'support' | 'recon';
export type SpecialistId = 'varga' | 'okonjo' | 'halloran' | 'petrova' | 'adeyemi' | 'lindqvist' | 'tanaka' | 'rousseau';
export type WeaponId = 'tern' | 'lumen' | 'wasp' | 'flicker' | 'anvil' | 'torrent' | 'sable' | 'prism' | 'longbow' | 'maul' | 'sparrow' | 'hammerhead';
export type WeaponCategory = 'ar' | 'smg' | 'lmg' | 'dmr' | 'sniper' | 'shotgun' | 'sidearm' | 'launcher';
export type FireMode = 'auto' | 'burst' | 'single';
export type AttachmentSlot = 'sight' | 'barrel' | 'underbarrel' | 'ammo';
export type SightId = 'iron' | 'holo' | 'prism2' | 'optic4' | 'optic8' | 'thermal6';
export type BarrelId = 'standard' | 'compensator' | 'suppressor' | 'longBarrel';
export type UnderbarrelId = 'none' | 'vgrip' | 'agrip' | 'laser' | 'bipod';
export type AmmoId = 'standard' | 'piercing' | 'velocity' | 'overcharge' | 'focused';
export type AttachmentId = SightId | BarrelId | UnderbarrelId | AmmoId;
export type ThrowableId = 'frag' | 'smoke' | 'emp';
export type GadgetId = 'grapple' | 'shield' | 'sentry' | 'arctool' | 'mender' | 'cache' | 'drone' | 'sensor';
export type VehicleKind = 'wisp' | 'basalt' | 'condor' | 'midge';
export type ZoneId = 'A' | 'B' | 'C' | 'D' | 'E';
export type EnergyFamily = 'kinetic' | 'cyan' | 'violet' | 'rocket';

export const FACTIONS: Record<TeamId, { name: string; short: string; motto: string }> = {
  0: { name: 'Halcyon Accord', short: 'HAC', motto: 'Hold the line, light the way.' },
  1: { name: 'Korvath Pact', short: 'KVP', motto: 'Iron answers every storm.' },
};

export const CLASSES: Record<ClassId, { name: string; role: string }> = {
  assault: { name: 'Assault', role: 'Breach and push objectives' },
  engineer: { name: 'Engineer', role: 'Vehicles, anti-armor and fortifications' },
  support: { name: 'Support', role: 'Healing, revives and resupply' },
  recon: { name: 'Recon', role: 'Spotting, intel and long range' },
};

export interface SpecialistInfo {
  id: SpecialistId;
  callsign: string;
  name: string;
  cls: ClassId;
  gadget: GadgetId;
  gadgetName: string;
  gadgetDesc: string;
  passiveName: string;
  passiveDesc: string;
}

export const SPECIALISTS: SpecialistInfo[] = [
  {
    id: 'varga',
    callsign: 'VARGA',
    name: 'Ilse Varga',
    cls: 'assault',
    gadget: 'grapple',
    gadgetName: 'Grapnel',
    gadgetDesc: 'Wrist grapple that reels you to any surface in range.',
    passiveName: 'Momentum',
    passiveDesc: 'Faster sprint and quicker sprint-to-fire.',
  },
  {
    id: 'okonjo',
    callsign: 'OKONJO',
    name: 'Tomi Okonjo',
    cls: 'assault',
    gadget: 'shield',
    gadgetName: 'Bulwark',
    gadgetDesc: 'Deployable hex-cell energy wall that stops bullets both ways.',
    passiveName: 'Plated',
    passiveDesc: 'Spawns with an armor plate that rebuilds out of combat.',
  },
  {
    id: 'halloran',
    callsign: 'HALLORAN',
    name: 'Bram Halloran',
    cls: 'engineer',
    gadget: 'sentry',
    gadgetName: 'Watchdog',
    gadgetDesc: 'Auto sentry turret that tracks and fires on enemies.',
    passiveName: 'Ordnance',
    passiveDesc: 'Carries two extra rockets.',
  },
  {
    id: 'petrova',
    callsign: 'PETROVA',
    name: 'Nadia Petrova',
    cls: 'engineer',
    gadget: 'arctool',
    gadgetName: 'Arc Tool',
    gadgetDesc: 'Repairs friendly vehicles; overloads enemy ones with EMP.',
    passiveName: 'Insulated',
    passiveDesc: 'Takes less damage from explosions.',
  },
  {
    id: 'adeyemi',
    callsign: 'ADEYEMI',
    name: 'Kemi Adeyemi',
    cls: 'support',
    gadget: 'mender',
    gadgetName: 'Mender',
    gadgetDesc: 'Dart launcher that heals allies and yourself.',
    passiveName: 'Triage',
    passiveDesc: 'Revives twice as fast; revived allies return at full health.',
  },
  {
    id: 'lindqvist',
    callsign: 'LINDQVIST',
    name: 'Soren Lindqvist',
    cls: 'support',
    gadget: 'cache',
    gadgetName: 'Supply Cache',
    gadgetDesc: 'Drop crate that refills ammo, throwables and armor plates.',
    passiveName: 'Stockpile',
    passiveDesc: 'Nearby squadmates start regenerating sooner.',
  },
  {
    id: 'tanaka',
    callsign: 'TANAKA',
    name: 'Rei Tanaka',
    cls: 'recon',
    gadget: 'drone',
    gadgetName: 'Kestrel',
    gadgetDesc: 'Pilotable scout drone that spots enemies for the team.',
    passiveName: 'Long Gaze',
    passiveDesc: 'Enemies you spot stay marked twice as long.',
  },
  {
    id: 'rousseau',
    callsign: 'ROUSSEAU',
    name: 'Lucien Rousseau',
    cls: 'recon',
    gadget: 'sensor',
    gadgetName: 'Echo',
    gadgetDesc: 'Throwable motion sensor that reveals moving enemies.',
    passiveName: 'Wingsuit',
    passiveDesc: 'Glides on a wingsuit instead of a parachute.',
  },
];

export const SPECIALIST_BY_ID: Record<SpecialistId, SpecialistInfo> = Object.fromEntries(SPECIALISTS.map((s) => [s.id, s])) as Record<SpecialistId, SpecialistInfo>;

export interface WeaponInfo {
  id: WeaponId;
  name: string;
  category: WeaponCategory;
  energy: EnergyFamily;
  desc: string;
  sights: [SightId, SightId, SightId];
  barrels: [BarrelId, BarrelId, BarrelId];
  underbarrels: [UnderbarrelId, UnderbarrelId, UnderbarrelId];
  ammos: [AmmoId, AmmoId, AmmoId];
}

export const WEAPONS: WeaponInfo[] = [
  { id: 'tern', name: 'Tern AR-4', category: 'ar', energy: 'kinetic', desc: 'Balanced kinetic assault rifle.', sights: ['holo', 'prism2', 'optic4'], barrels: ['standard', 'compensator', 'suppressor'], underbarrels: ['vgrip', 'agrip', 'laser'], ammos: ['standard', 'piercing', 'velocity'] },
  { id: 'lumen', name: 'Lumen ER-9', category: 'ar', energy: 'cyan', desc: 'Pulse rifle: fast, flat energy bolts.', sights: ['holo', 'prism2', 'optic4'], barrels: ['standard', 'compensator', 'suppressor'], underbarrels: ['vgrip', 'agrip', 'laser'], ammos: ['standard', 'overcharge', 'focused'] },
  { id: 'wasp', name: 'Wasp SMG-11', category: 'smg', energy: 'kinetic', desc: 'High rate of fire for close quarters.', sights: ['iron', 'holo', 'prism2'], barrels: ['standard', 'compensator', 'suppressor'], underbarrels: ['vgrip', 'agrip', 'laser'], ammos: ['standard', 'piercing', 'velocity'] },
  { id: 'flicker', name: 'Flicker EPD', category: 'smg', energy: 'violet', desc: 'Energy PDW with deep cell capacity.', sights: ['iron', 'holo', 'prism2'], barrels: ['standard', 'compensator', 'suppressor'], underbarrels: ['vgrip', 'agrip', 'laser'], ammos: ['standard', 'overcharge', 'focused'] },
  { id: 'anvil', name: 'Anvil LMG-2', category: 'lmg', energy: 'kinetic', desc: 'Belt-fed suppression with a 100-round box.', sights: ['holo', 'prism2', 'optic4'], barrels: ['standard', 'compensator', 'longBarrel'], underbarrels: ['bipod', 'vgrip', 'agrip'], ammos: ['standard', 'piercing', 'velocity'] },
  { id: 'torrent', name: 'Torrent HL-6', category: 'lmg', energy: 'cyan', desc: 'Heat-cycled beam LMG: no magazine, watch the heat.', sights: ['holo', 'prism2', 'optic4'], barrels: ['standard', 'compensator', 'longBarrel'], underbarrels: ['bipod', 'vgrip', 'agrip'], ammos: ['standard', 'overcharge', 'focused'] },
  { id: 'sable', name: 'Sable DMR-7', category: 'dmr', energy: 'kinetic', desc: 'Semi-automatic marksman rifle.', sights: ['prism2', 'optic4', 'optic8'], barrels: ['standard', 'suppressor', 'longBarrel'], underbarrels: ['vgrip', 'bipod', 'laser'], ammos: ['standard', 'piercing', 'velocity'] },
  { id: 'prism', name: 'Prism EMR-3', category: 'dmr', energy: 'violet', desc: 'Energy marksman rifle with a three-round burst.', sights: ['prism2', 'optic4', 'thermal6'], barrels: ['standard', 'suppressor', 'longBarrel'], underbarrels: ['vgrip', 'bipod', 'laser'], ammos: ['standard', 'overcharge', 'focused'] },
  { id: 'longbow', name: 'Longbow BR-12', category: 'sniper', energy: 'kinetic', desc: 'Bolt-action rifle; a headshot ends it.', sights: ['optic4', 'optic8', 'thermal6'], barrels: ['standard', 'suppressor', 'longBarrel'], underbarrels: ['bipod', 'vgrip', 'laser'], ammos: ['standard', 'piercing', 'velocity'] },
  { id: 'maul', name: 'Maul SG-8', category: 'shotgun', energy: 'kinetic', desc: 'Pump shotgun with a tight pellet spread.', sights: ['iron', 'holo', 'prism2'], barrels: ['standard', 'compensator', 'longBarrel'], underbarrels: ['vgrip', 'agrip', 'laser'], ammos: ['standard', 'piercing', 'velocity'] },
  { id: 'sparrow', name: 'Sparrow P-2', category: 'sidearm', energy: 'kinetic', desc: 'Reliable semi-automatic sidearm.', sights: ['iron', 'holo', 'prism2'], barrels: ['standard', 'compensator', 'suppressor'], underbarrels: ['none', 'laser', 'agrip'], ammos: ['standard', 'piercing', 'velocity'] },
  { id: 'hammerhead', name: 'Hammerhead RL', category: 'launcher', energy: 'rocket', desc: 'Shoulder rocket: dumb-fire or lock on to vehicles.', sights: ['iron', 'prism2', 'optic4'], barrels: ['standard', 'standard', 'standard'], underbarrels: ['none', 'none', 'none'], ammos: ['standard', 'velocity', 'piercing'] },
];

export const WEAPON_BY_ID: Record<WeaponId, WeaponInfo> = Object.fromEntries(WEAPONS.map((w) => [w.id, w])) as Record<WeaponId, WeaponInfo>;
export const PRIMARY_WEAPONS: WeaponId[] = WEAPONS.filter((w) => w.category !== 'sidearm' && w.category !== 'launcher').map((w) => w.id);

export const ATTACHMENT_NAMES: Record<AttachmentId, string> = {
  iron: 'Iron Sights',
  holo: 'Halo Dot 1.25x',
  prism2: 'Prism 2x',
  optic4: 'Scout Optic 4x',
  optic8: 'Long Optic 8x',
  thermal6: 'Thermal 6x',
  standard: 'Standard',
  compensator: 'Compensator',
  suppressor: 'Suppressor',
  longBarrel: 'Long Barrel',
  none: 'None',
  vgrip: 'Vertical Grip',
  agrip: 'Angled Grip',
  laser: 'Aim Laser',
  bipod: 'Bipod',
  piercing: 'Piercing Rounds',
  velocity: 'High Velocity',
  overcharge: 'Overcharged Cells',
  focused: 'Focused Cells',
};

export const THROWABLES: Record<ThrowableId, { name: string; desc: string }> = {
  frag: { name: 'Shard Frag', desc: 'Fragmentation grenade.' },
  smoke: { name: 'Veil Smoke', desc: 'Dense smoke screen that blocks sight.' },
  emp: { name: 'Pulse EMP', desc: 'Disables vehicles, gadgets and HUDs in the blast.' },
};

export const VEHICLES: Record<VehicleKind, { name: string; role: string; seats: string[] }> = {
  wisp: { name: 'Wisp', role: 'Scout hover buggy', seats: ['Driver', 'Passenger (left)', 'Passenger (right)'] },
  basalt: { name: 'Basalt', role: 'Hover tank', seats: ['Driver / Cannon', 'Gunner / Coax beam'] },
  condor: { name: 'Condor', role: 'VTOL gunship', seats: ['Pilot / Rockets', 'Gunner / Chin turret'] },
  midge: { name: 'Midge', role: 'Scout helicopter', seats: ['Pilot / Miniguns', 'Door gunner'] },
};

export const ZONES: Record<ZoneId, { name: string; district: string }> = {
  A: { name: 'Gantry', district: 'Launch complex' },
  B: { name: 'Moorings', district: 'Container port' },
  C: { name: 'Core Plaza', district: 'Data towers' },
  D: { name: 'Sunfield', district: 'Solar field' },
  E: { name: 'Ridgeline', district: 'Relay array' },
};
export const ZONE_IDS: ZoneId[] = ['A', 'B', 'C', 'D', 'E'];

export const MAP_NAME = 'Breakwater Launch Port';

/** Bot name pool (callsign-style, invented). */
export const BOT_NAMES = [
  'Abeni', 'Arlo', 'Basil', 'Cato', 'Dace', 'Edda', 'Faro', 'Galen', 'Hesper', 'Ione', 'Jarek', 'Kaito', 'Lior', 'Mabry', 'Nell', 'Orrin',
  'Pell', 'Quill', 'Rasa', 'Soto', 'Tamar', 'Udo', 'Vey', 'Wren', 'Xan', 'Yara', 'Zev', 'Ansel', 'Brisk', 'Corin', 'Dell', 'Emrys',
  'Fenn', 'Greer', 'Hollis', 'Ivo', 'Jules', 'Kerr', 'Lark', 'Moss', 'Nyx', 'Oona', 'Pike', 'Reyes', 'Selby', 'Teague', 'Ulla', 'Voss',
  'Wynn', 'Yuki', 'Zuri', 'Ash', 'Bram', 'Cyra', 'Dax', 'Esme', 'Flint', 'Gage', 'Haze', 'Isla', 'Jory', 'Kit', 'Lyle', 'Mara',
];
