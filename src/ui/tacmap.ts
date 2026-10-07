// Tactical map view: draws the holographic capture plus live overlays with Canvas 2D: the combat
// boundary, HQs, capture zones (owner, progress, contest), spawn points (hover and selection),
// squadmates, friendlies, spotted enemies and the player. Used by the deploy screen and full map.
import type { TacticalImage } from '../render/tacticalMap';
import type { ZoneState } from '../modes/sector/logic';
import type { SpawnOption } from '../modes/sector/spawns';
import type { TeamId } from '../config/content';

export interface MapUnit {
  x: number;
  z: number;
  yaw: number;
  kind: 'squad' | 'friend' | 'enemy' | 'player';
}

export interface TacMapState {
  team: TeamId;
  zones: readonly ZoneState[];
  hqs: readonly { team: TeamId; x: number; z: number }[];
  limit: number;
  spawns: readonly SpawnOption[];
  selected: string | null;
  units: readonly MapUnit[];
  time: number;
  /** Warning cone or circle (events), world meters. */
  hazards?: readonly { x: number; z: number; r: number; dir?: number; reach?: number; danger?: boolean }[];
}

interface Palette {
  friend: string;
  foe: string;
  squad: string;
  neutral: string;
  amber: string;
  fg: string;
  hair: string;
}

function readPalette(): Palette {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string, d: string) => cs.getPropertyValue(n).trim() || d;
  return { friend: v('--friend', '#3fd7ff'), foe: v('--foe', '#ff4458'), squad: v('--squad', '#8dff7a'), neutral: v('--neutral', '#c8d2dc'), amber: v('--amber', '#ffb340'), fg: v('--fg', '#e4f7ff'), hair: v('--hair-strong', 'rgba(190,240,255,0.55)') };
}

export class TacticalMapView {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  /** View window: center and side length in meters. */
  cx = 0;
  cz = 0;
  span: number;
  hover: string | null = null;
  onPick: ((key: string) => void) | null = null;
  private lastSpawns: readonly SpawnOption[] = [];
  private pal: Palette = readPalette();

  constructor(
    private image: TacticalImage,
    cls = 'tacmap',
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = cls;
    this.ctx = this.canvas.getContext('2d')!;
    this.span = image.worldSize;
    this.canvas.addEventListener('mousemove', (e) => {
      this.hover = this.pick(e.offsetX, e.offsetY);
      this.canvas.style.cursor = this.hover ? 'pointer' : 'default';
    });
    this.canvas.addEventListener('mouseleave', () => (this.hover = null));
    this.canvas.addEventListener('click', (e) => {
      const k = this.pick(e.offsetX, e.offsetY);
      if (k && this.onPick) this.onPick(k);
    });
  }

  refreshPalette(): void {
    this.pal = readPalette();
  }

