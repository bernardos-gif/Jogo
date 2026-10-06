// In-match HUD root. Hosts the components and routes gameplay events (hits, kills) to them.
import { h, setText } from '../dom';
import { Crosshair } from './crosshair';
import { WeaponPanel, type GadgetView } from './weaponPanel';
import { AttachmentMenu } from './attachmentMenu';
import { ScopeOverlay } from './scope';
import type { Arsenal } from '../../weapons/arsenal';
import type { Soldier } from '../../player/soldier';
import type { EventBus } from '../../core/events';

export interface HudFrame {
  dt: number;
  player: Soldier;
  arsenal: Arsenal;
  spread: number;
  vfov: number;
  screenH: number;
  scoped: boolean;
  zoom: number;
  rangeM: number | null;
  enemyUnderCrosshair: boolean;
  gadget: GadgetView | null;
  time: number;
}

export class Hud {
  readonly root: HTMLDivElement;
  readonly crosshair: Crosshair;
  readonly weapon: WeaponPanel;
  readonly attachments: AttachmentMenu;
  readonly scope: ScopeOverlay;
  private readout: HTMLDivElement | null = null;
  private readoutRows = new Map<string, HTMLElement>();
  private unsub: (() => void)[] = [];

  constructor(parent: HTMLElement, events: EventBus, private player: () => Soldier) {
    this.root = h('div', { class: 'hud' });
    parent.appendChild(this.root);
    this.scope = new ScopeOverlay(this.root);
    this.crosshair = new Crosshair(this.root);
    this.weapon = new WeaponPanel(this.root);
    this.attachments = new AttachmentMenu(this.root);
    this.unsub.push(
      events.on('hit', (e) => {
        if (e.attacker !== this.player()) return;
        this.crosshair.hit(e.kill || e.downed ? 'kill' : e.part === 'head' ? 'head' : e.armorBreak ? 'armor' : 'hit');
      }),
    );
  }

  /** Optional key/value readout panel (training range). */
  setReadout(title: string, rows: string[]): void {
    if (!this.readout) {
      this.readout = h('div', { class: 'range-readout panel brackets scan-in' });
      this.root.appendChild(this.readout);
    }
    this.readout.textContent = '';
    this.readout.append(h('div', { class: 'display', text: title }));
    this.readoutRows.clear();
    for (const r of rows) {
      const v = h('div', { class: 'num', text: '-' });
      this.readout.append(h('div', { class: 'label', text: r }), v);
      this.readoutRows.set(r, v);
    }
  }

  setReadoutValue(row: string, value: string): void {
    const el = this.readoutRows.get(row);
    if (el) setText(el, value);
  }

  update(f: HudFrame): void {
    const p = f.player;
    const visible = p.alive;
    this.root.classList.toggle('hidden', !visible);
    if (!visible) return;
    const w = f.arsenal.current;
    this.scope.update(f.scoped, w.att.sight, f.zoom, f.rangeM, f.time);
    this.crosshair.update(f.dt, f.spread, f.vfov, f.screenH, w.stats.category, f.arsenal.adsK, !f.scoped && !this.attachments.open && p.active, f.enemyUnderCrosshair);
    this.weapon.update(p, f.arsenal, f.gadget);
  }

  dispose(): void {
    for (const u of this.unsub) u();
    this.root.remove();
  }
}
