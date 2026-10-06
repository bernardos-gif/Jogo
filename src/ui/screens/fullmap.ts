// Full tactical map (M): the holographic map with sectors, HQs, every friendly, spotted enemies,
// pings and hazards, plus a sector legend with owners.
import { h, toggle, clear } from '../dom';
import { TacticalMapView, type MapUnit } from '../tacmap';
import { ZONES } from '../../config/content';
import type { TacticalImage } from '../../render/tacticalMap';
import type { HudWorld } from '../hud/types';

export class FullMap {
  readonly el: HTMLDivElement;
  private view: TacticalMapView;
  private legend: HTMLDivElement;
  open = false;
  private t = 0;

  constructor(parent: HTMLElement, image: TacticalImage) {
    this.view = new TacticalMapView(image, 'fullmap-canvas');
    this.legend = h('div', { class: 'fm-legend' });
    this.el = h('div', { class: 'fullmap hidden' }, h('div', { class: 'fm-frame panel strong brackets grid-bg' }, this.view.canvas), h('div', { class: 'fm-side panel strong brackets' }, h('div', { class: 'display fm-title', text: 'Tactical map' }), this.legend));
    parent.appendChild(this.el);
  }

  toggle(): void {
    this.show(!this.open);
  }

  show(on: boolean): void {
    this.open = on;
    toggle(this.el, 'hidden', !on);
    if (on) this.view.refreshPalette();
    this.t = 0;
  }

  update(dt: number, w: HudWorld): void {
    if (!this.open) return;
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 1 / 20;
    const me = w.player;
    const units: MapUnit[] = [];
    for (const s of w.soldiers) {
      if (!s.alive) continue;
      if (s === me) units.push({ x: s.pos.x, z: s.pos.z, yaw: s.yaw, kind: 'player' });
      else if (s.team === me.team) units.push({ x: s.pos.x, z: s.pos.z, yaw: s.yaw, kind: s.squadId === me.squadId ? 'squad' : 'friend' });
      else if (s.spottedUntil > w.time && s.spottedByTeam === me.team) units.push({ x: s.pos.x, z: s.pos.z, yaw: s.yaw, kind: 'enemy' });
    }
    this.view.draw({ team: me.team, zones: w.zones, hqs: w.hqs, limit: w.limit, spawns: [], selected: null, units, time: w.time, hazards: w.hazards });
    clear(this.legend);
    for (const z of w.zones) {
      const rel = z.owner === -1 ? 'neutral' : z.owner === me.team ? 'friend' : 'foe';
      this.legend.append(h('div', { class: `fm-zone ${rel}${z.contested ? ' contested' : ''}` }, h('span', { class: 'display fm-letter', text: z.id }), h('div', null, h('div', { text: ZONES[z.id].name }), h('div', { class: 'label', text: z.contested ? 'Contested' : rel === 'friend' ? 'Held' : rel === 'foe' ? 'Enemy' : 'Neutral' }))));
    }
    for (const hz of w.hazards) this.legend.append(h('div', { class: 'fm-hazard label', text: hz.label }));
  }
}
