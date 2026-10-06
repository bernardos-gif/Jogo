// Loadout: class and specialist cards, a rotating 3D weapon preview, the primary weapon list with
// unlock levels and mastery, attachment slots (three options each, level-gated) with stat bars that
// preview the hovered option, and the throwable. Everything persists to the save immediately.
import * as THREE from 'three';
import { h, clear, toggle, setStyle } from '../dom';
import { CLASS_ICONS, ICONS } from '../icons';
import { statBars } from '../hud/attachmentMenu';
import { ATTACHMENT_NAMES, CLASSES, PRIMARY_WEAPONS, SPECIALISTS, THROWABLES, WEAPON_BY_ID, type AttachmentId, type AttachmentSlot, type ClassId, type ThrowableId, type WeaponId } from '../../config/content';
import { weaponStats } from '../../weapons/stats';
import { buildWeaponModel, defaultAttachments, type AttachmentSet } from '../../art/weaponModels';
import { disposeObject } from '../../render/toon';
import { save } from '../../core/save';
import { weaponUnlocked, weaponLevel, attachmentUnlocked, attachmentLevel } from '../../net-sim/unlocks';

const CLASS_ORDER: ClassId[] = ['assault', 'engineer', 'support', 'recon'];
const SLOTS: { slot: AttachmentSlot; label: string; key: 'sights' | 'barrels' | 'underbarrels' | 'ammos' }[] = [
  { slot: 'sight', label: 'Sight', key: 'sights' },
  { slot: 'barrel', label: 'Barrel', key: 'barrels' },
  { slot: 'underbarrel', label: 'Underbarrel', key: 'underbarrels' },
  { slot: 'ammo', label: 'Ammo', key: 'ammos' },
];

/** A small dedicated renderer that turns the weapon model on a stand. */
class WeaponPreview {
  readonly canvas: HTMLCanvasElement;
  private gl: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(30, 1, 0.05, 20);
  private model: THREE.Group | null = null;
  private pivot = new THREE.Group();
  private raf = 0;
  private spin = 0;
  private last = 0;

  constructor() {
    this.canvas = h('canvas', { class: 'lo-preview-canvas' });
    // Elemental Brawl's light rig, scaled for a close-up.
    this.scene.add(new THREE.HemisphereLight(0xffd6b0, 0x6a4a7a, 1.15));
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.35));
    const sun = new THREE.DirectionalLight(0xffe0b8, 2.4);
    sun.position.set(2, 3, 2);
    this.scene.add(sun);
    this.scene.add(this.pivot);
    this.cam.position.set(0, 0.25, 2.1);
    this.cam.lookAt(0, 0, 0);
  }

  start(): void {
    if (!this.gl) {
      this.gl = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
      this.gl.outputColorSpace = THREE.SRGBColorSpace;
      this.gl.toneMapping = THREE.NoToneMapping;
      this.gl.setClearColor(0x000000, 0);
    }
    this.last = performance.now();
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.render(dt);
    };
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
  }

  setWeapon(id: WeaponId, att: AttachmentSet): void {
    if (this.model) {
      this.pivot.remove(this.model);
      disposeObject(this.model);
    }
    const m = buildWeaponModel(id, att);
    this.model = m.group;
    // Center the model on its bounds and fit it to the view.
    const box = new THREE.Box3().setFromObject(m.group);
    const c = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    m.group.position.sub(c);
    const s = 1.25 / Math.max(0.2, size.z, size.x, size.y);
    this.pivot.scale.setScalar(s);
    this.pivot.add(m.group);
  }

  private render(dt: number): void {
    if (!this.gl) return;
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), hgt = Math.max(1, Math.round(r.height));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(hgt * dpr)) {
      this.gl.setPixelRatio(dpr);
      this.gl.setSize(w, hgt, false);
      this.cam.aspect = w / hgt;
      this.cam.updateProjectionMatrix();
    }
    this.spin += dt * 0.45;
    this.pivot.rotation.set(0.12, Math.PI / 2 + Math.sin(this.spin) * 0.9, 0);
    this.gl.render(this.scene, this.cam);
  }
}

