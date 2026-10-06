// Comms rose (hold Q): a radial of callouts picked with the captured mouse; releasing Q sends the
// highlighted one. A quick tap of Q pings whatever is under the crosshair instead.
import { h, setStyle, toggle } from '../dom';
import type { PingKind } from '../../net-sim/pings';

export interface CommsOption {
  kind: PingKind;
  label: string;
  /** Callouts that mark the crosshair point (true) or the caller (false). */
  atAim: boolean;
}

export const COMMS_OPTIONS: CommsOption[] = [
  { kind: 'attack', label: 'Attack here', atAim: true },
  { kind: 'enemy', label: 'Enemy spotted', atAim: true },
  { kind: 'defend', label: 'Defend here', atAim: true },
  { kind: 'vehicle', label: 'Vehicle', atAim: true },
  { kind: 'ammo', label: 'Need ammo', atAim: false },
  { kind: 'medic', label: 'Need medic', atAim: false },
  { kind: 'location', label: 'Go here', atAim: true },
];

export class CommsRose {
  readonly el: HTMLDivElement;
  private items: HTMLDivElement[] = [];
  private cursor: HTMLDivElement;
  private cx = 0;
  private cy = 0;
  open = false;
  hovered = -1;

  constructor(parent: HTMLElement) {
    this.cursor = h('div', { class: 'cr-cursor' });
    this.el = h('div', { class: 'comms-rose hidden' }, h('div', { class: 'cr-center label', text: 'Comms' }), this.cursor);
    COMMS_OPTIONS.forEach((o, i) => {
      const a = (i / COMMS_OPTIONS.length) * Math.PI * 2 - Math.PI / 2;
      const el = h('div', { class: `cr-item ${o.kind}`, style: `left:${(50 + Math.cos(a) * 38).toFixed(1)}%;top:${(50 + Math.sin(a) * 38).toFixed(1)}%` }, h('span', { class: 'cr-dot' }), h('span', { class: 'label', text: o.label }));
      this.el.append(el);
      this.items.push(el);
    });
    parent.appendChild(this.el);
  }

  show(): void {
    this.open = true;
    this.cx = 0;
    this.cy = 0;
    this.hovered = -1;
    toggle(this.el, 'hidden', false);
  }

  /** Moves the virtual cursor and returns the hovered option index. */
  update(dx: number, dy: number): number {
    this.cx = Math.max(-140, Math.min(140, this.cx + dx));
    this.cy = Math.max(-140, Math.min(140, this.cy + dy));
    setStyle(this.cursor, 'transform', `translate(${this.cx.toFixed(0)}px, ${this.cy.toFixed(0)}px)`);
    const d = Math.hypot(this.cx, this.cy);
    this.hovered = -1;
    if (d > 30) {
      let a = Math.atan2(this.cy, this.cx) + Math.PI / 2;
      if (a < 0) a += Math.PI * 2;
      this.hovered = Math.round((a / (Math.PI * 2)) * COMMS_OPTIONS.length) % COMMS_OPTIONS.length;
    }
    this.items.forEach((el, i) => toggle(el, 'hover', i === this.hovered));
    return this.hovered;
  }

  hide(): CommsOption | null {
    this.open = false;
    toggle(this.el, 'hidden', true);
    return this.hovered >= 0 ? COMMS_OPTIONS[this.hovered] : null;
  }
}
