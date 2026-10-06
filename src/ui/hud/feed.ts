// Top-right kill feed and center-right score event stack.
import { h, setText, toggle } from '../dom';
import { TUNING } from '../../config/tuning';
import { WEAPON_BY_ID, type WeaponId } from '../../config/content';
import type { Soldier } from '../../player/soldier';

interface FeedRow {
  el: HTMLDivElement;
  t: number;
}

export class KillFeed {
  readonly el: HTMLDivElement;
  private rows: FeedRow[] = [];

  constructor(parent: HTMLElement) {
    this.el = h('div', { class: 'killfeed' });
    parent.appendChild(this.el);
  }

  private rel(s: Soldier | null, me: Soldier): string {
    if (!s) return 'neutral';
    if (s === me) return 'you';
    if (s.team !== me.team) return 'foe';
    return s.squadId === me.squadId && me.squadId >= 0 ? 'squad' : 'friend';
  }

  push(killer: Soldier | null, victim: Soldier, weapon: string, headshot: boolean, me: Soldier): void {
    const wname = WEAPON_BY_ID[weapon as WeaponId]?.name ?? weapon;
    const el = h(
      'div',
      { class: `kf-row${killer === me || victim === me ? ' mine' : ''}` },
      killer ? h('span', { class: `kf-name ${this.rel(killer, me)}`, text: killer.name }) : null,
      h('span', { class: 'kf-weapon label', text: wname }),
      headshot ? h('span', { class: 'kf-hs', html: '<svg viewBox="0 0 10 10" class="icon"><circle cx="5" cy="5" r="3.2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M5 0.5 V3 M5 7 V9.5 M0.5 5 H3 M7 5 H9.5" stroke="currentColor" stroke-width="1.2"/></svg>' }) : null,
      h('span', { class: `kf-name ${this.rel(victim, me)}`, text: victim.name }),
    );
    this.el.prepend(el);
    this.rows.unshift({ el, t: 0 });
    while (this.rows.length > TUNING.ui.killFeedMax) this.rows.pop()!.el.remove();
  }

  update(dt: number): void {
    const life = TUNING.ui.killFeedLife;
    for (let i = this.rows.length - 1; i >= 0; i--) {
      const r = this.rows[i];
      r.t += dt;
      if (r.t > life - 0.4) toggle(r.el, 'out', true);
      if (r.t > life) {
        r.el.remove();
        this.rows.splice(i, 1);
      }
    }
  }

  clear(): void {
    for (const r of this.rows) r.el.remove();
    this.rows.length = 0;
  }
}

interface ScoreRow {
  el: HTMLDivElement;
  amountEl: HTMLElement;
  reason: string;
  amount: number;
  t: number;
}

export class ScoreStack {
  readonly el: HTMLDivElement;
  private total: HTMLDivElement;
  private rows: ScoreRow[] = [];
  private sum = 0;
  private sumT = 0;

  constructor(parent: HTMLElement) {
    this.total = h('div', { class: 'ss-total num' });
    this.el = h('div', { class: 'score-stack' }, this.total);
    parent.appendChild(this.el);
  }

  push(amount: number, reason: string): void {
    // Same reason within the window merges into one line.
    const life = TUNING.ui.scoreEventLife;
    const same = this.rows.find((r) => r.reason === reason && r.t < life * 0.8);
    if (same) {
      same.amount += amount;
      same.t = 0;
      setText(same.amountEl, `+${same.amount}`);
      same.el.classList.remove('bump');
      void same.el.offsetWidth;
      same.el.classList.add('bump');
    } else {
      const amountEl = h('span', { class: 'num ss-amt', text: `+${amount}` });
      const el = h('div', { class: 'ss-row' }, amountEl, h('span', { class: 'label ss-reason', text: reason }));
      this.el.append(el);
      this.rows.push({ el, amountEl, reason, amount, t: 0 });
      while (this.rows.length > TUNING.ui.scoreEventMax) this.rows.shift()!.el.remove();
    }
    this.sum += amount;
    this.sumT = 0;
    setText(this.total, `+${this.sum}`);
    toggle(this.total, 'on', true);
  }

  update(dt: number): void {
    const life = TUNING.ui.scoreEventLife;
    for (let i = this.rows.length - 1; i >= 0; i--) {
      const r = this.rows[i];
      r.t += dt;
      if (r.t > life - 0.3) toggle(r.el, 'out', true);
      if (r.t > life) {
        r.el.remove();
        this.rows.splice(i, 1);
      }
    }
    this.sumT += dt;
    if (this.sumT > life * 1.4 && this.sum > 0) {
      this.sum = 0;
      toggle(this.total, 'on', false);
    }
  }

  clear(): void {
    for (const r of this.rows) r.el.remove();
    this.rows.length = 0;
    this.sum = 0;
    toggle(this.total, 'on', false);
  }
}
