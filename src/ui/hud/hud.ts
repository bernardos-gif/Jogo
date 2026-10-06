// In-match HUD root. Hosts every component (compass and objectives, tickets, minimap and squad,
// weapon panel, crosshair and hit markers, damage arcs, grenade warnings, capture ring, prompts,
// ammo cues, kill feed, score stack, banners, world markers, comms rose, scopes, attachment menu,
// scoreboard and full map) and routes gameplay events to them.
import { h, setText, toggle } from '../dom';
import { TUNING } from '../../config/tuning';
import { ZONES } from '../../config/content';
import { Crosshair } from './crosshair';
import { WeaponPanel, type GadgetView } from './weaponPanel';
import { AttachmentMenu } from './attachmentMenu';
import { ScopeOverlay } from './scope';
import { TopBar } from './topbar';
import { Minimap } from './minimap';
import { KillFeed, ScoreStack } from './feed';
import { Banners } from './banners';
import { DamageArcs, GrenadeWarnings, CaptureRing, Prompt, AmmoCue } from './indicators';
import { WorldMarkers } from './markers';
import { CommsRose } from './comms';
import { Tablet } from './tablet';
import { Scoreboard, type ScoreboardData } from '../screens/scoreboard';
import { FullMap } from '../screens/fullmap';
import type { HudWorld } from './types';
import type { Arsenal } from '../../weapons/arsenal';
import type { Soldier } from '../../player/soldier';
import type { EventBus } from '../../core/events';
import type { TacticalImage } from '../../render/tacticalMap';

export interface HudFrame {
  dt: number;
  player: Soldier;
  arsenal: Arsenal;
  spread: number;
  vfov: number;
  screenH: number;
  scoped: boolean;
  zoom: number;
  rangeM: number | null;
  enemyUnderCrosshair: boolean;
  gadget: GadgetView | null;
  time: number;
}

export class Hud {
  readonly root: HTMLDivElement;
  readonly crosshair: Crosshair;
  readonly weapon: WeaponPanel;
  readonly attachments: AttachmentMenu;
  readonly scope: ScopeOverlay;
  readonly topbar: TopBar;
  readonly minimap: Minimap;
  readonly killFeed: KillFeed;
  readonly scoreStack: ScoreStack;
  readonly banners: Banners;
  readonly arcs: DamageArcs;
  readonly grenades: GrenadeWarnings;
  readonly captureRing: CaptureRing;
  readonly prompt: Prompt;
  readonly ammoCue: AmmoCue;
  readonly markers: WorldMarkers;
  readonly comms: CommsRose;
  readonly tablet: Tablet;
  scoreboard: Scoreboard;
  fullMap: FullMap | null = null;
  /** Seconds left of the heavy-damage glitch. */
  glitchT = 0;
  /** Recent damage pulse (0..1) for the edge vignette. */
  hurt = 0;
  private readout: HTMLDivElement | null = null;
  private readoutRows = new Map<string, HTMLElement>();
  private unsub: (() => void)[] = [];
  private overlays: HTMLDivElement;
  private droneEl: HTMLDivElement;
  private droneBat: HTMLElement;
  private droneAlt: HTMLDivElement;

  constructor(parent: HTMLElement, events: EventBus, private player: () => Soldier) {
    this.root = h('div', { class: 'hud hidden' });
    parent.appendChild(this.root);
    this.markers = new WorldMarkers(this.root);
    this.scope = new ScopeOverlay(this.root);
    this.arcs = new DamageArcs(this.root);
    this.crosshair = new Crosshair(this.root);
    this.grenades = new GrenadeWarnings(this.root);
    this.captureRing = new CaptureRing(this.root);
    this.prompt = new Prompt(this.root);
    this.ammoCue = new AmmoCue(this.root);
    this.topbar = new TopBar(this.root);
    this.minimap = new Minimap(this.root);
    this.weapon = new WeaponPanel(this.root);
    this.killFeed = new KillFeed(this.root);
    this.scoreStack = new ScoreStack(this.root);
    this.banners = new Banners(this.root);
    this.attachments = new AttachmentMenu(this.root);
    this.comms = new CommsRose(this.root);
    this.tablet = new Tablet(this.root);
    this.droneBat = h('i');
    this.droneAlt = h('div', { class: 'num dr-alt' });
    this.droneEl = h(
      'div',
      { class: 'drone-hud hidden' },
      h('div', { class: 'dr-reticle' }),
      h('div', { class: 'dr-panel panel brackets' }, h('div', { class: 'display', text: 'Kestrel' }), h('div', { class: 'label', text: 'Battery' }), h('div', { class: 'bar seg' }, this.droneBat), this.droneAlt, h('div', { class: 'label dr-hint', text: 'Fire: spot · Space / Shift: climb / dive · Gadget: return' })),
    );
    this.root.appendChild(this.droneEl);
    // Overlays live outside the HUD root so they stay visible when the HUD hides.
    this.overlays = h('div', { class: 'hud-overlays' });
    parent.appendChild(this.overlays);
    this.scoreboard = new Scoreboard(this.overlays);

    this.unsub.push(
      events.on('hit', (e) => {
        if (e.attacker !== this.player()) return;
        this.crosshair.hit(e.kill || e.downed ? 'kill' : e.part === 'head' ? 'head' : e.armorBreak ? 'armor' : 'hit');
      }),
      events.on('kill', (e) => this.killFeed.push(e.killer, e.victim, e.weapon, e.headshot, this.player())),
      events.on('score', (e) => {
        if (e.soldier === this.player()) this.scoreStack.push(e.amount, e.reason);
      }),
      events.on('damaged', (e) => {
        const me = this.player();
        if (e.victim !== me || e.amount <= 0) return;
        this.arcs.push(e.attacker && e.attacker !== me ? e.attacker.pos : e.from, e.amount);
        this.hurt = Math.min(1, this.hurt + e.amount / 50);
        if (e.amount >= TUNING.ui.glitchDamage) this.glitchT = TUNING.ui.glitch;
      }),
      events.on('capture', (e) => {
        const me = this.player();
        const name = ZONES[e.zone].name;
        if (e.neutralized) {
          if (e.team === me.team) this.banners.push(`Sector ${e.zone} neutralized`, name, 'good');
          else this.banners.push(`Sector ${e.zone} lost`, name, 'bad');
        } else if (e.team === me.team) this.banners.push(`Sector ${e.zone} captured`, name, 'good');
        else this.banners.push(`Sector ${e.zone} taken by the enemy`, name, 'bad');
      }),
      events.on('announce', (e) => this.banners.push(e.text, e.sub ?? '', e.tone)),
    );
  }

