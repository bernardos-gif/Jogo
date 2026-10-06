// Boot splash: logo, loading steps and a progress bar while the world is generated.
import { h, setText } from '../dom';

export class BootSplash {
  readonly el: HTMLDivElement;
  private bar: HTMLElement;
  private step: HTMLElement;
  private pct: HTMLElement;

  constructor(parent: HTMLElement) {
    this.bar = h('i');
    this.step = h('div', { class: 'splash-step label', text: 'Initializing' });
    this.pct = h('div', { class: 'splash-pct num', text: '0%' });
    this.el = h(
      'div',
      { class: 'screen splash grid-bg' },
      h(
        'div',
        { class: 'splash-center' },
        h('div', { class: 'splash-mark', html: chevronSvg() }),
        h('div', { class: 'splash-title display', text: 'Vector Front' }),
        h('div', { class: 'splash-sub label', text: 'Breakwater Launch Port // Sector Control' }),
        h('div', { class: 'splash-load' }, h('div', { class: 'bar seg' }, this.bar), h('div', { class: 'splash-row' }, this.step, this.pct)),
      ),
      h('div', { class: 'splash-foot label', text: 'All models, effects and sound generated in code' }),
    );
    parent.appendChild(this.el);
  }

  progress(fraction: number, label: string): void {
    const p = Math.max(0, Math.min(1, fraction));
    this.bar.style.width = `${(p * 100).toFixed(1)}%`;
    setText(this.step, label);
    setText(this.pct, `${Math.round(p * 100)}%`);
  }

  async hide(): Promise<void> {
    this.el.classList.add('out');
    await new Promise((r) => setTimeout(r, 380));
    this.el.remove();
  }
}

export function chevronSvg(): string {
  return `<svg viewBox="0 0 64 64" class="mark"><path d="M14 12 L40 32 L14 52" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="square"/><path d="M50 24 V40" stroke="var(--amber)" stroke-width="4"/></svg>`;
}
