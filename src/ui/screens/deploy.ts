// Deploy screen: holographic tactical map with selectable spawns (HQ, owned sectors, squadmates),
// the squad list, a loadout quick-swap (class, specialist, primary weapon, throwable), tickets and
// sector ownership, and the deploy button with the respawn countdown.
import { h, setText, toggle, clear, fmtTime } from '../dom';
import { TacticalMapView, type MapUnit } from '../tacmap';
import { CLASS_ICONS, ICONS } from '../icons';
import { statBars } from '../hud/attachmentMenu';
import { CLASSES, FACTIONS, MAP_NAME, PRIMARY_WEAPONS, SPECIALISTS, THROWABLES, WEAPON_BY_ID, ZONES, type ClassId, type TeamId, type ThrowableId, type WeaponId } from '../../config/content';
import { weaponStats } from '../../weapons/stats';
import { defaultAttachments } from '../../art/weaponModels';
import { save } from '../../core/save';
import { weaponUnlocked, weaponLevel } from '../../net-sim/unlocks';
import type { TacticalImage } from '../../render/tacticalMap';
import type { ZoneState } from '../../modes/sector/logic';
import type { SpawnOption } from '../../modes/sector/spawns';
import type { Soldier } from '../../player/soldier';

export interface DeployContext {
  player: Soldier;
  squadName: string;
  squad: readonly Soldier[];
  zones: readonly ZoneState[];
  tickets: [number, number];
  scoreLabel: string;
  scoreMax: number;
  hqs: readonly { team: TeamId; x: number; z: number }[];
  limit: number;
  roundT: number;
  options: SpawnOption[];
  respawnLeft: number;
  units: MapUnit[];
  time: number;
}

const CLASS_ORDER: ClassId[] = ['assault', 'engineer', 'support', 'recon'];

export class DeployScreen {
  readonly el: HTMLDivElement;
  readonly map: TacticalMapView;
  selected: string | null = null;
  open = false;
  onDeploy: ((opt: SpawnOption) => void) | null = null;
  /** Called when the loadout changed (the next deploy uses it). */
  onLoadout: (() => void) | null = null;

  private squadList: HTMLDivElement;
  private squadTitle: HTMLDivElement;
  private classTabs: HTMLDivElement;
  private specCards: HTMLDivElement;
  private weaponName: HTMLDivElement;
  private weaponMeta: HTMLDivElement;
  private weaponBars: HTMLDivElement;
  private throwRow: HTMLDivElement;
  private ticketsEl: HTMLDivElement;
  private ticketsLabel = h('div', { class: 'label', text: 'Tickets' });
  private zonesEl: HTMLDivElement;
  private spawnLabel: HTMLDivElement;
  private spawnSub: HTMLDivElement;
  private deployBtn: HTMLButtonElement;
  private clock: HTMLDivElement;
  private ctx: DeployContext | null = null;
  private drawT = 0;

