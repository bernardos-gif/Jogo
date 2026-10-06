// Bottom-right weapon panel: weapon name, magazine / reserve (tabular), fire mode, attachment
// summary, heat bar, lock-on state, gadget and throwable status, health and armor.
import { h, setText, setStyle, toggle } from '../dom';
import { ATTACHMENT_NAMES, THROWABLES, WEAPON_BY_ID, SPECIALIST_BY_ID } from '../../config/content';
import { TUNING } from '../../config/tuning';
import type { Arsenal } from '../../weapons/arsenal';
import type { Soldier } from '../../player/soldier';

export interface GadgetView {
  name: string;
  ready: boolean;
  /** 0..1 cooldown remaining (0 = ready). */
  cooldown: number;
  charges: number;
}

export class WeaponPanel {
  readonly el: HTMLDivElement;
  private name = h('div', { class: 'wp-name display' });
  private mag = h('span', { class: 'wp-mag num' });
  private reserve = h('span', { class: 'wp-reserve num' });
  private mode = h('div', { class: 'wp-mode label' });
  private atts = h('div', { class: 'wp-atts' });
  private heat = h('div', { class: 'bar wp-heat' }, h('i'));
  private lock = h('div', { class: 'wp-lock label' });
  private gadget = h('div', { class: 'wp-chip chip brackets' });
  private throwable = h('div', { class: 'wp-chip chip brackets' });
  private hp = h('div', { class: 'bar seg wp-hp' }, h('i'));
  private armor = h('div', { class: 'bar seg wp-armor' }, h('i'));
  private hpNum = h('span', { class: 'num wp-hpnum' });
  private status = h('div', { class: 'wp-status label' });
  private lastAttKey = '';

  constructor(parent: HTMLElement) {
    this.el = h(
      'div',
      { class: 'weapon-panel panel brackets' },
      h('div', { class: 'wp-top' }, this.name, this.mode),
      h('div', { class: 'wp-ammo' }, this.mag, h('span', { class: 'wp-slash', text: '/' }), this.reserve),
      this.heat,
      this.lock,
      this.atts,
      h('div', { class: 'wp-chips' }, this.gadget, this.throwable),
      h('div', { class: 'wp-health' }, h('div', { class: 'wp-bars' }, this.armor, this.hp), this.hpNum),
      this.status,
    );
    parent.appendChild(this.el);
  }

  update(s: Soldier, a: Arsenal, gadget: GadgetView | null): void {
    const w = a.current;
    const st = w.stats;
    setText(this.name, WEAPON_BY_ID[w.id].name);
    setText(this.mode, st.modes.length > 1 || w.mode !== 'single' ? w.mode : 'semi');
    if (w.usesHeat) {
      setText(this.mag, `${Math.round((1 - w.heat) * 100)}`);
      setText(this.reserve, '%');
    } else {
      setText(this.mag, String(w.mag).padStart(st.mag >= 100 ? 3 : 2, '0'));
      setText(this.reserve, String(w.reserve));
    }
    const low = !w.usesHeat && w.mag <= Math.ceil(st.mag * TUNING.ui.lowAmmoFraction);
    toggle(this.mag, 'low', low);
    toggle(this.heat, 'hidden', !w.usesHeat);
    if (w.usesHeat) {
      setStyle(this.heat.firstChild as HTMLElement, 'width', `${(w.heat * 100).toFixed(0)}%`);
      toggle(this.heat, 'over', w.overheatT > 0);
    }
    const launcher = st.category === 'launcher';
    toggle(this.lock, 'hidden', !launcher);
    if (launcher) setText(this.lock, w.locked ? 'Locked' : w.lockT > 0 ? `Locking ${Math.round((w.lockT / TUNING.weapons.rocket.lockTime) * 100)}%` : 'No lock');
    toggle(this.lock, 'locked', w.locked);
    const attKey = `${w.id}${w.att.sight}${w.att.barrel}${w.att.underbarrel}${w.att.ammo}`;
    if (attKey !== this.lastAttKey) {
      this.lastAttKey = attKey;
      this.atts.textContent = '';
      for (const id of [w.att.sight, w.att.barrel, w.att.underbarrel, w.att.ammo]) if (id !== 'none' && id !== 'standard' && id !== 'iron') this.atts.append(h('span', { class: 'wp-att', text: ATTACHMENT_NAMES[id] }));
    }
    // Gadget and throwable.
    if (gadget) {
      setText(this.gadget, `${gadget.name}${gadget.charges > 1 ? ` x${gadget.charges}` : ''}`);
      toggle(this.gadget, 'cool', !gadget.ready);
      setStyle(this.gadget, '--cd', `${(gadget.cooldown * 100).toFixed(0)}%`);
    } else setText(this.gadget, SPECIALIST_BY_ID[s.specialist].gadgetName);
    setText(this.throwable, `${THROWABLES[a.throwable].name} x${a.throwables}`);
    toggle(this.throwable, 'cool', a.throwables <= 0);
    // Health and armor.
    setStyle(this.hp.firstChild as HTMLElement, 'width', `${Math.max(0, s.health).toFixed(0)}%`);
    toggle(this.hp, 'low', s.health < TUNING.health.max * TUNING.ui.lowHealthFraction);
    toggle(this.armor, 'hidden', s.maxArmor <= 0);
    if (s.maxArmor > 0) setStyle(this.armor.firstChild as HTMLElement, 'width', `${((s.armor / s.maxArmor) * 100).toFixed(0)}%`);
    setText(this.hpNum, String(Math.max(0, Math.ceil(s.health))));
    const status = w.reloading ? 'Reloading' : w.overheatT > 0 ? 'Overheated' : !w.usesHeat && w.mag === 0 && w.reserve === 0 ? 'No ammo' : low && !w.usesHeat ? 'Low ammo' : '';
    setText(this.status, status);
    toggle(this.status, 'warn', status !== '');
  }
}
