// Center-screen indicators: directional damage arcs, live grenade warnings, the capture ring
// (progress, attackers vs defenders, state), the interaction prompt, and reload / ammo cues.
import * as THREE from 'three';
import { h, setText, setStyle, toggle } from '../dom';
import { TUNING } from '../../config/tuning';
import { yawOf, wrapAngle } from '../../core/math';
import type { HudWorld } from './types';
import type { ZoneState } from '../../modes/sector/logic';
import type { Arsenal } from '../../weapons/arsenal';
import type { Soldier } from '../../player/soldier';

interface Arc {
  el: HTMLDivElement;
  from: THREE.Vector3;
  t: number;
  strength: number;
}

export class DamageArcs {
  readonly el: HTMLDivElement;
  private arcs: Arc[] = [];

  constructor(parent: HTMLElement) {
    this.el = h('div', { class: 'dmg-arcs' });
    parent.appendChild(this.el);
  }

  push(from: THREE.Vector3, amount: number): void {
    // Merge with an arc from nearly the same place.
    const near = this.arcs.find((a) => a.from.distanceToSquared(from) < 4);
    if (near) {
      near.t = 0;
      near.strength = Math.min(1, near.strength + amount / 60);
      return;
    }
    const el = h('div', { class: 'dmg-arc' }, h('i'));
    this.el.append(el);
    this.arcs.push({ el, from: from.clone(), t: 0, strength: Math.min(1, 0.35 + amount / 60) });
    if (this.arcs.length > 6) this.arcs.shift()!.el.remove();
  }

  update(dt: number, me: Soldier): void {
    const life = TUNING.ui.damageArcLife;
    for (let i = this.arcs.length - 1; i >= 0; i--) {
      const a = this.arcs[i];
      a.t += dt;
      if (a.t > life) {
        a.el.remove();
        this.arcs.splice(i, 1);
        continue;
      }
      // Angle of the source relative to the view (0 = straight ahead, clockwise positive).
      const rel = wrapAngle(me.yaw - yawOf(a.from.x - me.pos.x, a.from.z - me.pos.z));
      setStyle(a.el, 'transform', `rotate(${((rel * 180) / Math.PI).toFixed(1)}deg)`);
      setStyle(a.el, 'opacity', ((1 - a.t / life) * a.strength).toFixed(2));
    }
  }

  clear(): void {
    for (const a of this.arcs) a.el.remove();
    this.arcs.length = 0;
  }
}

export class GrenadeWarnings {
  readonly el: HTMLDivElement;
  private pool: HTMLDivElement[] = [];

  constructor(parent: HTMLElement) {
    this.el = h('div', { class: 'gren-warn' });
    parent.appendChild(this.el);
  }

  update(w: HudWorld): void {
    const me = w.player;
    const range = TUNING.ui.grenadeIndicatorRange;
    let n = 0;
    if (me.active)
      for (const g of w.frags) {
        const d = g.pos.distanceTo(me.pos);
        if (d > range) continue;
        let el = this.pool[n];
        if (!el) {
          el = h('div', { class: 'gw' }, h('div', { class: 'gw-icon', html: '<svg viewBox="0 0 24 24" class="icon"><circle cx="12" cy="14" r="6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 8 V4 H16" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>' }), h('div', { class: 'gw-arrow' }), h('div', { class: 'gw-dist num' }));
          this.el.append(el);
          this.pool.push(el);
        }
        toggle(el, 'hidden', false);
        const rel = wrapAngle(me.yaw - yawOf(g.pos.x - me.pos.x, g.pos.z - me.pos.z));
        setStyle(el, 'transform', `rotate(${((rel * 180) / Math.PI).toFixed(1)}deg)`);
        setStyle(el.lastElementChild as HTMLElement, 'transform', `rotate(${((-rel * 180) / Math.PI).toFixed(1)}deg)`);
        setText(el.lastElementChild as HTMLElement, `${Math.round(d)}m`);
        toggle(el, 'close', d < 5);
        n++;
      }
    for (let i = n; i < this.pool.length; i++) toggle(this.pool[i], 'hidden', true);
  }
}

export class CaptureRing {
  readonly el: HTMLDivElement;
  private ring: SVGCircleElement;
  private letter: HTMLDivElement;
  private state: HTMLDivElement;
  private counts: HTMLDivElement;
  private zoneId = '';

