// Hold-T attachment menu: a cross-shaped radial (sight up, barrel right, ammo down, underbarrel
// left), three options per arm, a virtual cursor driven by the captured mouse, live swaps with
// visible model changes, and stat bars that preview the hovered option.
import { h, setStyle, toggle, setText } from '../dom';
import { ATTACHMENT_NAMES, WEAPON_BY_ID, type AttachmentId, type AttachmentSlot } from '../../config/content';
import { weaponStats, type WeaponStats } from '../../weapons/stats';
import type { AttachmentSet } from '../../art/weaponModels';
import type { WeaponState } from '../../weapons/arsenal';

const SLOTS: { slot: AttachmentSlot; label: string; dir: [number, number] }[] = [
  { slot: 'sight', label: 'Sight', dir: [0, -1] },
  { slot: 'barrel', label: 'Barrel', dir: [1, 0] },
  { slot: 'ammo', label: 'Ammo', dir: [0, 1] },
  { slot: 'underbarrel', label: 'Underbarrel', dir: [-1, 0] },
];

interface Tile {
  el: HTMLDivElement;
  slot: AttachmentSlot;
  id: AttachmentId;
}

export function statBars(s: WeaponStats): { label: string; value: number }[] {
  const rec = s.recoil.pattern.reduce((a, p) => a + Math.abs(p[0]) * s.recoil.v + Math.abs(p[1]) * s.recoil.h, 0) / s.recoil.pattern.length;
  return [
    { label: 'Damage', value: Math.min(1, (s.damage[0] * s.pellets) / 110) },
    { label: 'Range', value: Math.min(1, s.range[1] / 260) },
    { label: 'Fire rate', value: Math.min(1, s.rpm / 1000) },
    { label: 'Handling', value: Math.max(0, 1 - s.adsTime / 0.6) },
    { label: 'Stability', value: Math.max(0, 1 - rec / 2.6) },
    { label: 'Velocity', value: Math.min(1, s.velocity / 1500) },
  ];
}

export class AttachmentMenu {
  readonly el: HTMLDivElement;
  private tiles: Tile[] = [];
  private cursor: HTMLDivElement;
  private title: HTMLDivElement;
  private bars: HTMLDivElement;
  private cx = 0;
  private cy = 0;
  private weapon: WeaponState | null = null;
  private hovered: Tile | null = null;
  open = false;

  constructor(parent: HTMLElement) {
    this.cursor = h('div', { class: 'am-cursor' });
    this.title = h('div', { class: 'am-title display' });
    this.bars = h('div', { class: 'am-bars panel brackets' });
    this.el = h('div', { class: 'attach-menu hidden' }, h('div', { class: 'am-cross' }), this.title, this.bars, this.cursor);
    parent.appendChild(this.el);
  }

  show(w: WeaponState, unlocked: (id: AttachmentId) => boolean): void {
    this.open = true;
    this.weapon = w;
    this.cx = 0;
    this.cy = 0;
    toggle(this.el, 'hidden', false);
    this.el.classList.remove('scan-in');
    void this.el.offsetWidth;
    this.el.classList.add('scan-in');
    for (const t of this.tiles) t.el.remove();
    this.tiles = [];
    const info = WEAPON_BY_ID[w.id];
    setText(this.title, info.name);
    const opts: Record<AttachmentSlot, AttachmentId[]> = { sight: info.sights, barrel: info.barrels, underbarrel: info.underbarrels, ammo: info.ammos };
    for (const s of SLOTS) {
      const list = [...new Set(opts[s.slot])];
      list.forEach((id, i) => {
        const dist = 120 + i * 92;
        const el = h('div', { class: 'am-tile chip brackets' }, h('div', { class: 'label', text: i === 0 ? s.label : '' }), h('div', { class: 'am-name', text: ATTACHMENT_NAMES[id] }));
        setStyle(el, 'left', `calc(50% + ${s.dir[0] * dist}px)`);
        setStyle(el, 'top', `calc(50% + ${s.dir[1] * dist * 0.72}px)`);
        const ok = unlocked(id);
        toggle(el, 'locked', !ok);
        if (!ok) el.append(h('div', { class: 'am-lock label', text: 'Locked' }));
        this.el.appendChild(el);
        this.tiles.push({ el, slot: s.slot, id });
      });
    }
    this.refresh(null);
  }

  hide(): void {
    this.open = false;
    toggle(this.el, 'hidden', true);
    this.weapon = null;
  }

  /** Moves the cursor; returns new attachments when a click selected a different option. */
  update(dx: number, dy: number, clicked: boolean, unlocked: (id: AttachmentId) => boolean): AttachmentSet | null {
    if (!this.open || !this.weapon) return null;
    this.cx = Math.max(-420, Math.min(420, this.cx + dx));
    this.cy = Math.max(-320, Math.min(320, this.cy + dy));
    setStyle(this.cursor, 'transform', `translate(${this.cx}px, ${this.cy}px)`);
    const rootRect = this.el.getBoundingClientRect();
    const px = rootRect.left + rootRect.width / 2 + this.cx;
    const py = rootRect.top + rootRect.height / 2 + this.cy;
    let hov: Tile | null = null;
    for (const t of this.tiles) {
      const r = t.el.getBoundingClientRect();
      if (px >= r.left && px <= r.right && py >= r.top && py <= r.bottom) hov = t;
    }
    if (hov !== this.hovered) {
      this.hovered = hov;
      this.refresh(hov);
    }
    if (clicked && hov && unlocked(hov.id) && this.weapon.att[hov.slot] !== hov.id) {
      const att = { ...this.weapon.att, [hov.slot]: hov.id } as AttachmentSet;
      return att;
    }
    return null;
  }

  /** Re-renders selection state and stat bars (with a preview of the hovered option). */
  refresh(hov: Tile | null = this.hovered): void {
    const w = this.weapon;
    if (!w) return;
    for (const t of this.tiles) {
      toggle(t.el, 'selected', w.att[t.slot] === t.id);
      toggle(t.el, 'hover', t === hov);
    }
    const cur = statBars(w.stats);
    const preview = hov ? statBars(weaponStats(w.id, { ...w.att, [hov.slot]: hov.id } as AttachmentSet)) : cur;
    this.bars.textContent = '';
    cur.forEach((b, i) => {
      const p = preview[i].value;
      const delta = p - b.value;
      const bar = h('div', { class: 'bar seg' }, h('i', { style: `width:${(Math.min(b.value, p) * 100).toFixed(0)}%` }), h('i', { class: delta >= 0 ? 'up' : 'down', style: `left:${(Math.min(b.value, p) * 100).toFixed(0)}%;width:${(Math.abs(delta) * 100).toFixed(0)}%` }));
      this.bars.append(h('div', { class: 'am-stat' }, h('div', { class: 'label', text: b.label }), bar));
    });
  }
}
