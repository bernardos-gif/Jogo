// Main menu over the live flyover: Play (match setup: mode, team size, bot difficulty), Loadout,
// Settings, Controls, Quit; a profile panel with level, XP and record.
import { h, clear, toggle, setStyle, fmtInt } from '../dom';
import { chevronSvg } from './splash';
import { sliderRow, segmentRow } from './widgets';
import { TUNING } from '../../config/tuning';
import { MAP_NAME } from '../../config/content';
import { save, type Difficulty } from '../../core/save';
import { native } from '../../core/native';
import { levelFor } from '../../net-sim/progression';

export type MatchModeId = 'sector' | 'skirmish';

export interface MatchSetup {
  mode: MatchModeId;
  teamSize: number;
  difficulty: Difficulty;
}

export class MainMenu {
  readonly el: HTMLDivElement;
  private setup: HTMLDivElement;
  private setupBody: HTMLDivElement;
  private profile: HTMLDivElement;
  private mode: MatchModeId = 'sector';
  open = false;
  onStart: ((s: MatchSetup) => void) | null = null;
  onLoadout: (() => void) | null = null;
  onSettings: (() => void) | null = null;
  onControls: (() => void) | null = null;
  /** Modes offered in the setup panel. */
  modes: { id: MatchModeId; label: string }[] = [
    { id: 'sector', label: 'Sector Control' },
    { id: 'skirmish', label: 'Skirmish' },
  ];

  constructor(parent: HTMLElement) {
    const nav = (text: string, fn: () => void, cls = '') => h('button', { class: `btn menu-btn ${cls}`, text, on: { click: fn } });
    this.setupBody = h('div', { class: 'mm-setup-body' });
    this.setup = h('div', { class: 'mm-setup panel strong brackets hidden' }, h('div', { class: 'w-section label', text: 'Match setup' }), this.setupBody, h('div', { class: 'mm-setup-foot' }, h('button', { class: 'btn primary', text: 'Start match', on: { click: () => this.start() } })));
    this.profile = h('div', { class: 'mm-profile panel strong brackets scan-in' });
    this.el = h(
      'div',
      { class: 'screen main-menu hidden' },
      h(
        'div',
        { class: 'mm-left' },
        h('div', { class: 'mm-logo' }, h('div', { class: 'mm-mark', html: chevronSvg() }), h('div', null, h('div', { class: 'display mm-title', text: 'Vector Front' }), h('div', { class: 'label', text: `${MAP_NAME} // Combined arms` }))),
        h(
          'div',
          { class: 'mm-nav scan-in' },
          nav('Play', () => this.toggleSetup(), 'primary'),
          nav('Loadout', () => this.onLoadout?.()),
          nav('Settings', () => this.onSettings?.()),
          nav('Controls', () => this.onControls?.()),
          native.isElectron ? nav('Quit', () => native.quit(), 'danger') : null,
        ),
        this.setup,
      ),
      this.profile,
      h('div', { class: 'mm-foot label', text: 'Cmd+Ctrl+F fullscreen · All models, effects and sound generated in code' }),
    );
    parent.appendChild(this.el);
  }

  show(): void {
    this.open = true;
    toggle(this.el, 'hidden', false);
    toggle(this.setup, 'hidden', true);
    this.renderProfile();
  }

  hide(): void {
    this.open = false;
    toggle(this.el, 'hidden', true);
  }

  private toggleSetup(): void {
    const show = this.setup.classList.contains('hidden');
    toggle(this.setup, 'hidden', !show);
    if (!show) return;
    clear(this.setupBody);
    const s = save.settings;
    this.setupBody.append(
      segmentRow('Mode', this.modes, this.mode, (v) => {
        this.mode = v;
        this.toggleSetup();
        this.toggleSetup();
      }),
      this.mode === 'sector'
        ? sliderRow('Team size', TUNING.sector.teamSizeMin, TUNING.sector.teamSizeMax, 1, s.teamSize, (v) => `${v} v ${v}`, (v) => save.update((d) => (d.settings.teamSize = v)))
        : h('div', { class: 'w-row' }, h('span', { class: 'w-label', text: 'Team size' }), h('span', { class: 'num w-val', text: `${TUNING.skirmish.teamSize} v ${TUNING.skirmish.teamSize}` })),
      segmentRow('Bot difficulty', [
        { id: 'recruit', label: 'Recruit' },
        { id: 'veteran', label: 'Veteran' },
        { id: 'elite', label: 'Elite' },
      ], s.difficulty, (v) => save.update((d) => (d.settings.difficulty = v))),
    );
  }

  private start(): void {
    const s = save.settings;
    this.onStart?.({ mode: this.mode, teamSize: this.mode === 'sector' ? s.teamSize : TUNING.skirmish.teamSize, difficulty: s.difficulty });
  }

  private renderProfile(): void {
    const p = save.data.progression;
    const lv = levelFor(p.xp);
    clear(this.profile);
    const bar = h('i');
    this.profile.append(
      h('div', { class: 'w-section label', text: 'Profile' }),
      h('div', { class: 'mm-level' }, h('span', { class: 'label', text: 'Level' }), h('span', { class: 'display', text: String(lv.level) })),
      h('div', { class: 'bar seg' }, bar),
      h('div', { class: 'label mm-xp', text: lv.need ? `${fmtInt(lv.into)} / ${fmtInt(lv.need)} XP` : 'Max level' }),
      h(
        'div',
        { class: 'mm-record' },
        ...([
          ['Matches', p.matches],
          ['Wins', p.wins],
          ['Kills', p.kills],
          ['K/D', p.deaths ? (p.kills / p.deaths).toFixed(2) : String(p.kills)],
        ] as [string, number | string][]).map(([k, v]) => h('div', null, h('div', { class: 'label', text: k }), h('div', { class: 'num', text: String(v) }))),
      ),
    );
    setStyle(bar, 'width', `${lv.need ? ((lv.into / lv.need) * 100).toFixed(1) : 100}%`);
  }
}
