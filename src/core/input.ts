// Keyboard and mouse input with rebindable actions, pointer lock, double-tap and hold detection.
// Edges (pressed / released) are latched per rendered frame so the fixed-step simulation sees
// each press exactly once regardless of how many sim steps run in a frame.

export type Action =
  | 'moveForward'
  | 'moveBack'
  | 'moveLeft'
  | 'moveRight'
  | 'sprint'
  | 'crouch'
  | 'prone'
  | 'jump'
  | 'fire'
  | 'aim'
  | 'reload'
  | 'weapon1'
  | 'weapon2'
  | 'weapon3'
  | 'gadget'
  | 'grenade'
  | 'melee'
  | 'fireMode'
  | 'attachments'
  | 'tablet'
  | 'interact'
  | 'ping'
  | 'seat1'
  | 'seat2'
  | 'seat3'
  | 'seat4'
  | 'vehicleCamera'
  | 'map'
  | 'scoreboard'
  | 'pause'
  | 'inspect';

export const ACTIONS: { id: Action; label: string; group: 'Movement' | 'Combat' | 'Equipment' | 'Vehicles' | 'Interface' }[] = [
  { id: 'moveForward', label: 'Move forward', group: 'Movement' },
  { id: 'moveBack', label: 'Move back', group: 'Movement' },
  { id: 'moveLeft', label: 'Move left', group: 'Movement' },
  { id: 'moveRight', label: 'Move right', group: 'Movement' },
  { id: 'sprint', label: 'Sprint (double-tap: tactical sprint)', group: 'Movement' },
  { id: 'crouch', label: 'Crouch / slide', group: 'Movement' },
  { id: 'prone', label: 'Prone', group: 'Movement' },
  { id: 'jump', label: 'Jump / vault / parachute', group: 'Movement' },
  { id: 'fire', label: 'Fire', group: 'Combat' },
  { id: 'aim', label: 'Aim down sights', group: 'Combat' },
  { id: 'reload', label: 'Reload', group: 'Combat' },
  { id: 'weapon1', label: 'Primary weapon', group: 'Combat' },
  { id: 'weapon2', label: 'Sidearm', group: 'Combat' },
  { id: 'weapon3', label: 'Launcher', group: 'Combat' },
  { id: 'melee', label: 'Melee', group: 'Combat' },
  { id: 'fireMode', label: 'Fire mode / countermeasures', group: 'Combat' },
  { id: 'inspect', label: 'Inspect weapon', group: 'Combat' },
  { id: 'gadget', label: 'Gadget', group: 'Equipment' },
  { id: 'grenade', label: 'Throwable', group: 'Equipment' },
  { id: 'attachments', label: 'Attachments (hold)', group: 'Equipment' },
  { id: 'tablet', label: 'Call-in tablet (hold)', group: 'Equipment' },
  { id: 'interact', label: 'Interact / enter vehicle', group: 'Equipment' },
  { id: 'ping', label: 'Ping (hold: comms rose)', group: 'Equipment' },
  { id: 'seat1', label: 'Seat 1', group: 'Vehicles' },
  { id: 'seat2', label: 'Seat 2', group: 'Vehicles' },
  { id: 'seat3', label: 'Seat 3', group: 'Vehicles' },
  { id: 'seat4', label: 'Seat 4', group: 'Vehicles' },
  { id: 'vehicleCamera', label: 'Vehicle camera', group: 'Vehicles' },
  { id: 'map', label: 'Full map', group: 'Interface' },
  { id: 'scoreboard', label: 'Scoreboard', group: 'Interface' },
  { id: 'pause', label: 'Pause', group: 'Interface' },
];

export type Bindings = Record<Action, string[]>;

export const DEFAULT_BINDINGS: Bindings = {
  moveForward: ['KeyW'],
  moveBack: ['KeyS'],
  moveLeft: ['KeyA'],
  moveRight: ['KeyD'],
  sprint: ['ShiftLeft'],
  crouch: ['ControlLeft'],
  prone: ['KeyZ'],
  jump: ['Space'],
  fire: ['Mouse0'],
  aim: ['Mouse2'],
  reload: ['KeyR'],
  weapon1: ['Digit1'],
  weapon2: ['Digit2'],
  weapon3: ['Digit3'],
  gadget: ['Digit4'],
  grenade: ['KeyG'],
  melee: ['KeyV'],
  fireMode: ['KeyX'],
  attachments: ['KeyT'],
  tablet: ['KeyB'],
  interact: ['KeyE'],
  ping: ['KeyQ'],
  seat1: ['F1'],
  seat2: ['F2'],
  seat3: ['F3'],
  seat4: ['F4'],
  vehicleCamera: ['KeyC'],
  map: ['KeyM'],
  scoreboard: ['Tab'],
  pause: ['Escape'],
  inspect: ['KeyI'],
};

export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const map: Record<string, string> = {
    Mouse0: 'LMB',
    Mouse1: 'MMB',
    Mouse2: 'RMB',
    Mouse3: 'M4',
    Mouse4: 'M5',
    ShiftLeft: 'L-Shift',
    ShiftRight: 'R-Shift',
    ControlLeft: 'L-Ctrl',
    ControlRight: 'R-Ctrl',
    AltLeft: 'L-Alt',
    AltRight: 'R-Alt',
    MetaLeft: 'L-Cmd',
    MetaRight: 'R-Cmd',
    Space: 'Space',
    Escape: 'Esc',
    Tab: 'Tab',
    Backquote: '`',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    WheelUp: 'Wheel up',
    WheelDown: 'Wheel down',
  };
  return map[code] ?? code;
}

