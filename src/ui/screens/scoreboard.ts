// Scoreboard (hold Tab): both teams side by side, sorted by score, with squad, class, kills,
// deaths, assists, revives and captures; the player's row and squad are highlighted.
import { h, setText, toggle, clear, fmtTime } from '../dom';
import { CLASS_ICONS } from '../icons';
import { FACTIONS, type TeamId } from '../../config/content';
import type { Soldier } from '../../player/soldier';

export interface ScoreboardData {
  player: Soldier;
  soldiers: readonly Soldier[];
  squadName: (s: Soldier) => string;
  /** Friendly then enemy (tickets in Sector Control, kills in Skirmish). */
  totals: [number, number];
  totalLabel: string;
  roundT: number;
  modeName: string;
}

export class Scoreboard {
  readonly el: HTMLDivElement;
  private cols: [HTMLDivElement, HTMLDivElement];
  private heads: [HTMLDivElement, HTMLDivElement];
  private sub: HTMLDivElement;
  open = false;
  private t = 0;

  constructor(parent: HTMLElement) {
    const col = () => h('div', { class: 'sb-rows' });
    const head = () => h('div', { class: 'sb-head' });
    this.cols = [col(), col()];
    this.heads = [head(), head()];
    this.sub = h('div', { class: 'label sb-sub' });
    const header = () =>
      h('div', { class: 'sb-row sb-colhead label' }, h('span', { text: 'Squad' }), h('span'), h('span', { text: 'Name' }), h('span', { text: 'Score' }), h('span', { text: 'K' }), h('span', { text: 'D' }), h('span', { text: 'A' }), h('span', { text: 'Rev' }), h('span', { text: 'Cap' }));
    this.el = h(
      'div',
      { class: 'scoreboard hidden' },
      h('div', { class: 'sb-top' }, h('div', { class: 'display sb-title', text: 'Scoreboard' }), this.sub),
      h('div', { class: 'sb-body' }, h('div', { class: 'sb-team friend panel strong brackets' }, this.heads[0], header(), this.cols[0]), h('div', { class: 'sb-team foe panel strong brackets' }, this.heads[1], header(), this.cols[1])),
    );
    parent.appendChild(this.el);
  }

  show(on: boolean): void {
    if (on === this.open) return;
    this.open = on;
    toggle(this.el, 'hidden', !on);
    this.t = 0;
  }

  update(dt: number, d: ScoreboardData): void {
    if (!this.open) return;
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.25;
    const me = d.player;
    const teams: TeamId[] = [me.team, me.team === 0 ? 1 : 0];
    setText(this.sub, `${d.modeName} · ${fmtTime(d.roundT)}`);
    teams.forEach((team, i) => {
      const head = this.heads[i];
      clear(head);
      head.append(h('span', { class: 'display', text: FACTIONS[team].name }), h('span', { class: 'label', text: d.totalLabel }), h('span', { class: 'num sb-total', text: String(Math.ceil(d.totals[i])) }));
      const rows = d.soldiers.filter((s) => s.team === team && !s.dummy).sort((a, b) => b.stats.score - a.stats.score || b.stats.kills - a.stats.kills);
      const col = this.cols[i];
      clear(col);
      for (const s of rows) {
        const sq = s.squadId === me.squadId && me.squadId >= 0 && s.team === me.team;
        const st = !s.alive ? 'dead' : s.downed ? 'downed' : '';
        col.append(
          h(
            'div',
            { class: `sb-row${s === me ? ' you' : ''}${sq ? ' squad' : ''} ${st}` },
            h('span', { class: 'label sb-squad', text: d.squadName(s) }),
            h('span', { class: 'sb-ci', html: CLASS_ICONS[s.cls] }),
            h('span', { class: 'sb-name', text: s.name }),
            h('span', { class: 'num', text: String(s.stats.score) }),
            h('span', { class: 'num', text: String(s.stats.kills) }),
            h('span', { class: 'num', text: String(s.stats.deaths) }),
            h('span', { class: 'num', text: String(s.stats.assists) }),
            h('span', { class: 'num', text: String(s.stats.revives) }),
            h('span', { class: 'num', text: String(s.stats.captures) }),
          ),
        );
      }
    });
  }
}
