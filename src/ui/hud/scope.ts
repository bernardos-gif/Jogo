// Scoped overlays per sight: masked circular view with a sight-specific reticle (4x drop marks,
// 8x mil-dots, 6x thermal box with amber tint), plus range and zoom readouts.
import { h, setText, setStyle, toggle } from '../dom';
import type { SightId } from '../../config/content';

const RETICLES: Partial<Record<SightId, string>> = {
  optic4: `<line x1="-100" y1="0" x2="-6" y2="0"/><line x1="6" y1="0" x2="100" y2="0"/><line x1="0" y1="-100" x2="0" y2="-6"/><line x1="0" y1="6" x2="0" y2="100"/>
    <line x1="-8" y1="18" x2="8" y2="18"/><line x1="-6" y1="34" x2="6" y2="34"/><line x1="-4" y1="50" x2="4" y2="50"/><circle cx="0" cy="0" r="1.6" class="fill"/>`,
  optic8: `<line x1="-100" y1="0" x2="100" y2="0"/><line x1="0" y1="-100" x2="0" y2="100"/>
    ${[-40, -30, -20, -10, 10, 20, 30, 40].map((x) => `<circle cx="${x}" cy="0" r="1.4" class="fill"/><circle cx="0" cy="${x}" r="1.4" class="fill"/>`).join('')}`,
  thermal6: `<rect x="-14" y="-14" width="28" height="28"/><line x1="-100" y1="0" x2="-14" y2="0"/><line x1="14" y1="0" x2="100" y2="0"/><line x1="0" y1="14" x2="0" y2="100"/><circle cx="0" cy="0" r="1.6" class="fill"/>`,
};

export class ScopeOverlay {
  readonly el: HTMLDivElement;
  private svg: HTMLDivElement;
  private range = h('div', { class: 'scope-range num' });
  private zoom = h('div', { class: 'scope-zoom num' });
  private sight: SightId | null = null;

  constructor(parent: HTMLElement) {
    this.svg = h('div', { class: 'scope-reticle' });
    this.el = h('div', { class: 'scope hidden' }, h('div', { class: 'scope-mask' }), this.svg, h('div', { class: 'scope-info' }, this.zoom, this.range));
    parent.appendChild(this.el);
  }

  update(visible: boolean, sight: SightId, zoom: number, rangeM: number | null, sway: number): void {
    toggle(this.el, 'hidden', !visible);
    if (!visible) return;
    if (sight !== this.sight) {
      this.sight = sight;
      this.svg.innerHTML = `<svg viewBox="-100 -100 200 200">${RETICLES[sight] ?? RETICLES.optic4}</svg>`;
      toggle(this.el, 'thermal', sight === 'thermal6');
    }
    setText(this.zoom, `${zoom.toFixed(zoom % 1 ? 2 : 0)}x`);
    setText(this.range, rangeM === null ? '----m' : `${Math.round(rangeM).toString().padStart(4, '0')}m`);
    setStyle(this.svg, 'transform', `translate(-50%, -50%) translate(${(Math.sin(sway * 1.3) * 3).toFixed(1)}px, ${(Math.sin(sway * 0.9) * 2).toFixed(1)}px)`);
  }
}
