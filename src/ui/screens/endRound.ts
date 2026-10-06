// End of round: winner and final tickets, MVP cards, personal stats with tick-up numbers, XP gained
// and level progress, and the continue button.
import { h, setText, setStyle, toggle, clear, fmtTime, fmtInt } from '../dom';
import { ICONS } from '../icons';
import { TUNING } from '../../config/tuning';

export interface EndRoundData {
  won: boolean;
  title: string;
  sub: string;
  /** Friendly then enemy. */
  tickets: [number, number];
  teamNames: [string, string];
  duration: number;
  mvps: { title: string; name: string; value: string; friendly: boolean }[];
  personal: { label: string; value: number }[];
  xp: { gained: number; levelBefore: number; levelAfter: number; into: number; need: number; lines: { label: string; value: number }[] };
}

function reducedMotion(): boolean {
  const m = document.documentElement.dataset.motion;
  if (m === 'reduced') return true;
  if (m === 'full') return false;
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/** Counts a number element up from 0 (instant with reduced motion). */
export function tickUp(el: HTMLElement, to: number, seconds = TUNING.ui.tickUp, fmt: (n: number) => string = fmtInt): void {
  if (reducedMotion() || seconds <= 0) {
    setText(el, fmt(to));
    return;
  }
  const t0 = performance.now();
  const step = () => {
    const k = Math.min(1, (performance.now() - t0) / (seconds * 1000));
    const e = 1 - Math.pow(1 - k, 3);
    setText(el, fmt(to * e));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export class EndRoundScreen {
  readonly el: HTMLDivElement;
  private title: HTMLDivElement;
  private sub: HTMLDivElement;
  private tickets: HTMLDivElement;
  private mvps: HTMLDivElement;
  private personal: HTMLDivElement;
  private xp: HTMLDivElement;
  private xpBar: HTMLElement;
  private xpLevel: HTMLDivElement;
  private btn: HTMLButtonElement;
  private auto: HTMLDivElement;
  open = false;
  onContinue: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    this.title = h('div', { class: 'er-title display' });
    this.sub = h('div', { class: 'er-sub label' });
    this.tickets = h('div', { class: 'er-tickets' });
    this.mvps = h('div', { class: 'er-mvps' });
    this.personal = h('div', { class: 'er-personal' });
    this.xpBar = h('i');
    this.xpLevel = h('div', { class: 'er-level display' });
    this.xp = h('div', { class: 'er-xp-lines' });
    this.btn = h('button', { class: 'btn primary', text: 'Next round', on: { click: () => this.onContinue?.() } });
    this.auto = h('div', { class: 'label er-auto' });
    this.el = h(
      'div',
      { class: 'screen end-round hidden' },
      h('div', { class: 'er-head' }, this.title, this.sub, this.tickets),
      h(
        'div',
        { class: 'er-body' },
        h('div', { class: 'er-col panel strong brackets scan-in' }, h('div', { class: 'label', text: 'Most valuable' }), this.mvps),
        h('div', { class: 'er-col panel strong brackets scan-in' }, h('div', { class: 'label', text: 'Your round' }), this.personal),
        h('div', { class: 'er-col panel strong brackets scan-in' }, h('div', { class: 'label', text: 'Experience' }), this.xpLevel, h('div', { class: 'bar seg er-xpbar' }, this.xpBar), this.xp),
      ),
      h('div', { class: 'er-foot' }, this.auto, this.btn),
    );
    parent.appendChild(this.el);
  }

  show(d: EndRoundData): void {
    this.open = true;
    toggle(this.el, 'hidden', false);
    toggle(this.el, 'won', d.won);
    toggle(this.el, 'lost', !d.won);
    setText(this.title, d.title);
    setText(this.sub, `${d.sub} · ${fmtTime(d.duration)}`);
    clear(this.tickets);
    for (const [i, cls] of [
      [0, 'friend'],
      [1, 'foe'],
    ] as [number, string][]) {
      const n = h('span', { class: 'num' });
      this.tickets.append(h('div', { class: `er-t ${cls}` }, h('span', { class: 'label', text: d.teamNames[i] }), n));
      tickUp(n, d.tickets[i]);
    }
    clear(this.mvps);
    for (const m of d.mvps)
      this.mvps.append(
        h('div', { class: `er-mvp ${m.friendly ? 'friend' : 'foe'}` }, h('span', { class: 'er-star', html: ICONS.star }), h('div', null, h('div', { class: 'label', text: m.title }), h('div', { class: 'er-mvp-name display', text: m.name })), h('div', { class: 'num er-mvp-val', text: m.value })),
      );
    clear(this.personal);
    for (const p of d.personal) {
      const n = h('span', { class: 'num' });
      this.personal.append(h('div', { class: 'er-stat' }, h('span', { class: 'label', text: p.label }), n));
      tickUp(n, p.value);
    }
    clear(this.xp);
    for (const l of d.xp.lines) {
      const n = h('span', { class: 'num' });
      this.xp.append(h('div', { class: 'er-stat' }, h('span', { class: 'label', text: l.label }), n));
      tickUp(n, l.value, TUNING.ui.tickUp * 1.5, (v) => `+${fmtInt(v)}`);
    }
    setText(this.xpLevel, d.xp.levelAfter > d.xp.levelBefore ? `Level ${d.xp.levelAfter} · promoted` : `Level ${d.xp.levelAfter}`);
    setStyle(this.xpBar, 'width', `${d.xp.need > 0 ? ((d.xp.into / d.xp.need) * 100).toFixed(1) : 100}%`);
    for (const p of this.el.querySelectorAll('.scan-in')) {
      p.classList.remove('scan-in');
      void (p as HTMLElement).offsetWidth;
      p.classList.add('scan-in');
    }
  }

  setAuto(seconds: number | null): void {
    setText(this.auto, seconds === null ? '' : `Next round in ${Math.ceil(seconds)} s`);
  }

  hide(): void {
    this.open = false;
    toggle(this.el, 'hidden', true);
  }
}