  /** Matches the canvas backing store to its CSS size (device pixels). */
  private fit(): number {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(64, Math.round(r.width * dpr)), hgt = Math.max(64, Math.round(r.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== hgt) {
      this.canvas.width = w;
      this.canvas.height = hgt;
    }
    return dpr;
  }

  /** World (x, z) to canvas pixels. North (-Z) is up. */
  toPx(x: number, z: number): [number, number] {
    const s = Math.min(this.canvas.width, this.canvas.height) / this.span;
    return [this.canvas.width / 2 + (x - this.cx) * s, this.canvas.height / 2 + (z - this.cz) * s];
  }

  /** Spawn marker position (zone markers sit under the zone letter). */
  private spawnPx(sp: SpawnOption, dpr: number): [number, number] {
    const [u, v] = this.toPx(sp.pos.x, sp.pos.z);
    return sp.kind === 'zone' ? [u, v + 26 * dpr] : sp.kind === 'hq' ? [u, v - 24 * dpr] : [u, v];
  }

  private scale(): number {
    return Math.min(this.canvas.width, this.canvas.height) / this.span;
  }

  private pick(ox: number, oy: number): string | null {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const px = ox * dpr, py = oy * dpr;
    let best: string | null = null;
    let bd = 26 * dpr;
    for (const s of this.lastSpawns) {
      const [u, v] = this.spawnPx(s, dpr);
      const d = Math.hypot(u - px, v - py);
      if (d < bd) {
        bd = d;
        best = s.key;
      }
    }
    return best;
  }

  draw(st: TacMapState): void {
    const dpr = this.fit();
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    const P = this.pal;
    this.lastSpawns = st.spawns;
    ctx.clearRect(0, 0, W, H);
    // Base image.
    const s = this.scale();
    const img = this.image;
    const [ix, iy] = this.toPx(-img.worldSize / 2, -img.worldSize / 2);
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = 1;
    ctx.drawImage(img.canvas, ix, iy, img.worldSize * s, img.worldSize * s);

    // Combat boundary.
    ctx.save();
    ctx.setLineDash([6 * dpr, 6 * dpr]);
    ctx.strokeStyle = P.amber;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1 * dpr;
    const [lx, ly] = this.toPx(-st.limit, -st.limit);
    ctx.strokeRect(lx, ly, st.limit * 2 * s, st.limit * 2 * s);
    ctx.restore();

    // Hazards.
    if (st.hazards)
      for (const hz of st.hazards) {
        const [u, v] = this.toPx(hz.x, hz.z);
        if (hz.dir !== undefined && hz.reach) {
          // Warning cone along the hazard's path (corners in world space, then to pixels).
          const fx = -Math.sin(hz.dir), fz = -Math.cos(hz.dir);
          const rx = -fz, rz = fx;
          const ex = hz.x + fx * hz.reach, ez = hz.z + fz * hz.reach;
          const pts = [
            this.toPx(hz.x + rx * hz.r, hz.z + rz * hz.r),
            this.toPx(ex + rx * hz.r * 1.6, ez + rz * hz.r * 1.6),
            this.toPx(ex - rx * hz.r * 1.6, ez - rz * hz.r * 1.6),
            this.toPx(hz.x - rx * hz.r, hz.z - rz * hz.r),
          ];
          ctx.beginPath();
          ctx.moveTo(pts[0][0], pts[0][1]);
          for (const q of pts.slice(1)) ctx.lineTo(q[0], q[1]);
          ctx.closePath();
          const [eu, ev] = this.toPx(ex, ez);
          const g = ctx.createLinearGradient(u, v, eu, ev);
          g.addColorStop(0, 'rgba(255,179,64,0.32)');
          g.addColorStop(1, 'rgba(255,179,64,0)');
          ctx.fillStyle = g;
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(u, v, hz.r * s, 0, Math.PI * 2);
        ctx.fillStyle = hz.danger ? 'rgba(255,68,88,0.18)' : 'rgba(255,179,64,0.14)';
        ctx.fill();
        ctx.strokeStyle = hz.danger ? P.foe : P.amber;
        ctx.lineWidth = 1.5 * dpr;
        ctx.stroke();
      }

    const rel = (t: number) => (t === -1 ? P.neutral : t === st.team ? P.friend : P.foe);

    // HQs.
    ctx.font = `700 ${11 * dpr}px Rajdhani, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const hq of st.hqs) {
      const [u, v] = this.toPx(hq.x, hq.z);
      const c = rel(hq.team);
      const r = 13 * dpr;
      ctx.strokeStyle = c;
      ctx.lineWidth = 1.5 * dpr;
      ctx.fillStyle = 'rgba(5,8,13,0.7)';
      ctx.beginPath();
      ctx.rect(u - r, v - r * 0.75, r * 2, r * 1.5);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = c;
      ctx.fillText('HQ', u, v + 0.5 * dpr);
    }

    // Zones.
    for (const z of st.zones) {
      const [u, v] = this.toPx(z.x, z.z);
      const r = Math.max(14 * dpr, z.radius * s);
      const c = rel(z.owner);
      ctx.beginPath();
      ctx.arc(u, v, r, 0, Math.PI * 2);
      ctx.fillStyle = z.owner === -1 ? 'rgba(200,210,220,0.08)' : z.owner === st.team ? 'rgba(63,215,255,0.12)' : 'rgba(255,68,88,0.12)';
      ctx.fill();
      ctx.lineWidth = 1.5 * dpr;
      ctx.strokeStyle = c;
      ctx.globalAlpha = 0.85;
      ctx.stroke();
      ctx.globalAlpha = 1;
      // Control arc (toward whichever team holds the value).
      const k = Math.abs(z.control);
      if (k > 0.01 && k < 0.999) {
        const towards = z.control > 0 ? 0 : 1;
        ctx.beginPath();
        ctx.arc(u, v, r + 4 * dpr, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2);
        ctx.strokeStyle = towards === st.team ? P.friend : P.foe;
        ctx.lineWidth = 3 * dpr;
        ctx.stroke();
      }
      if (z.contested) {
        const pulse = 0.5 + 0.5 * Math.sin(st.time * 6);
        ctx.beginPath();
        ctx.arc(u, v, r + 8 * dpr, 0, Math.PI * 2);
        ctx.strokeStyle = P.amber;
        ctx.globalAlpha = 0.35 + pulse * 0.5;
        ctx.lineWidth = 1.5 * dpr;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.font = `700 ${20 * dpr}px Rajdhani, sans-serif`;
      ctx.fillStyle = c;
      ctx.fillText(z.id, u, v + 1 * dpr);
    }

    // Units.
    for (const m of st.units) {
      const [u, v] = this.toPx(m.x, m.z);
      ctx.save();
      ctx.translate(u, v);
      if (m.kind === 'enemy') {
        const r = 4 * dpr;
        ctx.fillStyle = P.foe;
        ctx.beginPath();
        ctx.moveTo(0, -r);
        ctx.lineTo(r, 0);
        ctx.lineTo(0, r);
        ctx.lineTo(-r, 0);
        ctx.closePath();
        ctx.fill();
      } else {
        // Heading chevron (yaw 0 faces north = up).
        ctx.rotate(-m.yaw);
        const r = (m.kind === 'player' ? 7 : 5) * dpr;
        ctx.fillStyle = m.kind === 'player' ? P.fg : m.kind === 'squad' ? P.squad : P.friend;
        ctx.beginPath();
        ctx.moveTo(0, -r);
        ctx.lineTo(r * 0.75, r * 0.8);
        ctx.lineTo(0, r * 0.35);
        ctx.lineTo(-r * 0.75, r * 0.8);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }

    // Spawn points.
    for (const sp of st.spawns) {
      const [u, v] = this.spawnPx(sp, dpr);
      const sel = sp.key === st.selected;
      const hov = sp.key === this.hover;
      const c = sp.kind === 'squad' ? P.squad : P.friend;
      const r = (sel ? 9 : 7) * dpr;
      ctx.save();
      ctx.translate(u, v);
      ctx.fillStyle = sel ? c : 'rgba(5,8,13,0.75)';
      ctx.strokeStyle = c;
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.lineTo(r, 0);
      ctx.lineTo(0, r);
      ctx.lineTo(-r, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      if (sel || hov) {
        // Corner brackets around the selected spawn.
        const b = 15 * dpr, a = 5 * dpr;
        ctx.strokeStyle = sel ? c : P.hair;
        ctx.lineWidth = 1 * dpr;
        ctx.beginPath();
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          ctx.moveTo(sx * b, sy * (b - a));
          ctx.lineTo(sx * b, sy * b);
          ctx.lineTo(sx * (b - a), sy * b);
        }
        ctx.stroke();
      }
      ctx.restore();
      if (sel || hov || sp.kind === 'squad') {
        ctx.font = `600 ${11 * dpr}px Rajdhani, sans-serif`;
        ctx.fillStyle = c;
        ctx.fillText(sp.kind === 'zone' ? `SECTOR ${sp.label}` : sp.label.toUpperCase(), u, v + 20 * dpr);
      }
    }
  }
}
