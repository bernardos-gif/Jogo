// Persistent save: settings, key bindings, loadouts and progression in one JSON document
// (Electron userData/vector-front-save.json, or localStorage in the browser build).
import { native } from './native';
import { DEFAULT_BINDINGS, type Bindings, type Action } from './input';
import { TUNING } from '../config/tuning';
import type { PresetId } from '../render/quality';
import type { AttachmentSet } from '../art/weaponModels';
import type { ClassId, SpecialistId, ThrowableId, WeaponId } from '../config/content';

export type Palette = 'default' | 'deuteranopia' | 'protanopia' | 'tritanopia';
export type Difficulty = 'recruit' | 'veteran' | 'elite';

export interface Settings {
  preset: PresetId;
  shadows: boolean;
  bloom: boolean;
  outlines: boolean;
  dynamicResolution: boolean;
  resolutionScale: number;
  particles: number;
  fov: number;
  sensHip: number;
  sensAds: number;
  sensVehicle: number;
  invertY: boolean;
  bindings: Bindings;
  volMaster: number;
  volSfx: number;
  volMusic: number;
  volUi: number;
  volVoice: number;
  palette: Palette;
  hudScale: number;
  hudOpacity: number;
  hudMotion: 'auto' | 'full' | 'reduced';
  screenShake: number;
  headBob: boolean;
  unlockAll: boolean;
  difficulty: Difficulty;
  teamSize: number;
  showFps: boolean;
}

export interface ClassLoadout {
  specialist: SpecialistId;
  primary: WeaponId;
  throwable: ThrowableId;
}

export interface Progression {
  xp: number;
  matches: number;
  wins: number;
  kills: number;
  deaths: number;
  mastery: Partial<Record<WeaponId, { kills: number; headshots: number }>>;
}

export interface SaveData {
  version: 1;
  settings: Settings;
  cls: ClassId;
  loadouts: Record<ClassId, ClassLoadout>;
  attachments: Partial<Record<WeaponId, AttachmentSet>>;
  progression: Progression;
}

export function defaultSettings(): Settings {
  return {
    preset: 'high',
    shadows: true,
    bloom: true,
    outlines: true,
    dynamicResolution: true,
    resolutionScale: 1,
    particles: 1,
    fov: TUNING.camera.defaultFov,
    sensHip: TUNING.camera.defaultSensitivity,
    sensAds: TUNING.camera.defaultAdsSensitivity,
    sensVehicle: TUNING.camera.defaultVehicleSensitivity,
    invertY: false,
    bindings: structuredClone(DEFAULT_BINDINGS),
    volMaster: 0.8,
    volSfx: 0.9,
    volMusic: 0.55,
    volUi: 0.7,
    volVoice: 0.8,
    palette: 'default',
    hudScale: 1,
    hudOpacity: 1,
    hudMotion: 'auto',
    screenShake: 1,
    headBob: true,
    unlockAll: false,
    difficulty: 'veteran',
    teamSize: 24,
    showFps: false,
  };
}

export function defaultSave(): SaveData {
  return {
    version: 1,
    settings: defaultSettings(),
    cls: 'assault',
    loadouts: {
      assault: { specialist: 'varga', primary: 'tern', throwable: 'frag' },
      engineer: { specialist: 'halloran', primary: 'wasp', throwable: 'frag' },
      support: { specialist: 'adeyemi', primary: 'anvil', throwable: 'smoke' },
      recon: { specialist: 'tanaka', primary: 'sable', throwable: 'emp' },
    },
    attachments: {},
    progression: { xp: 0, matches: 0, wins: 0, kills: 0, deaths: 0, mastery: {} },
  };
}

/** Deep-merges loaded data over defaults so new fields get sensible values. */
function mergeSave(raw: unknown): SaveData {
  const base = defaultSave();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<SaveData>;
  const settings = { ...base.settings, ...(r.settings ?? {}) } as Settings;
  settings.bindings = { ...DEFAULT_BINDINGS, ...((r.settings?.bindings ?? {}) as Partial<Bindings>) };
  for (const k of Object.keys(settings.bindings) as Action[]) if (!Array.isArray(settings.bindings[k])) settings.bindings[k] = DEFAULT_BINDINGS[k];
  return {
    version: 1,
    settings,
    cls: r.cls ?? base.cls,
    loadouts: { ...base.loadouts, ...(r.loadouts ?? {}) },
    attachments: { ...(r.attachments ?? {}) },
    progression: { ...base.progression, ...(r.progression ?? {}), mastery: { ...(r.progression?.mastery ?? {}) } },
  };
}

type Listener = (s: SaveData) => void;

class SaveStore {
  data: SaveData = defaultSave();
  private listeners: Listener[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  async load(): Promise<void> {
    try {
      const json = await native.readSave();
      this.data = mergeSave(json ? JSON.parse(json) : null);
    } catch {
      this.data = defaultSave();
    }
  }

  get settings(): Settings {
    return this.data.settings;
  }

  /** Applies a change, notifies listeners and schedules a write. */
  update(fn: (d: SaveData) => void): void {
    fn(this.data);
    for (const l of this.listeners) l(this.data);
    this.scheduleWrite();
  }

  onChange(l: Listener): void {
    this.listeners.push(l);
  }

  private scheduleWrite(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void native.writeSave(JSON.stringify(this.data, null, 1));
    }, 400);
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    void native.writeSave(JSON.stringify(this.data, null, 1));
  }

  reset(): void {
    this.data = defaultSave();
    this.update(() => undefined);
  }
}

export const save = new SaveStore();
