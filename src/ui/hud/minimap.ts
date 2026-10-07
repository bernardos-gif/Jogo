// Bottom-left minimap: the holographic map rotating with the player's heading, teammates, squad,
// spotted enemies, gunfire blips (unsuppressed enemy fire), objectives (clamped to the edge when
// out of range), pings and hazard zones; and the squad list with health, class and status.
import { h, setText, setStyle, clear } from '../dom';
import { TUNING } from '../../config/tuning';
import { CLASS_ICONS } from '../icons';
import type { HudWorld } from './types';
import type { Soldier } from '../../player/soldier';

function cssVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export class Minimap {
  readonly el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private squadEl: HTMLDivElement;
  private rows = new Map<number, { el: HTMLDivElement; bar: HTMLElement; name: HTMLElement; status: HTMLElement; icon: HTMLElement }>();
  private squadTitle: HTMLDivElement;
  private drawT = 0;
  /** Zoomed in (vehicle off) or out. */
  zoomed = false;
  private c = { friend: '#3fd7ff', foe: '#ff4458', squad: '#8dff7a', neutral: '#c8d2dc', amber: '#ffb340', fg: '#e4f7ff' };

  constructor(parent: HTMLElement) {
    this.canvas = h('canvas', { class: 'mm-canvas' });
    this.ctx = this.canvas.getContext('2d')!;
    this.squadTitle = h('div', { class: 'label mm-squad-title' });
    this.squadEl = h('div', { class: 'mm-squad' });
    this.el = h('div', { class: 'minimap-wrap' }, h('div', { class: 'squad-list' }, this.squadTitle, this.squadEl), h('div', { class: 'minimap panel brackets' }, this.canvas, h('div', { class: 'mm-north label', text: 'N' })));
    parent.appendChild(this.el);
    this.refreshPalette();
  }

  refreshPalette(): void {
    this.c = { friend: cssVar('--friend', '#3fd7ff'), foe: cssVar('--foe', '#ff4458'), squad: cssVar('--squad', '#8dff7a'), neutral: cssVar('--neutral', '#c8d2dc'), amber: cssVar('--amber', '#ffb340'), fg: cssVar('--fg', '#e4f7ff') };
  }

  update(dt: number, w: HudWorld): void {
    this.drawT -= dt;
    if (this.drawT > 0) return;
    this.drawT = 1 / TUNING.ui.minimapRate;
    this.draw(w);
    this.updateSquad(w);
  }

  private draw(w: HudWorld): void {
    const cv = this.canvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = cv.getBoundingClientRect();
    const W = Math.max(16, Math.round(r.width * dpr)), H = Math.max(16, Math.round(r.height * dpr));
    if (cv.width !== W || cv.height !== H) {
      cv.width = W;
      cv.height = H;
    }
    const ctx = this.ctx;
    const p = w.player;
    const radius = this.zoomed ? TUNING.ui.minimapZoomedRadius : TUNING.ui.minimapRadius;
    const s = Math.min(W, H) / 2 / radius;
    const yaw = p.yaw;
    const team = p.team;
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.clip();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(yaw);
    const px = p.pos.x, pz = p.pos.z;
    const at = (x: number, z: number): [number, number] => [(x - px) * s, (z - pz) * s];
    if (w.map) {
      const ws = w.map.worldSize;
      const [ix, iz] = at(-ws / 2, -ws / 2);
      ctx.globalAlpha = 0.95;
      ctx.drawImage(w.map.canvas, ix, iz, ws * s, ws * s);
      ctx.globalAlpha = 1;
    }
    // Hazards.
    for (const hz of w.hazards) {
      const [u, v] = at(hz.x, hz.z);
      // Warning cone along the hazard's path.
      if (hz.dir !== undefined && hz.reach) {
        const fx = -Math.sin(hz.dir), fz = -Math.cos(hz.dir);
        const rx = -fz, rz = fx;
        const L = hz.reach * s, R0 = hz.r * s, R1 = hz.r * 1.6 * s;
        ctx.beginPath();
        ctx.moveTo(u + rx * R0, v + rz * R0);
        ctx.lineTo(u + fx * L + rx * R1, v + fz * L + rz * R1);
        ctx.lineTo(u + fx * L - rx * R1, v + fz * L - rz * R1);
        ctx.lineTo(u - rx * R0, v - rz * R0);
        ctx.closePath();
        const g = ctx.createLinearGradient(u, v, u + fx * L, v + fz * L);
        g.addColorStop(0, 'rgba(255,179,64,0.3)');
        g.addColorStop(1, 'rgba(255,179,64,0)');
        ctx.fillStyle = g;
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(u, v, hz.r * s, 0, Math.PI * 2);
      ctx.fillStyle = hz.danger ? 'rgba(255,68,88,0.2)' : 'rgba(255,179,64,0.16)';
      ctx.fill();
      ctx.strokeStyle = hz.danger ? this.c.foe : this.c.amber;
      ctx.lineWidth = 1.5 * dpr;
      ctx.setLineDash(hz.danger ? [] : [4 * dpr, 3 * dpr]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Objectives (drawn upright, clamped to the edge).
    const lim = Math.min(W, H) / 2 - 12 * dpr;
    for (const z of w.zones) {
      let [u, v] = at(z.x, z.z);
      const d = Math.hypot(u, v);
      const inside = d < lim;
      if (!inside) {
        u = (u / d) * lim;
        v = (v / d) * lim;
      }
      const col = z.owner === -1 ? this.c.neutral : z.owner === team ? this.c.friend : this.c.foe;
      if (inside) {
        ctx.beginPath();
        ctx.arc(u, v, z.radius * s, 0, Math.PI * 2);
        ctx.strokeStyle = col;
        ctx.globalAlpha = 0.6;
        ctx.lineWidth = 1 * dpr;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.save();
      ctx.translate(u, v);
      ctx.rotate(-yaw);
      ctx.fillStyle = 'rgba(5,8,13,0.8)';
      ctx.strokeStyle = z.contested ? this.c.amber : col;
      ctx.lineWidth = 1.2 * dpr;
      const b = 7 * dpr;
      ctx.fillRect(-b, -b, b * 2, b * 2);
      ctx.strokeRect(-b, -b, b * 2, b * 2);
      ctx.fillStyle = col;
      ctx.font = `700 ${11 * dpr}px Rajdhani, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(z.id, 0, 0.5 * dpr);
      ctx.restore();
    }
    // Vehicles: friendly and empty always, crewed enemy vehicles within earshot.
    for (const vh of w.vehicles) {
      const enemy = vh.team !== team && vh.crewed;
      if (enemy && Math.hypot(vh.x - px, vh.z - pz) > TUNING.ui.minimapVehicleRange) continue;
      const [u, v] = at(vh.x, vh.z);
      if (Math.abs(u) > W || Math.abs(v) > H) continue;
      ctx.save();
      ctx.translate(u, v);
      ctx.rotate(-vh.yaw);
      ctx.fillStyle = enemy ? this.c.foe : vh.crewed ? this.c.friend : 'rgba(200,210,220,0.7)';
      ctx.strokeStyle = 'rgba(5,8,13,0.85)';
      ctx.lineWidth = 1.5 * dpr;
      const k = dpr;
      ctx.beginPath();
      if (vh.aircraft) {
        ctx.moveTo(0, -8 * k);
        ctx.lineTo(7 * k, 3 * k);
        ctx.lineTo(2 * k, 2 * k);
        ctx.lineTo(0, 7 * k);
        ctx.lineTo(-2 * k, 2 * k);
        ctx.lineTo(-7 * k, 3 * k);
      } else {
        const hw = (vh.kind === 'basalt' ? 5 : 4) * k, hl = (vh.kind === 'basalt' ? 7 : 6) * k;
        ctx.moveTo(0, -hl - 2 * k);
        ctx.lineTo(hw, -hl + 2 * k);
        ctx.lineTo(hw, hl);
        ctx.lineTo(-hw, hl);
        ctx.lineTo(-hw, -hl + 2 * k);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.fill();
      ctx.restore();
    }
    // Soldiers.
    const time = w.time;
    for (const o of w.soldiers) {
      if (!o.alive || o === p || o.inVehicle) continue;
      const [u, v] = at(o.pos.x, o.pos.z);
      if (Math.abs(u) > W || Math.abs(v) > H) continue;
      if (o.team === team) {
        const sq = o.squadId === p.squadId && p.squadId >= 0;
        ctx.fillStyle = o.downed ? this.c.amber : sq ? this.c.squad : this.c.friend;
        ctx.save();
        ctx.translate(u, v);
        ctx.rotate(-o.yaw);
        const r2 = (sq ? 4 : 3) * dpr;
        ctx.beginPath();
        ctx.moveTo(0, -r2 * 1.3);
        ctx.lineTo(r2, r2);
        ctx.lineTo(-r2, r2);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      } else {
        const spotted = o.spottedUntil > time && o.spottedByTeam === team;
        const firing = o.firedUntil > time && !o.arsenal?.current.stats.suppressed;
        if (spotted) {
          ctx.fillStyle = this.c.foe;
          ctx.save();
          ctx.translate(u, v);
          ctx.rotate(Math.PI / 4);
          ctx.fillRect(-3 * dpr, -3 * dpr, 6 * dpr, 6 * dpr);
          ctx.restore();
        } else if (firing) {
          // Gunfire blip: a fading ring where an unsuppressed enemy is shooting.
          ctx.strokeStyle = this.c.foe;
          ctx.globalAlpha = 0.7;
          ctx.lineWidth = 1.5 * dpr;
          ctx.beginPath();
          ctx.arc(u, v, (4 + (time * 12) % 5) * dpr, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
    }
    // Pings.
    for (const pg of w.pings) {
      if (pg.team !== team) continue;
      const [u, v] = at(pg.pos.x, pg.pos.z);
      ctx.save();
      ctx.translate(u, v);
      ctx.rotate(-yaw);
      ctx.strokeStyle = pg.kind === 'enemy' ? this.c.foe : pg.kind === 'medic' || pg.kind === 'ammo' ? this.c.amber : this.c.squad;
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-4 * dpr, -8 * dpr);
      ctx.lineTo(4 * dpr, -8 * dpr);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
    // Player arrow at the center (always pointing up) and the view cone.
    ctx.save();
    ctx.translate(W / 2, H / 2);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 60 * dpr);
    g.addColorStop(0, 'rgba(228,247,255,0.16)');
    g.addColorStop(1, 'rgba(228,247,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 60 * dpr, -Math.PI / 2 - 0.6, -Math.PI / 2 + 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = this.c.fg;
    ctx.beginPath();
    ctx.moveTo(0, -7 * dpr);
    ctx.lineTo(5 * dpr, 6 * dpr);
    ctx.lineTo(0, 3 * dpr);
    ctx.lineTo(-5 * dpr, 6 * dpr);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // North marker position on the rim.
    const north = this.el.querySelector('.mm-north') as HTMLElement;
    const nr = 0.5 - 0.06;
    setStyle(north, 'left', `${(50 + Math.sin(yaw) * nr * 100).toFixed(1)}%`);
    setStyle(north, 'top', `${(50 - Math.cos(yaw) * nr * 100).toFixed(1)}%`);
  }

  private updateSquad(w: HudWorld): void {
    setText(this.squadTitle, `Squad · ${w.squadName}`);
    const seen = new Set<number>();
    for (const m of w.squad) {
      seen.add(m.id);
      let row = this.rows.get(m.id);
      if (!row) {
        const bar = h('i');
        const name = h('span', { class: 'sq-name' });
        const status = h('span', { class: 'sq-status label' });
        const icon = h('span', { class: 'sq-icon' });
        const el = h('div', { class: 'sq-row' }, icon, name, status, h('div', { class: 'bar' }, bar));
        row = { el, bar, name, status, icon };
        this.rows.set(m.id, row);
      }
      row.icon.innerHTML = CLASS_ICONS[m.cls];
      setText(row.name, m.name);
      const st = statusOf(m);
      setText(row.status, st);
      row.el.className = `sq-row ${st.toLowerCase()}${m.isPlayer ? ' you' : ''}`;
      setStyle(row.bar, 'width', `${m.alive && !m.downed ? Math.round(m.health) : 0}%`);
    }
    for (const [id, row] of this.rows)
      if (!seen.has(id)) {
        row.el.remove();
        this.rows.delete(id);
      }
    // Keep DOM order equal to the squad order.
    if (this.squadEl.childElementCount !== w.squad.length) {
      clear(this.squadEl);
      for (const m of w.squad) this.squadEl.append(this.rows.get(m.id)!.el);
    }
  }
}

function statusOf(m: Soldier): string {
  if (!m.alive) return 'Dead';
  if (m.downed) return 'Downed';
  if (m.inVehicle) return 'Vehicle';
  return '';
}
