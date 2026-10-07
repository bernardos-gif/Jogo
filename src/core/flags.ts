// Launch flags. Electron forwards its command line (--autoplay, --smoke, ...) as URL query
// parameters; the browser build reads the same parameters directly (e.g. ?autoplay=1).

export type ModeId = 'sector' | 'skirmish';

export interface LaunchFlags {
  /** The player's soldier is driven by bot AI and matches start and restart by themselves. */
  autoplay: boolean;
  /** Headless smoke test: low preset, no audio output, test hooks. */
  smoke: boolean;
  /** Long soak run (same as smoke, but rounds chain until the harness stops). */
  soak: boolean;
  mode: ModeId | null;
  seed: number | null;
  preset: 'low' | 'medium' | 'high' | 'ultra' | null;
  bots: number | null;
  /** Developer scenes: 'style' (M1 style test), 'range' (firing range). */
  scene: string | null;
  /** Fixed debug camera 'x,y,z,tx,ty,tz' for screenshots (hides HUD and viewmodel). */
  cam: number[] | null;
  /** Debug: third-person camera that follows a bot in a firefight. */
  spectate: boolean;
  /** Debug: with --spectate=<vehicle kind> (or 'vehicle') the camera chases a bot-driven vehicle. */
  spectateKind: string | null;
  /** Debug: third-person camera behind the player. */
  tp: boolean;
  /** Test override for the starting ticket count (short rounds). */
  tickets: number | null;
  /** --events=fast: the storm and the launch come early (tests and soak runs). */
  events: 'fast' | null;
}

function parse(search: string): LaunchFlags {
  const q = new URLSearchParams(search);
  const on = (k: string) => q.has(k) && q.get(k) !== '0' && q.get(k) !== 'false';
  const num = (k: string) => {
    const v = q.get(k);
    if (v === null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const mode = q.get('mode');
  const preset = q.get('preset');
  return {
    autoplay: on('autoplay'),
    smoke: on('smoke'),
    soak: on('soak'),
    mode: mode === 'skirmish' || mode === 'sector' ? mode : null,
    seed: num('seed'),
    preset: preset === 'low' || preset === 'medium' || preset === 'high' || preset === 'ultra' ? preset : null,
    bots: num('bots'),
    scene: q.get('scene'),
    cam: q.get('cam') ? q.get('cam')!.split(',').map(Number) : null,
    spectate: on('spectate'),
    spectateKind: q.get('spectate') && !['1', 'true', ''].includes(q.get('spectate')!) ? q.get('spectate') : null,
    tp: on('tp'),
    tickets: num('tickets'),
    events: q.get('events') === 'fast' ? 'fast' : null,
  };
}

export const flags: LaunchFlags = parse(typeof location !== 'undefined' ? location.search : '');

/** True for any automated run (smoke or soak): disables audio output and enables test hooks. */
export const automated = flags.smoke || flags.soak;
