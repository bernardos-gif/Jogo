// Dynamic crosshair (gap follows the real spread cone) and hit markers with distinct variants:
// hit, headshot, armor break and kill.
import { h, setStyle, toggle } from '../dom';
import { TUNING } from '../../config/tuning';
import type { WeaponCategory } from '../../config/content';

export type HitKind = 'hit' | 'head' | 'armor' | 'kill';

export class Crosshair {
  readonly el: HTMLDivElement;
  private lines: HTMLDivElement[];
  private dot: HTMLDivElement;
  private ring: HTMLDivElement;
  private marker: HTMLDivElement;
  private markerT = -1;
  private markerKind: HitKind = 'hit';

  constructor(parent: HTMLElement) {
    this.lines = [0, 1, 2, 3].map((i) => h('div', { class: `xh-line xh-${['t', 'r', 'b', 'l'][i]}` }));
    this.dot = h('div', { class: 'xh-dot' });
    this.ring = h('div', { class: 'xh-ring' });
    this.marker = h('div', { class: 'hitmarker' }, ...[0, 1, 2, 3].map((i) => h('i', { class: `hm-${i}` })));
    this.el = h('div', { class: 'crosshair' }, ...this.lines, this.dot, this.ring, this.marker);
    parent.appendChild(this.el);
  }

  /**
   * @param spreadDeg current spread cone half-angle
   * @param vfovDeg camera vertical FOV
   */
  update(dt: number, spreadDeg: number, vfovDeg: number, screenH: number, cat: WeaponCategory | null, adsK: number, visible: boolean, enemyUnder: boolean): void {
    toggle(this.el, 'hidden', !visible);
    const px = (Math.tan((spreadDeg * Math.PI) / 180) / Math.tan((vfovDeg * Math.PI) / 360)) * (screenH / 2);
    const gap = Math.max(4, Math.min(120, px));
    const fade = 1 - adsK;
    const shotgun = cat === 'shotgun';
    const sniper = cat === 'sniper' || cat === 'launcher';
    for (const [i, l] of this.lines.entries()) {
      const tx = i === 1 ? gap : i === 3 ? -gap : 0;
      const ty = i === 0 ? -gap : i === 2 ? gap : 0;
      setStyle(l, 'transform', `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px)`);
      setStyle(l, 'opacity', String(shotgun || sniper ? 0 : fade));
    }
    setStyle(this.ring, 'opacity', String(shotgun ? fade : 0));
    setStyle(this.ring, 'width', `${(gap * 2).toFixed(0)}px`);
    setStyle(this.ring, 'height', `${(gap * 2).toFixed(0)}px`);
    setStyle(this.dot, 'opacity', String(sniper && adsK < 0.5 ? 0.9 : fade * 0.9));
    toggle(this.el, 'enemy', enemyUnder);
    // Hit marker animation.
    if (this.markerT >= 0) {
      this.markerT += dt;
      const U = TUNING.ui;
      const total = U.hitMarkerIn + U.hitMarkerHold + U.hitMarkerOut;
      const t = this.markerT;
      const a = t < U.hitMarkerIn ? t / U.hitMarkerIn : t < U.hitMarkerIn + U.hitMarkerHold ? 1 : Math.max(0, 1 - (t - U.hitMarkerIn - U.hitMarkerHold) / U.hitMarkerOut);
      const s = this.markerKind === 'kill' ? 1.25 : 1;
      setStyle(this.marker, 'opacity', a.toFixed(2));
      setStyle(this.marker, 'transform', `translate(-50%, -50%) scale(${(s * (1.25 - 0.25 * Math.min(1, t / U.hitMarkerIn))).toFixed(2)}) rotate(45deg)`);
      if (t > total) {
        this.markerT = -1;
        setStyle(this.marker, 'opacity', '0');
      }
    }
  }

  hit(kind: HitKind): void {
    // Kill and head markers override lesser ones mid-animation.
    const rank: Record<HitKind, number> = { hit: 0, armor: 1, head: 2, kill: 3 };
    if (this.markerT >= 0 && rank[kind] < rank[this.markerKind] && this.markerT < 0.15) return;
    this.markerKind = kind;
    this.markerT = 0;
    this.marker.className = `hitmarker ${kind}`;
  }
}