  constructor(parent: HTMLElement, image: TacticalImage) {
    this.map = new TacticalMapView(image, 'deploy-map-canvas');
    this.map.onPick = (k) => this.select(k);

    this.squadTitle = h('div', { class: 'label', text: 'Squad' });
    this.squadList = h('div', { class: 'dp-squad' });
    this.classTabs = h('div', { class: 'dp-classes' });
    this.specCards = h('div', { class: 'dp-specs' });
    this.weaponName = h('div', { class: 'dp-weapon-name display' });
    this.weaponMeta = h('div', { class: 'dp-weapon-meta label' });
    this.weaponBars = h('div', { class: 'dp-bars' });
    this.throwRow = h('div', { class: 'dp-throws' });
    const prev = h('button', { class: 'btn icon-btn', html: ICONS.left, title: 'Previous weapon', on: { click: () => this.cycleWeapon(-1) } });
    const next = h('button', { class: 'btn icon-btn', html: ICONS.right, title: 'Next weapon', on: { click: () => this.cycleWeapon(1) } });

    const left = h(
      'div',
      { class: 'dp-left panel strong brackets scan-in' },
      h('div', { class: 'dp-section' }, this.squadTitle, this.squadList),
      h(
        'div',
        { class: 'dp-section' },
        h('div', { class: 'label', text: 'Loadout' }),
        this.classTabs,
        this.specCards,
        h('div', { class: 'dp-weapon' }, prev, h('div', { class: 'dp-weapon-mid' }, this.weaponName, this.weaponMeta), next),
        this.weaponBars,
        h('div', { class: 'label dp-sub', text: 'Throwable' }),
        this.throwRow,
      ),
    );

    this.ticketsEl = h('div', { class: 'dp-tickets' });
    this.zonesEl = h('div', { class: 'dp-zones' });
    this.spawnLabel = h('div', { class: 'dp-spawn display' });
    this.spawnSub = h('div', { class: 'dp-spawn-sub label' });
    this.deployBtn = h('button', { class: 'btn primary dp-deploy', text: 'Deploy', on: { click: () => this.tryDeploy() } });
    this.clock = h('div', { class: 'dp-clock num' });
    const right = h(
      'div',
      { class: 'dp-right panel strong brackets scan-in' },
      h('div', { class: 'dp-section' }, this.ticketsLabel, this.ticketsEl),
      h('div', { class: 'dp-section' }, h('div', { class: 'label', text: 'Sectors' }), this.zonesEl),
      h('div', { class: 'dp-section dp-grow' }, h('div', { class: 'label', text: 'Spawn point' }), this.spawnLabel, this.spawnSub),
      h('div', { class: 'dp-section' }, this.deployBtn, h('div', { class: 'dp-hint label', text: 'Click the map to pick a spawn · Space to deploy' })),
    );

    const legend = h(
      'div',
      { class: 'dp-legend label' },
      h('span', { class: 'lg friend', html: ICONS.hq }),
      h('span', { text: 'HQ' }),
      h('span', { class: 'lg friend', html: ICONS.sector }),
      h('span', { text: 'Sector spawn' }),
      h('span', { class: 'lg squad', html: ICONS.squad }),
      h('span', { text: 'Squadmate' }),
      h('span', { class: 'lg foe', html: ICONS.enemy }),
      h('span', { text: 'Spotted enemy' }),
    );
    const center = h('div', { class: 'dp-map panel brackets grid-bg' }, this.map.canvas, legend);

    this.el = h(
      'div',
      { class: 'screen deploy hidden' },
      h('div', { class: 'dp-top' }, h('div', { class: 'dp-title display', text: 'Deploy' }), h('div', { class: 'label', text: `${MAP_NAME} // Sector Control` }), this.clock),
      h('div', { class: 'dp-body' }, left, center, right),
    );
    parent.appendChild(this.el);
    window.addEventListener('keydown', (e) => {
      if (!this.open) return;
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        this.tryDeploy();
      }
    });
    this.renderLoadout();
  }

  show(): void {
    this.open = true;
    this.map.refreshPalette();
    toggle(this.el, 'hidden', false);
    // Replay the scan-in sweep.
    for (const p of this.el.querySelectorAll('.scan-in')) {
      p.classList.remove('scan-in');
      void (p as HTMLElement).offsetWidth;
      p.classList.add('scan-in');
    }
    this.renderLoadout();
  }

  hide(): void {
    this.open = false;
    toggle(this.el, 'hidden', true);
  }

  select(key: string): void {
    this.selected = key;
    this.drawT = 0;
  }

  selectedOption(): SpawnOption | null {
    const opts = this.ctx?.options ?? [];
    return opts.find((o) => o.key === this.selected) ?? opts[0] ?? null;
  }

  tryDeploy(): void {
    if (!this.open || !this.ctx || this.ctx.respawnLeft > 0) return;
    const opt = this.selectedOption();
    if (opt && this.onDeploy) this.onDeploy(opt);
  }

  update(dt: number, c: DeployContext): void {
    this.ctx = c;
    if (!this.open) return;
    if (!c.options.some((o) => o.key === this.selected)) this.selected = c.options[0]?.key ?? null;
    this.drawT -= dt;
    if (this.drawT <= 0) {
      this.drawT = 1 / 20;
      this.map.draw({ team: c.player.team, zones: c.zones, hqs: c.hqs, limit: c.limit, spawns: c.options, selected: this.selected, units: c.units, time: c.time });
      this.renderSquad(c);
      this.renderMatch(c);
    }
    const left = c.respawnLeft;
    setText(this.deployBtn, left > 0 ? `Deploy in ${left.toFixed(1)}` : 'Deploy');
    toggle(this.deployBtn, 'disabled', left > 0);
    setText(this.clock, fmtTime(c.roundT));
    const opt = this.selectedOption();
    if (opt) {
      if (opt.kind === 'hq') {
        setText(this.spawnLabel, 'Headquarters');
        setText(this.spawnSub, FACTIONS[c.player.team].name);
      } else if (opt.kind === 'zone') {
        setText(this.spawnLabel, `Sector ${opt.label}`);
        setText(this.spawnSub, `${ZONES[opt.zone!].name} · ${ZONES[opt.zone!].district}`);
      } else {
        setText(this.spawnLabel, opt.label);
        setText(this.spawnSub, 'Squadmate · out of combat');
      }
    }
  }

  private renderSquad(c: DeployContext): void {
    setText(this.squadTitle, `Squad · ${c.squadName}`);
    clear(this.squadList);
    for (const m of c.squad) {
      const status = !m.alive ? (m.isPlayer ? 'Deploying' : 'Dead') : m.downed ? 'Downed' : 'Active';
      const hp = m.alive && !m.downed ? m.health / 100 : 0;
      const bar = h('div', { class: 'bar' }, h('i', { style: `width:${(hp * 100).toFixed(0)}%` }));
      this.squadList.append(
        h(
          'div',
          { class: `dp-mate ${m.isPlayer ? 'you' : ''} ${m.isPlayer && !m.alive ? '' : status.toLowerCase()}` },
          h('span', { class: 'dp-ci', html: CLASS_ICONS[m.cls] }),
          h('span', { class: 'dp-mname', text: m.name }),
          h('span', { class: 'dp-mstat label', text: status }),
          bar,
        ),
      );
    }
  }

  private renderMatch(c: DeployContext): void {
    const team = c.player.team;
    const enemy: TeamId = team === 0 ? 1 : 0;
    const max = Math.max(1, c.tickets[0], c.tickets[1], c.scoreMax);
    setText(this.ticketsLabel, c.scoreLabel);
    clear(this.ticketsEl);
    for (const [t, cls] of [
      [team, 'friend'],
      [enemy, 'foe'],
    ] as [TeamId, string][]) {
      this.ticketsEl.append(
        h(
          'div',
          { class: `dp-trow ${cls}` },
          h('span', { class: 'label', text: FACTIONS[t].name }),
          h('span', { class: 'num', text: String(Math.ceil(c.tickets[t])) }),
          h('div', { class: 'bar seg' }, h('i', { style: `width:${((c.tickets[t] / max) * 100).toFixed(1)}%` })),
        ),
      );
    }
    clear(this.zonesEl);
    for (const z of c.zones) {
      const cls = z.owner === -1 ? 'neutral' : z.owner === team ? 'friend' : 'foe';
      this.zonesEl.append(h('div', { class: `dp-zone ${cls} ${z.contested ? 'contested' : ''}`, title: ZONES[z.id].name }, h('span', { class: 'display', text: z.id })));
    }
  }

  // ---- Loadout ---------------------------------------------------------------------------------
  private renderLoadout(): void {
    const d = save.data;
    const cls = d.cls;
    const lo = d.loadouts[cls];
    clear(this.classTabs);
    for (const c of CLASS_ORDER) {
      this.classTabs.append(
        h(
          'button',
          {
            class: `btn dp-class ${c === cls ? 'selected' : ''}`,
            title: CLASSES[c].role,
            on: {
              click: () => {
                save.update((s) => (s.cls = c));
                this.renderLoadout();
                this.onLoadout?.();
              },
            },
          },
          h('span', { html: CLASS_ICONS[c] }),
          h('span', { text: CLASSES[c].name }),
        ),
      );
    }
    clear(this.specCards);
    for (const sp of SPECIALISTS.filter((s) => s.cls === cls)) {
      this.specCards.append(
        h(
          'div',
          {
            class: `dp-spec ${sp.id === lo.specialist ? 'selected' : ''}`,
            on: {
              click: () => {
                save.update((s) => (s.loadouts[cls].specialist = sp.id));
                this.renderLoadout();
                this.onLoadout?.();
              },
            },
          },
          h('div', { class: 'display dp-spec-name', text: sp.callsign }),
          h('div', { class: 'dp-spec-row' }, h('span', { class: 'label', text: 'Gadget' }), h('span', { text: sp.gadgetName })),
          h('div', { class: 'dp-spec-row' }, h('span', { class: 'label', text: 'Trait' }), h('span', { text: sp.passiveName })),
        ),
      );
    }
    const wid = lo.primary;
    const info = WEAPON_BY_ID[wid];
    const unlocked = weaponUnlocked(wid);
    setText(this.weaponName, info.name);
    setText(this.weaponMeta, unlocked ? `${info.category.toUpperCase()} · ${info.energy === 'kinetic' ? 'Kinetic' : 'Energy'}` : `Locked · level ${weaponLevel(wid)}`);
    toggle(this.weaponName, 'locked', !unlocked);
    clear(this.weaponBars);
    const st = weaponStats(wid, save.data.attachments[wid] ?? defaultAttachments(wid));
    for (const b of statBars(st)) this.weaponBars.append(h('div', { class: 'dp-stat' }, h('span', { class: 'label', text: b.label }), h('div', { class: 'bar seg' }, h('i', { style: `width:${(b.value * 100).toFixed(0)}%` }))));
    clear(this.throwRow);
    for (const t of Object.keys(THROWABLES) as ThrowableId[]) {
      this.throwRow.append(
        h('button', {
          class: `btn chip-btn ${t === lo.throwable ? 'selected' : ''}`,
          text: THROWABLES[t].name,
          on: {
            click: () => {
              save.update((s) => (s.loadouts[cls].throwable = t));
              this.renderLoadout();
              this.onLoadout?.();
            },
          },
        }),
      );
    }
  }

  private cycleWeapon(dir: number): void {
    const cls = save.data.cls;
    const list = PRIMARY_WEAPONS;
    let i = list.indexOf(save.data.loadouts[cls].primary);
    // Skip locked weapons.
    for (let k = 0; k < list.length; k++) {
      i = (i + dir + list.length) % list.length;
      if (weaponUnlocked(list[i] as WeaponId)) break;
    }
    save.update((s) => (s.loadouts[cls].primary = list[i]));
    this.renderLoadout();
    this.onLoadout?.();
  }
}