export class Input {
  bindings: Bindings = structuredClone(DEFAULT_BINDINGS);
  private down = new Set<string>();
  private pressedCodes = new Set<string>();
  private releasedCodes = new Set<string>();
  private downSince = new Map<string, number>();
  private lastTap = new Map<string, number>();
  private doubleTapped = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  /** Gameplay input is ignored while menus are open. */
  gameplay = false;
  private capture: ((code: string) => void) | null = null;
  private keyListeners: ((code: string, e: KeyboardEvent | null) => void)[] = [];
  private lockListeners: ((locked: boolean) => void)[] = [];
  private canvas: HTMLElement | null = null;
  doubleTapWindow = 0.3;

  attach(canvas: HTMLElement): void {
    this.canvas = canvas;
    window.addEventListener('keydown', (e) => {
      if (e.repeat) {
        if (this.gameplay && (e.code === 'Tab' || e.code === 'Space')) e.preventDefault();
        return;
      }
      if (this.capture) {
        e.preventDefault();
        const cb = this.capture;
        this.capture = null;
        cb(e.code);
        return;
      }
      if (this.gameplay && (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('F') || e.code === 'AltLeft')) e.preventDefault();
      this.press(e.code);
      for (const l of this.keyListeners) l(e.code, e);
    });
    window.addEventListener('keyup', (e) => this.release(e.code));
    window.addEventListener('mousedown', (e) => {
      const code = `Mouse${e.button}`;
      if (this.capture) {
        e.preventDefault();
        const cb = this.capture;
        this.capture = null;
        cb(code);
        return;
      }
      this.press(code);
      for (const l of this.keyListeners) l(code, null);
    });
    window.addEventListener('mouseup', (e) => this.release(`Mouse${e.button}`));
    window.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === this.canvas) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      }
    });
    window.addEventListener('wheel', (e) => {
      this.wheel += Math.sign(e.deltaY);
      const code = e.deltaY < 0 ? 'WheelUp' : 'WheelDown';
      if (this.capture) {
        const cb = this.capture;
        this.capture = null;
        cb(code);
        return;
      }
      this.pressedCodes.add(code);
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === this.canvas;
      if (!locked) this.releaseAll();
      for (const l of this.lockListeners) l(locked);
    });
  }

  private press(code: string): void {
    if (this.down.has(code)) return;
    const now = performance.now() / 1000;
    this.down.add(code);
    this.pressedCodes.add(code);
    this.downSince.set(code, now);
    const lt = this.lastTap.get(code) ?? -1;
    if (now - lt < this.doubleTapWindow) this.doubleTapped.add(code);
    this.lastTap.set(code, now);
  }

  private release(code: string): void {
    if (!this.down.has(code)) return;
    this.down.delete(code);
    this.releasedCodes.add(code);
  }

  releaseAll(): void {
    for (const c of this.down) this.releasedCodes.add(c);
    this.down.clear();
  }

  isDown(a: Action): boolean {
    if (!this.gameplay) return false;
    for (const c of this.bindings[a]) if (this.down.has(c)) return true;
    return false;
  }

  pressed(a: Action): boolean {
    if (!this.gameplay) return false;
    for (const c of this.bindings[a]) if (this.pressedCodes.has(c)) return true;
    return false;
  }

  /** Pressed regardless of the gameplay gate (menus and overlays). */
  pressedAny(a: Action): boolean {
    for (const c of this.bindings[a]) if (this.pressedCodes.has(c)) return true;
    return false;
  }

  released(a: Action): boolean {
    for (const c of this.bindings[a]) if (this.releasedCodes.has(c)) return true;
    return false;
  }

  doubleTap(a: Action): boolean {
    if (!this.gameplay) return false;
    for (const c of this.bindings[a]) if (this.doubleTapped.has(c)) return true;
    return false;
  }

  /** Seconds the action has been held (0 when up). */
  heldFor(a: Action): number {
    const now = performance.now() / 1000;
    let best = 0;
    for (const c of this.bindings[a]) if (this.down.has(c)) best = Math.max(best, now - (this.downSince.get(c) ?? now));
    return best;
  }

  /** Clears per-frame edges and deltas (call once per rendered frame, after the sim consumed them). */
  endFrame(): void {
    this.pressedCodes.clear();
    this.releasedCodes.clear();
    this.doubleTapped.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }

  takeMouse(): [number, number] {
    const d: [number, number] = [this.mouseDX, this.mouseDY];
    this.mouseDX = 0;
    this.mouseDY = 0;
    return d;
  }

  captureNext(cb: (code: string) => void): void {
    this.capture = cb;
  }

  cancelCapture(): void {
    this.capture = null;
  }

  onKey(cb: (code: string, e: KeyboardEvent | null) => void): void {
    this.keyListeners.push(cb);
  }

  onLockChange(cb: (locked: boolean) => void): void {
    this.lockListeners.push(cb);
  }

  requestLock(): void {
    if (this.canvas && document.pointerLockElement !== this.canvas) {
      const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      if (p && typeof p.catch === 'function') p.catch(() => undefined);
    }
  }

  exitLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  get locked(): boolean {
    return !!this.canvas && document.pointerLockElement === this.canvas;
  }

  /** Which action (if any) a code is bound to, for conflict display. */
  actionFor(code: string): Action | null {
    for (const [a, codes] of Object.entries(this.bindings) as [Action, string[]][]) if (codes.includes(code)) return a;
    return null;
  }
}

export const input = new Input();
