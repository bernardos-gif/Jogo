// World-space markers projected onto the screen: objectives (letter, owner, distance; clamped to
// the screen edge when off-screen), squad and teammate nameplates, downed teammates to revive,
// spotted enemies and pings. Elements are pooled and positioned with transforms.
import * as THREE from 'three';
import { h, setText, setStyle, toggle } from '../dom';
import { TUNING } from '../../config/tuning';
import { PING_LABELS } from '../../net-sim/pings';
import type { HudWorld } from './types';

const _v = new THREE.Vector3();

class Pool {
  private items: HTMLDivElement[] = [];
  private used = 0;
  constructor(
    private parent: HTMLElement,
    private make: () => HTMLDivElement,
  ) {}
  begin(): void {
    this.used = 0;
  }
  next(): HTMLDivElement {
    let el = this.items[this.used];
    if (!el) {
      el = this.make();
      this.parent.append(el);
      this.items.push(el);
    }
    this.used++;
    if (el.style.display === 'none') el.style.display = '';
    return el;
  }
  end(): void {
    for (let i = this.used; i < this.items.length; i++) if (this.items[i].style.display !== 'none') this.items[i].style.display = 'none';
  }
}

export class WorldMarkers {
  readonly el: HTMLDivElement;
  private objectives: Pool;
  private plates: Pool;
  private spots: Pool;
  private pings: Pool;
  private t = 0;

  constructor(parent: HTMLElement) {
    this.el = h('div', { class: 'markers' });
    parent.appendChild(this.el);
    this.objectives = new Pool(this.el, () => h('div', { class: 'mk-obj' }, h('div', { class: 'mk-obj-box display' }), h('div', { class: 'mk-dist num' })));
    this.plates = new Pool(this.el, () => h('div', { class: 'mk-plate' }, h('div', { class: 'mk-name' }), h('div', { class: 'bar mk-hp' }, h('i'))));
    this.spots = new Pool(this.el, () => h('div', { class: 'mk-spot' }));
    this.pings = new Pool(this.el, () => h('div', { class: 'mk-ping' }, h('div', { class: 'mk-ping-icon' }), h('div', { class: 'mk-ping-label label' }), h('div', { class: 'mk-dist num' })));
  }

  /** Projects to CSS pixels. Returns [x, y, onScreen, inFront]. */
  private project(cam: THREE.PerspectiveCamera, p: THREE.Vector3, W: number, H: number): [number, number, boolean, boolean] {
    _v.copy(p).project(cam);
    const inFront = _v.z < 1;
    let x = (_v.x * 0.5 + 0.5) * W;
    let y = (-_v.y * 0.5 + 0.5) * H;
    if (!inFront) {
      x = W - x;
      y = H - y;
    }
    const on = inFront && x >= 0 && x <= W && y >= 0 && y <= H;
    return [x, y, on, inFront];
  }

  update(dt: number, w: HudWorld): void {
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 1 / TUNING.ui.hudRate;
    const cam = w.camera;
    const W = window.innerWidth, H = window.innerHeight;
    const me = w.player;
    const team = me.team;
    const margin = 40;
    const clampEdge = (x: number, y: number): [number, number] => {
      // Push off-screen markers to the screen border along the direction from the center.
      const cx = W / 2, cy = H / 2;
      const dx = x - cx, dy = y - cy;
      const k = Math.min((W / 2 - margin) / Math.max(1e-3, Math.abs(dx)), (H / 2 - margin) / Math.max(1e-3, Math.abs(dy)));
      return k < 1 ? [cx + dx * k, cy + dy * k] : [x, y];
    };

    // Objectives.
    this.objectives.begin();
    if (me.alive)
      for (const z of w.zones) {
        const pr = this.project(cam, _v.set(z.x, z.y + 6, z.z), W, H);
        const on = pr[2];
        const [x, y] = on ? pr : clampEdge(pr[0], pr[1]);
        const el = this.objectives.next();
        const d = Math.hypot(z.x - me.pos.x, z.z - me.pos.z);
        const inside = d < z.radius;
        const rel = z.owner === -1 ? 'neutral' : z.owner === team ? 'friend' : 'foe';
        el.className = `mk-obj ${rel}${z.contested ? ' contested' : ''}${on ? '' : ' edge'}`;
        setText(el.firstElementChild as HTMLElement, z.id);
        setText(el.lastElementChild as HTMLElement, inside || !on ? '' : `${Math.round(d)}m`);
        setStyle(el, 'transform', `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`);
        setStyle(el, 'opacity', inside ? String(TUNING.ui.objectiveFadeInside) : '1');
      }
    this.objectives.end();

    // Nameplates (teammates), downed teammates and spotted enemies.
    this.plates.begin();
    this.spots.begin();
    const U = TUNING.ui;
    for (const s of w.soldiers) {
      if (!s.alive || s === me || s.inVehicle) continue;
      const d = s.pos.distanceTo(me.pos);
      if (s.team === team) {
        const squad = s.squadId === me.squadId && me.squadId >= 0;
        const downed = s.downed;
        const range = downed ? U.downedMarkerRange : squad ? U.squadNameplateRange : U.nameplateRange;
        if (d > range) continue;
        const [x, y, on] = this.project(cam, _v.set(s.pos.x, s.pos.y + (downed ? 0.9 : 2.15), s.pos.z), W, H);
        if (!on) continue;
        const el = this.plates.next();
        el.className = `mk-plate ${downed ? 'downed' : squad ? 'squad' : 'friend'}${d > 35 && !downed ? ' far' : ''}`;
        setText(el.firstElementChild as HTMLElement, downed ? `${s.name} · ${Math.round(d)}m` : s.name);
        setStyle((el.lastElementChild as HTMLElement).firstElementChild as HTMLElement, 'width', `${Math.round(s.health)}%`);
        setStyle(el, 'transform', `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`);
      } else if (s.spottedUntil > w.time && s.spottedByTeam === team && d < U.spottedMarkerRange) {
        const [x, y, on] = this.project(cam, _v.set(s.pos.x, s.pos.y + 2.2, s.pos.z), W, H);
        if (!on) continue;
        const el = this.spots.next();
        setStyle(el, 'transform', `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`);
      }
    }
    this.plates.end();
    this.spots.end();

    // Pings.
    this.pings.begin();
    for (const p of w.pings) {
      if (p.team !== team) continue;
      const pr = this.project(cam, p.pos, W, H);
      const on = pr[2];
      const [x, y] = on ? pr : clampEdge(pr[0], pr[1]);
      const el = this.pings.next();
      el.className = `mk-ping ${p.kind}${on ? '' : ' edge'}${p.owner.isPlayer ? ' mine' : ''}`;
      setText(el.children[1] as HTMLElement, PING_LABELS[p.kind]);
      setText(el.children[2] as HTMLElement, `${Math.round(p.pos.distanceTo(me.pos))}m`);
      setStyle(el, 'transform', `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`);
      toggle(el, 'fading', p.t > p.life - 1);
    }
    this.pings.end();
  }
}
