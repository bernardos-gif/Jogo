// Top of the HUD: compass strip (bearing ticks, cardinal labels, objective letters and pings pinned
// at their bearings), the A-E objective row (owner, capture progress, contest) flanked by both
// ticket bars, and the match clock with the mode name at the top left.
import { h, setText, setStyle, toggle, fmtTime } from '../dom';
import { TUNING } from '../../config/tuning';
import { FACTIONS, type TeamId } from '../../config/content';
import { bearingDeg } from '../../core/math';
import type { HudWorld } from './types';
import type { ZoneState } from '../../modes/sector/logic';

const CARD: Record<number, string> = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };

function cssVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export class TopBar {
  readonly el: HTMLDivElement;
  private compass: HTMLCanvasElement;
  private cctx: CanvasRenderingContext2D;
  private bearing: HTMLDivElement;
  private objs: { el: HTMLDivElement; fill: HTMLElement; letter: HTMLElement }[] = [];
  private objRow: HTMLDivElement;
  private tFriend: { num: HTMLElement; bar: HTMLElement; bleed: HTMLElement; name: HTMLElement };
  private tFoe: { num: HTMLElement; bar: HTMLElement; bleed: HTMLElement; name: HTMLElement };
  private clock: HTMLDivElement;
  private mode: HTMLDivElement;
  private colors = { friend: '#3fd7ff', foe: '#ff4458', neutral: '#c8d2dc', fg: '#e4f7ff', dim: '#8fb2c2', amber: '#ffb340', squad: '#8dff7a' };

  constructor(parent: HTMLElement) {
    this.compass = h('canvas', { class: 'tb-compass' });
    this.cctx = this.compass.getContext('2d')!;
    this.bearing = h('div', { class: 'tb-bearing num' });
    this.objRow = h('div', { class: 'tb-objs' });
    const tickets = (cls: string) => {
      const num = h('span', { class: 'num tb-tnum' });
      const bar = h('i');
      const bleed = h('span', { class: 'tb-bleed', html: '<svg viewBox="0 0 10 10" class="icon"><path d="M1 3 L5 8 L9 3" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>' });
      const name = h('span', { class: 'label tb-tname' });
      return { root: h('div', { class: `tb-tickets ${cls}` }, h('div', { class: 'tb-trow' }, name, bleed, num), h('div', { class: 'bar seg' }, bar)), num, bar, bleed, name };
    };
    const f = tickets('friend');
    const e = tickets('foe');
    this.tFriend = f;
    this.tFoe = e;
    this.clock = h('div', { class: 'num tb-clock' });
    this.mode = h('div', { class: 'label tb-mode' });
    this.el = h(
      'div',
      { class: 'topbar' },
      h('div', { class: 'tb-center' }, h('div', { class: 'tb-compass-wrap' }, this.compass, h('div', { class: 'tb-caret' }), this.bearing), h('div', { class: 'tb-row' }, f.root, this.objRow, e.root)),
    );
    parent.appendChild(this.el);
    parent.appendChild(h('div', { class: 'hud-clock' }, this.mode, this.clock));
    this.refreshPalette();
  }

  refreshPalette(): void {
    this.colors = { friend: cssVar('--friend', '#3fd7ff'), foe: cssVar('--foe', '#ff4458'), neutral: cssVar('--neutral', '#c8d2dc'), fg: cssVar('--fg', '#e4f7ff'), dim: cssVar('--fg-dim', '#8fb2c2'), amber: cssVar('--amber', '#ffb340'), squad: cssVar('--squad', '#8dff7a') };
  }

  update(w: HudWorld): void {
    const p = w.player;
    const team = p.team;
    const enemy: TeamId = team === 0 ? 1 : 0;
    this.drawCompass(w);
    // Objective row.
    if (this.objs.length !== w.zones.length) {
      this.objRow.textContent = '';
      this.objs = w.zones.map((z) => {
        const fill = h('i', { class: 'tb-ofill' });
        const letter = h('span', { class: 'display', text: z.id });
        const el = h('div', { class: 'tb-obj' }, fill, letter);
        this.objRow.append(el);
        return { el, fill, letter };
      });
    }
    w.zones.forEach((z, i) => this.updateObj(this.objs[i], z, team, p.pos.x, p.pos.z));
    // Tickets (or kills toward the target in Skirmish).
    const vals: [number, number] = w.tickets ? [w.tickets[team], w.tickets[enemy]] : w.kills ? [w.kills[team], w.kills[enemy]] : [0, 0];
    const max = w.tickets ? w.ticketMax : w.killTarget;
    setText(this.tFriend.name, FACTIONS[team].short);
    setText(this.tFoe.name, FACTIONS[enemy].short);
    setText(this.tFriend.num, String(Math.ceil(vals[0])));
    setText(this.tFoe.num, String(Math.ceil(vals[1])));
    setStyle(this.tFriend.bar, 'width', `${Math.max(0, Math.min(100, (vals[0] / max) * 100)).toFixed(1)}%`);
    setStyle(this.tFoe.bar, 'width', `${Math.max(0, Math.min(100, (vals[1] / max) * 100)).toFixed(1)}%`);
    toggle(this.tFriend.bleed, 'on', !!w.tickets && w.bleed[team] > 0);
    toggle(this.tFoe.bleed, 'on', !!w.tickets && w.bleed[enemy] > 0);
    toggle(this.tFriend.num, 'low', !!w.tickets && vals[0] < max * 0.15);
    setText(this.mode, w.modeName);
    setText(this.clock, w.timeLeft !== null ? fmtTime(w.timeLeft) : fmtTime(w.roundT));
  }

  private updateObj(o: { el: HTMLDivElement; fill: HTMLElement; letter: HTMLElement }, z: ZoneState, team: TeamId, px: number, pz: number): void {
    const rel = z.owner === -1 ? 'neutral' : z.owner === team ? 'friend' : 'foe';
    o.el.className = `tb-obj ${rel}${z.contested ? ' contested' : ''}${Math.hypot(px - z.x, pz - z.z) < z.radius ? ' inside' : ''}`;
    // Fill shows control toward whoever is gaining it.
    const k = Math.abs(z.control);
    const toward: TeamId = z.control >= 0 ? 0 : 1;
    setStyle(o.fill, 'height', `${(k * 100).toFixed(1)}%`);
    setStyle(o.fill, 'background', toward === team ? 'var(--friend)' : 'var(--foe)');
    setStyle(o.fill, 'opacity', z.owner === -1 || z.capturing !== -1 ? '0.55' : '0.28');
  }

  private drawCompass(w: HudWorld): void {
    const c = this.compass;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = c.getBoundingClientRect();
    const W = Math.max(10, Math.round(r.width * dpr)), H = Math.max(10, Math.round(r.height * dpr));
    if (c.width !== W || c.height !== H) {
      c.width = W;
      c.height = H;
    }
    const ctx = this.cctx;
    ctx.clearRect(0, 0, W, H);
    const fov = TUNING.ui.compassFov;
    const head = bearingDeg(w.player.yaw);
    setText(this.bearing, String(Math.round(head) % 360).padStart(3, '0'));
    const pxPerDeg = W / fov;
    const x = (deg: number) => W / 2 + ((((deg - head + 540) % 360) - 180) * pxPerDeg);
    ctx.lineWidth = 1 * dpr;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const start = Math.floor((head - fov / 2) / 5) * 5;
    for (let d = start; d <= head + fov / 2 + 5; d += 5) {
      const deg = ((d % 360) + 360) % 360;
      const xx = x(deg);
      const edge = 1 - Math.min(1, Math.abs(xx - W / 2) / (W / 2));
      ctx.globalAlpha = 0.25 + 0.75 * edge;
      const major = deg % 15 === 0;
      ctx.strokeStyle = this.colors.dim;
      ctx.beginPath();
      ctx.moveTo(xx, 0);
      ctx.lineTo(xx, (major ? 8 : 4) * dpr);
      ctx.stroke();
      if (CARD[deg] !== undefined) {
        ctx.fillStyle = deg % 90 === 0 ? this.colors.fg : this.colors.dim;
        ctx.font = `700 ${(deg % 90 === 0 ? 14 : 11) * dpr}px Rajdhani, sans-serif`;
        ctx.fillText(CARD[deg], xx, 10 * dpr);
      } else if (major) {
        ctx.fillStyle = this.colors.dim;
        ctx.font = `500 ${9 * dpr}px "JetBrains Mono", monospace`;
        ctx.fillText(String(deg), xx, 11 * dpr);
      }
    }
    ctx.globalAlpha = 1;
    // Objective letters at their bearings.
    const p = w.player;
    const team = p.team;
    ctx.textBaseline = 'middle';
    for (const z of w.zones) {
      const deg = bearingDeg(Math.atan2(-(z.x - p.pos.x), -(z.z - p.pos.z)));
      const xx = x(deg);
      if (xx < -10 || xx > W + 10) continue;
      const col = z.owner === -1 ? this.colors.neutral : z.owner === team ? this.colors.friend : this.colors.foe;
      ctx.fillStyle = 'rgba(5,8,13,0.7)';
      ctx.strokeStyle = z.contested ? this.colors.amber : col;
      const s = 8 * dpr;
      const top = 26 * dpr;
      ctx.beginPath();
      ctx.rect(xx - s, top, 2 * s, 2 * s);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.font = `700 ${12 * dpr}px Rajdhani, sans-serif`;
      ctx.fillText(z.id, xx, top + s + 0.5 * dpr);
    }
    // Squad pings.
    for (const pg of w.pings) {
      if (pg.team !== team) continue;
      const deg = bearingDeg(Math.atan2(-(pg.pos.x - p.pos.x), -(pg.pos.z - p.pos.z)));
      const xx = x(deg);
      if (xx < 0 || xx > W) continue;
      ctx.fillStyle = pg.kind === 'enemy' ? this.colors.foe : pg.kind === 'medic' || pg.kind === 'ammo' ? this.colors.amber : this.colors.squad;
      ctx.beginPath();
      ctx.moveTo(xx, 24 * dpr);
      ctx.lineTo(xx + 4 * dpr, 18 * dpr);
      ctx.lineTo(xx - 4 * dpr, 18 * dpr);
      ctx.closePath();
      ctx.fill();
    }
  }
}