  /** Gives the HUD the tactical map image (minimap background and the full map). */
  setMap(image: TacticalImage): void {
    this.fullMap = new FullMap(this.overlays, image);
  }

  refreshPalette(): void {
    this.topbar.refreshPalette();
    this.minimap.refreshPalette();
  }

  /** Optional key/value readout panel (training range). */
  setReadout(title: string, rows: string[]): void {
    if (!this.readout) {
      this.readout = h('div', { class: 'range-readout panel brackets scan-in' });
      this.root.appendChild(this.readout);
    }
    this.readout.textContent = '';
    this.readout.append(h('div', { class: 'display', text: title }));
    this.readoutRows.clear();
    for (const r of rows) {
      const v = h('div', { class: 'num', text: '-' });
      this.readout.append(h('div', { class: 'label', text: r }), v);
      this.readoutRows.set(r, v);
    }
  }

  setReadoutValue(row: string, value: string): void {
    const el = this.readoutRows.get(row);
    if (el) setText(el, value);
  }

  update(f: HudFrame, w: HudWorld | null): void {
    const p = f.player;
    this.glitchT = Math.max(0, this.glitchT - f.dt);
    this.hurt = Math.max(0, this.hurt - f.dt * 0.9);
    toggle(this.root, 'glitch', this.glitchT > 0);
    // Feeds, banners and overlays run even while dead.
    this.killFeed.update(f.dt);
    this.scoreStack.update(f.dt);
    this.banners.update(f.dt);
    if (w) {
      this.fullMap?.update(f.dt, w);
      this.topbar.update(w);
    }
    const visible = p.alive;
    this.root.classList.toggle('hidden', !visible);
    if (!visible) return;
    toggle(this.root, 'downed', p.downed);
    const dr = w?.drone ?? null;
    toggle(this.root, 'piloting', !!dr);
    toggle(this.droneEl, 'hidden', !dr);
    if (dr) {
      this.droneBat.style.width = `${(dr.battery * 100).toFixed(0)}%`;
      setText(this.droneAlt, `ALT ${Math.round(dr.altitude)} m · HULL ${Math.round(dr.hp * 100)}%`);
    }
    const wpn = f.arsenal.current;
    this.scope.update(f.scoped, wpn.att.sight, f.zoom, f.rangeM, f.time);
    this.crosshair.update(f.dt, f.spread, f.vfov, f.screenH, wpn.stats.category, f.arsenal.adsK, !f.scoped && !this.attachments.open && !this.comms.open && !this.tablet.open && p.active, f.enemyUnderCrosshair);
    this.weapon.update(p, f.arsenal, f.gadget);
    this.arcs.update(f.dt, p);
    this.ammoCue.update(p, f.arsenal);
    if (w) {
      this.minimap.update(f.dt, w);
      this.markers.update(f.dt, w);
      this.grenades.update(w);
      this.captureRing.update(w);
      this.prompt.update(w);
    }
  }

  updateScoreboard(dt: number, d: ScoreboardData | null): void {
    if (d) this.scoreboard.update(dt, d);
  }

  clearTransient(): void {
    this.killFeed.clear();
    this.scoreStack.clear();
    this.banners.clear();
    this.arcs.clear();
  }

  dispose(): void {
    for (const u of this.unsub) u();
    this.root.remove();
    this.overlays.remove();
  }
}
