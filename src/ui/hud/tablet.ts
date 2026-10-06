// Call-in tablet (hold B): a wrist hologram listing the vehicle airdrops with the team cooldowns.
// Move the mouse to highlight a card (or press its number) and click or release B to request it
// at the crosshair point.
import { h, setText, setStyle, toggle, fmtTime } from '../dom';
import { VEHICLES } from '../../config/content';
import { TUNING } from '../../config/tuning';
import { CALL_IN_KINDS, type CallInKind } from '../../gadgets/callins';

export class Tablet {
  readonly el: HTMLDivElement;
  private cards: { kind: CallInKind; el: HTMLDivElement; cd: HTMLElement; bar: HTMLElement }[] = [];
  private status: HTMLDivElement;
  private cx = 0;
  open = false;
  hovered = -1;

  constructor(parent: HTMLElement) {
    this.status = h('div', { class: 'label tb-status' });
    const list = h('div', { class: 'tab-cards' });
    CALL_IN_KINDS.forEach((k, i) => {
      const cd = h('div', { class: 'num tab-cd' });
      const bar = h('i');
      const el = h('div', { class: 'tab-card' }, h('div', { class: 'tab-key key', text: String(i + 1) }), h('div', { class: 'display tab-name', text: VEHICLES[k].name }), h('div', { class: 'label', text: VEHICLES[k].role }), h('div', { class: 'bar tab-bar' }, bar), cd);
      list.append(el);
      this.cards.push({ kind: k, el, cd, bar });
    });
    this.el = h('div', { class: 'tablet hidden' }, h('div', { class: 'tab-head' }, h('span', { class: 'display', text: 'Call-in' }), this.status), list, h('div', { class: 'label tab-hint', text: 'Aim at the drop point · click or release to request' }));
    parent.appendChild(this.el);
  }

  show(): void {
    this.open = true;
    this.cx = 0;
    this.hovered = -1;
    toggle(this.el, 'hidden', false);
  }

  hide(): CallInKind | null {
    this.open = false;
    toggle(this.el, 'hidden', true);
    return this.hovered >= 0 ? CALL_IN_KINDS[this.hovered] : null;
  }

  /** Mouse delta moves the highlight across the cards; returns the hovered kind. */
  update(dx: number, key: number, cooldowns: Record<CallInKind, number>, inRange: boolean): CallInKind | null {
    this.cx = Math.max(-120, Math.min(120, this.cx + dx));
    if (key >= 0 && key < CALL_IN_KINDS.length) {
      this.hovered = key;
      this.cx = key === 0 ? -60 : 60;
    } else if (Math.abs(this.cx) > 20) this.hovered = this.cx < 0 ? 0 : 1;
    this.cards.forEach((c, i) => {
      const cd = cooldowns[c.kind];
      const total = TUNING.callins.cooldowns[c.kind];
      toggle(c.el, 'hover', i === this.hovered);
      toggle(c.el, 'cooling', cd > 0);
      setText(c.cd, cd > 0 ? fmtTime(cd) : 'Ready');
      setStyle(c.bar, 'width', `${((1 - cd / total) * 100).toFixed(0)}%`);
    });
    setText(this.status, inRange ? 'Drop point locked' : 'Out of range · drops beside you');
    return this.hovered >= 0 ? CALL_IN_KINDS[this.hovered] : null;
  }
}