  constructor(parent: HTMLElement) {
    this.letter = h('div', { class: 'cr-letter display' });
    this.state = h('div', { class: 'cr-state label' });
    this.counts = h('div', { class: 'cr-counts num' });
    const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgEl.setAttribute('viewBox', '0 0 64 64');
    svgEl.setAttribute('class', 'cr-svg');
    svgEl.innerHTML = '<circle cx="32" cy="32" r="27" class="cr-track"/><circle cx="32" cy="32" r="27" class="cr-prog" pathLength="100"/>';
    this.ring = svgEl.querySelector('.cr-prog') as SVGCircleElement;
    this.el = h('div', { class: 'capture-ring hidden' }, h('div', { class: 'cr-dial' }, svgEl, this.letter), this.state, this.counts);
    parent.appendChild(this.el);
  }

  update(w: HudWorld): void {
    const me = w.player;
    let z: ZoneState | null = null;
    if (me.active) for (const o of w.zones) if (Math.hypot(me.pos.x - o.x, me.pos.z - o.z) < o.radius) z = o;
    toggle(this.el, 'hidden', !z);
    if (!z) {
      this.zoneId = '';
      return;
    }
    if (z.id !== this.zoneId) {
      this.zoneId = z.id;
      setText(this.letter, z.id);
    }
    const team = me.team;
    const enemy = team === 0 ? 1 : 0;
    const mine = z.control * (team === 0 ? 1 : -1);
    let st: string;
    let cls: string;
    if (z.contested) [st, cls] = ['Contested', 'contested'];
    else if (z.capturing === team) [st, cls] = mine < 0 ? ['Neutralizing', 'friend'] : ['Capturing', 'friend'];
    else if (z.capturing === enemy) [st, cls] = ['Losing', 'foe'];
    else if (z.owner === team) [st, cls] = ['Secured', 'friend'];
    else if (z.owner === enemy) [st, cls] = ['Enemy sector', 'foe'];
    else [st, cls] = ['Neutral', 'neutral'];
    setText(this.state, st);
    this.el.className = `capture-ring ${cls}`;
    // Progress: how much of the zone this team controls (0..1), drawn as a ring.
    const k = Math.max(0, Math.min(1, Math.abs(z.control)));
    this.ring.style.strokeDasharray = `${(k * 100).toFixed(1)} 100`;
    this.ring.style.stroke = z.control === 0 ? 'var(--neutral)' : (z.control > 0 ? 0 : 1) === team ? 'var(--friend)' : 'var(--foe)';
    setText(this.counts, `${z.counts[team]} vs ${z.counts[enemy]}`);
  }
}

export class Prompt {
  readonly el: HTMLDivElement;
  private key: HTMLSpanElement;
  private text: HTMLSpanElement;
  private bar: HTMLElement;

  constructor(parent: HTMLElement) {
    this.key = h('span', { class: 'key' });
    this.text = h('span', { class: 'pr-text' });
    this.bar = h('i');
    this.el = h('div', { class: 'prompt hidden' }, this.key, this.text, h('div', { class: 'bar pr-hold' }, this.bar));
    parent.appendChild(this.el);
  }

  update(w: HudWorld): void {
    const p = w.prompt;
    toggle(this.el, 'hidden', !p || !w.player.active);
    if (!p) return;
    setText(this.key, p.key);
    setText(this.text, p.text);
    toggle(this.el, 'holding', p.hold !== null);
    setStyle(this.bar, 'width', `${((p.hold ?? 0) * 100).toFixed(0)}%`);
  }
}

export class AmmoCue {
  readonly el: HTMLDivElement;
  private bar: HTMLElement;
  private text: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.text = h('div', { class: 'ac-text label' });
    this.bar = h('i');
    this.el = h('div', { class: 'ammo-cue hidden' }, this.text, h('div', { class: 'bar ac-bar' }, this.bar));
    parent.appendChild(this.el);
  }

  update(me: Soldier, a: Arsenal): void {
    const w = a.current;
    let text = '';
    let cls = '';
    if (!me.active || me.inVehicle || w.usesHeat || w.stats.category === 'launcher') text = '';
    else if (w.reloading) {
      text = 'Reloading';
      cls = 'reloading';
      setStyle(this.bar, 'width', `${Math.min(100, (w.reloadT / Math.max(0.01, w.reloadDur)) * 100).toFixed(0)}%`);
    } else if (w.mag === 0 && w.reserve === 0) [text, cls] = ['No ammo', 'empty'];
    else if (w.mag <= Math.ceil(w.stats.mag * TUNING.ui.lowAmmoFraction) && w.reserve > 0) [text, cls] = ['Reload', 'low'];
    else if (w.reserve < w.stats.mag) [text, cls] = ['Low ammo', 'low'];
    toggle(this.el, 'hidden', !text);
    if (!text) return;
    setText(this.text, text);
    this.el.className = `ammo-cue ${cls}`;
  }
}
