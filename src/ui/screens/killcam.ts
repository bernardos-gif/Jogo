// Kill cam card: who took you down, with what and from how far; while downed it adds the
// bleed-out bar, revive status and the hold-to-give-up prompt.
import { h, setText, setStyle, toggle } from '../dom';
import { CLASS_ICONS, ICONS } from '../icons';
import type { ClassId } from '../../config/content';

export interface KillInfo {
  killer: string | null;
  killerClass: ClassId | null;
  weapon: string;
  distance: number;
  headshot: boolean;
  /** Killer's remaining health fraction (null when unknown). */
  killerHealth: number | null;
}

export class KillCard {
  readonly el: HTMLDivElement;
  private head: HTMLDivElement;
  private name: HTMLDivElement;
  private icon: HTMLSpanElement;
  private weapon: HTMLDivElement;
  private dist: HTMLDivElement;
  private hpBar: HTMLElement;
  private hpRow: HTMLDivElement;
  private downedBox: HTMLDivElement;
  private bleed: HTMLElement;
  private bleedNum: HTMLDivElement;
  private revive: HTMLDivElement;
  private prompt: HTMLDivElement;
  private giveUp: HTMLElement;
  open = false;

  constructor(parent: HTMLElement) {
    this.head = h('div', { class: 'label kc-head' });
    this.icon = h('span', { class: 'kc-icon' });
    this.name = h('div', { class: 'kc-name display' });
    this.weapon = h('div', { class: 'kc-weapon' });
    this.dist = h('div', { class: 'kc-dist num' });
    this.hpBar = h('i');
    this.hpRow = h('div', { class: 'kc-hp' }, h('span', { class: 'label', text: 'Their health' }), h('div', { class: 'bar seg' }, this.hpBar));
    this.bleed = h('i');
    this.bleedNum = h('div', { class: 'num kc-bleed-num' });
    this.revive = h('div', { class: 'kc-revive label' });
    this.giveUp = h('i');
    this.prompt = h('div', { class: 'kc-prompt label' }, h('span', { text: 'Hold ' }), h('span', { class: 'key', text: 'E' }), h('span', { text: ' to give up' }), h('div', { class: 'bar' }, this.giveUp));
    this.downedBox = h('div', { class: 'kc-downed' }, h('div', { class: 'kc-row' }, h('div', { class: 'label', text: 'Bleeding out' }), this.bleedNum), h('div', { class: 'bar seg kc-bleed' }, this.bleed), this.revive, this.prompt);
    this.el = h(
      'div',
      { class: 'killcard panel strong brackets hidden' },
      this.head,
      h('div', { class: 'kc-who' }, this.icon, this.name),
      h('div', { class: 'kc-row' }, this.weapon, this.dist),
      this.hpRow,
      this.downedBox,
    );
    parent.appendChild(this.el);
  }

  show(k: KillInfo, downed: boolean): void {
    this.open = true;
    setText(this.head, downed ? 'Downed by' : 'Eliminated by');
    setText(this.name, k.killer ?? 'Environment');
    this.icon.innerHTML = k.killerClass ? CLASS_ICONS[k.killerClass] : ICONS.skull;
    setText(this.weapon, k.headshot ? `${k.weapon} · Headshot` : k.weapon);
    setText(this.dist, k.killer ? `${Math.round(k.distance)} m` : '');
    toggle(this.hpRow, 'hidden', k.killerHealth === null);
    if (k.killerHealth !== null) setStyle(this.hpBar, 'width', `${Math.round(k.killerHealth * 100)}%`);
    toggle(this.downedBox, 'hidden', !downed);
    toggle(this.el, 'hidden', false);
    this.el.classList.remove('scan-in');
    void this.el.offsetWidth;
    this.el.classList.add('scan-in');
  }

  /** Downed state: bleed-out fraction left, revive status text and give-up hold progress. */
  updateDowned(left: number, seconds: number, reviveText: string, giveUp: number): void {
    setStyle(this.bleed, 'width', `${(left * 100).toFixed(1)}%`);
    setText(this.bleedNum, `${Math.ceil(seconds)} s`);
    setText(this.revive, reviveText);
    setStyle(this.giveUp, 'width', `${(giveUp * 100).toFixed(0)}%`);
  }

  setDead(): void {
    setText(this.head, 'Eliminated by');
    toggle(this.downedBox, 'hidden', true);
  }

  hide(): void {
    this.open = false;
    toggle(this.el, 'hidden', true);
  }
}