export class LoadoutScreen {
  readonly el: HTMLDivElement;
  private classes: HTMLDivElement;
  private specs: HTMLDivElement;
  private weapons: HTMLDivElement;
  private weaponTitle: HTMLDivElement;
  private weaponDesc: HTMLDivElement;
  private mastery: HTMLDivElement;
  private slots: HTMLDivElement;
  private bars: HTMLDivElement;
  private throws: HTMLDivElement;
  private preview = new WeaponPreview();
  open = false;
  onBack: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    this.classes = h('div', { class: 'lo-classes' });
    this.specs = h('div', { class: 'lo-specs' });
    this.weapons = h('div', { class: 'lo-weapons' });
    this.weaponTitle = h('div', { class: 'display lo-wtitle' });
    this.weaponDesc = h('div', { class: 'lo-wdesc' });
    this.mastery = h('div', { class: 'label lo-mastery' });
    this.slots = h('div', { class: 'lo-slots' });
    this.bars = h('div', { class: 'lo-bars' });
    this.throws = h('div', { class: 'lo-throws' });
    this.el = h(
      'div',
      { class: 'screen menu-screen loadout hidden' },
      h('div', { class: 'ms-head' }, h('div', { class: 'display ms-title', text: 'Loadout' })),
      h(
        'div',
        { class: 'lo-body' },
        h('div', { class: 'lo-col panel strong brackets scan-in' }, h('div', { class: 'w-section label', text: 'Class' }), this.classes, h('div', { class: 'w-section label', text: 'Specialist' }), this.specs),
        h(
          'div',
          { class: 'lo-center panel brackets grid-bg scan-in' },
          h('div', { class: 'lo-preview' }, this.preview.canvas),
          h('div', { class: 'lo-winfo' }, this.weaponTitle, this.weaponDesc, this.mastery),
          h('div', { class: 'w-section label', text: 'Primary weapon' }),
          this.weapons,
        ),
        h('div', { class: 'lo-col panel strong brackets scan-in' }, h('div', { class: 'w-section label', text: 'Attachments' }), this.slots, h('div', { class: 'w-section label', text: 'Handling' }), this.bars, h('div', { class: 'w-section label', text: 'Throwable' }), this.throws),
      ),
      h('div', { class: 'ms-foot' }, h('button', { class: 'btn', text: 'Back', on: { click: () => this.onBack?.() } })),
    );
    parent.appendChild(this.el);
    window.addEventListener('keydown', (e) => {
      if (this.open && e.code === 'Escape') this.onBack?.();
    });
  }

  show(): void {
    this.open = true;
    toggle(this.el, 'hidden', false);
    this.render();
    this.preview.start();
  }

  hide(): void {
    this.open = false;
    this.preview.stop();
    toggle(this.el, 'hidden', true);
  }

  private att(id: WeaponId): AttachmentSet {
    return save.data.attachments[id] ?? defaultAttachments(id);
  }

  private render(preview?: { slot: AttachmentSlot; id: AttachmentId }): void {
    const d = save.data;
    const cls = d.cls;
    const lo = d.loadouts[cls];
    // Classes.
    clear(this.classes);
    for (const c of CLASS_ORDER)
      this.classes.append(
        h(
          'div',
          {
            class: `lo-class${c === cls ? ' selected' : ''}`,
            on: {
              click: () => {
                save.update((s) => (s.cls = c));
                this.render();
              },
            },
          },
          h('span', { class: 'lo-ci', html: CLASS_ICONS[c] }),
          h('div', null, h('div', { class: 'display', text: CLASSES[c].name }), h('div', { class: 'label', text: CLASSES[c].role })),
        ),
      );
    clear(this.specs);
    for (const sp of SPECIALISTS.filter((s) => s.cls === cls))
      this.specs.append(
        h(
          'div',
          {
            class: `lo-spec${sp.id === lo.specialist ? ' selected' : ''}`,
            on: {
              click: () => {
                save.update((s) => (s.loadouts[cls].specialist = sp.id));
                this.render();
              },
            },
          },
          h('div', { class: 'lo-spec-head' }, h('span', { class: 'display', text: sp.callsign }), h('span', { class: 'label', text: sp.name })),
          h('div', { class: 'lo-spec-line' }, h('span', { class: 'label', text: sp.gadgetName }), h('span', { text: sp.gadgetDesc })),
          h('div', { class: 'lo-spec-line' }, h('span', { class: 'label', text: sp.passiveName }), h('span', { text: sp.passiveDesc })),
        ),
      );
    // Weapon list.
    const wid = lo.primary;
    clear(this.weapons);
    for (const id of PRIMARY_WEAPONS as WeaponId[]) {
      const open = weaponUnlocked(id);
      const info = WEAPON_BY_ID[id];
      this.weapons.append(
        h(
          'button',
          {
            class: `btn lo-weapon${id === wid ? ' selected' : ''}${open ? '' : ' locked'}`,
            title: open ? info.desc : `Unlocks at level ${weaponLevel(id)}`,
            on: {
              click: () => {
                if (!open) return;
                save.update((s) => (s.loadouts[cls].primary = id));
                this.render();
              },
            },
          },
          h('span', { class: 'lo-wname', text: info.name }),
          h('span', { class: 'label', text: open ? info.category.toUpperCase() : `Level ${weaponLevel(id)}` }),
          open ? null : h('span', { class: 'lo-lock', html: ICONS.lock }),
        ),
      );
    }
    const info = WEAPON_BY_ID[wid];
    const att = this.att(wid);
    this.weaponTitle.textContent = info.name;
    this.weaponDesc.textContent = info.desc;
    const m = d.progression.mastery[wid];
    this.mastery.textContent = `Mastery · ${m?.kills ?? 0} kills · ${m?.headshots ?? 0} headshots`;
    if (!preview) this.preview.setWeapon(wid, att);
    // Attachments.
    clear(this.slots);
    for (const sl of SLOTS) {
      const row = h('div', { class: 'lo-slot' }, h('div', { class: 'label', text: sl.label }));
      const opts = h('div', { class: 'lo-opts' });
      for (const id of info[sl.key] as readonly AttachmentId[]) {
        const open = attachmentUnlocked(wid, id);
        const sel = att[sl.slot] === id;
        opts.append(
          h(
            'button',
            {
              class: `btn chip-btn lo-opt${sel ? ' selected' : ''}${open ? '' : ' locked'}`,
              title: open ? '' : `Unlocks at level ${attachmentLevel(wid, id)}`,
              on: {
                click: () => {
                  if (!open) return;
                  save.update((s) => (s.attachments[wid] = { ...att, [sl.slot]: id } as AttachmentSet));
                  this.render();
                },
                mouseenter: () => open && this.renderBars(wid, { ...att, [sl.slot]: id } as AttachmentSet),
                mouseleave: () => this.renderBars(wid, this.att(wid)),
              },
            },
            ATTACHMENT_NAMES[id],
          ),
        );
      }
      row.append(opts);
      this.slots.append(row);
    }
    this.renderBars(wid, att);
    // Throwables.
    clear(this.throws);
    for (const t of Object.keys(THROWABLES) as ThrowableId[])
      this.throws.append(
        h(
          'div',
          {
            class: `lo-throw${t === lo.throwable ? ' selected' : ''}`,
            on: {
              click: () => {
                save.update((s) => (s.loadouts[cls].throwable = t));
                this.render();
              },
            },
          },
          h('div', { class: 'display', text: THROWABLES[t].name }),
          h('div', { class: 'lo-tdesc', text: THROWABLES[t].desc }),
        ),
      );
  }

  /** Stat bars for the saved attachments, with the change a hovered option would make. */
  private renderBars(wid: WeaponId, hovered: AttachmentSet): void {
    const cur = statBars(weaponStats(wid, this.att(wid)));
    const nxt = statBars(weaponStats(wid, hovered));
    clear(this.bars);
    cur.forEach((b, i) => {
      const v = nxt[i].value;
      const base = h('i', { class: 'base' });
      const delta = h('i', { class: v >= b.value ? 'up' : 'down' });
      setStyle(base, 'width', `${(Math.min(b.value, v) * 100).toFixed(0)}%`);
      setStyle(delta, 'left', `${(Math.min(b.value, v) * 100).toFixed(0)}%`);
      setStyle(delta, 'width', `${(Math.abs(v - b.value) * 100).toFixed(0)}%`);
      this.bars.append(h('div', { class: 'lo-bar' }, h('span', { class: 'label', text: b.label }), h('div', { class: 'bar seg' }, base, delta)));
    });
  }
}
