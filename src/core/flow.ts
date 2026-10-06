// Match flow for the player: deploy screen -> playing -> downed (kill card, give up, revive) or
// kill cam -> deploy screen ... -> end of round (winner, MVPs, stats, XP) -> next round.
// Autoplay runs the same flow with automatic choices so automated tests exercise every screen.
import * as THREE from 'three';
import { TUNING } from '../config/tuning';
import { FACTIONS, WEAPON_BY_ID, type TeamId, type WeaponId } from '../config/content';
import { flags } from './flags';
import { input } from './input';
import { save } from './save';
import { killSoldier } from '../weapons/damage';
import { DeployScreen, type DeployContext } from '../ui/screens/deploy';
import { KillCard, type KillInfo } from '../ui/screens/killcam';
import { EndRoundScreen, type EndRoundData } from '../ui/screens/endRound';
import { levelFor, roundXp } from '../net-sim/progression';
import { yawOf } from './math';
import type { Battle } from '../modes/battle';
import type { SectorMode } from '../modes/sector/sectorMode';
import type { Soldier } from '../player/soldier';
import type { TacticalImage } from '../render/tacticalMap';
import type { MapUnit } from '../ui/tacmap';

const S = TUNING.sector;

export type FlowState = 'deploy' | 'playing' | 'downed' | 'killcam' | 'end';

const _v = new THREE.Vector3();
const _look = new THREE.Vector3();

export class MatchFlow {
  state: FlowState = 'deploy';
  readonly deploy: DeployScreen;
  readonly killCard: KillCard;
  readonly endScreen: EndRoundScreen;
  private t = 0;
  private kill: KillInfo | null = null;
  private killer: Soldier | null = null;
  private deathPos = new THREE.Vector3();
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private camInit = false;
  private orbit = 0;
  private endData: EndRoundData | null = null;
  private off: (() => void)[] = [];
  /** Called when the flow wants gameplay input (true) or menus (false). */
  onGameplay: ((on: boolean) => void) | null = null;

  constructor(
    private b: Battle,
    private mode: SectorMode,
    ui: HTMLElement,
    image: TacticalImage,
  ) {
    this.deploy = new DeployScreen(ui, image);
    this.killCard = new KillCard(ui);
    this.endScreen = new EndRoundScreen(ui);
    this.deploy.onDeploy = (opt) => {
      const p = this.b.player;
      const lo = save.data.loadouts[save.data.cls];
      this.b.applyLoadout(p, save.data.cls, lo.specialist, lo.primary, lo.throwable);
      this.mode.deploy(p, opt);
      this.toPlaying();
    };
    this.endScreen.onContinue = () => this.nextRound();
    const p = b.player;
    this.off.push(
      b.events.on('kill', (e) => {
        if (e.victim === p) this.recordKill(e.killer, e.weapon, e.distance, e.headshot);
        if (e.killer === p && e.victim.team !== p.team) {
          const w = e.weapon as WeaponId;
          if (WEAPON_BY_ID[w])
            save.update((d) => {
              const m = (d.progression.mastery[w] ??= { kills: 0, headshots: 0 });
              m.kills++;
              if (e.headshot) m.headshots++;
            });
        }
      }),
      b.events.on('downed', (e) => {
        if (e.victim === p && this.state === 'playing') this.toDowned();
      }),
      b.events.on('death', (e) => {
        if (e.victim !== p) return;
        if (this.state === 'downed') {
          this.killCard.setDead();
          this.state = 'killcam';
          this.t = S.killcamSeconds - S.deathToDeploy;
        } else if (this.state === 'playing') this.toKillcam();
      }),
    );
  }

  start(): void {
    this.toDeploy();
  }

  private recordKill(killer: Soldier | null, weapon: string, distance: number, headshot: boolean): void {
    this.killer = killer;
    this.deathPos.copy(this.b.player.pos);
    const wname = WEAPON_BY_ID[weapon as WeaponId]?.name ?? weapon;
    this.kill = { killer: killer?.name ?? null, killerClass: killer?.cls ?? null, weapon: wname, distance, headshot, killerHealth: killer ? killer.health / 100 : null };
  }

  // ---- Transitions -----------------------------------------------------------------------------
  private toDeploy(): void {
    this.state = 'deploy';
    this.t = 0;
    this.killCard.hide();
    this.endScreen.hide();
    this.deploy.show();
    this.camInit = false;
    this.b.cameraOverride = (cam, dt) => this.overviewCam(cam, dt);
    this.onGameplay?.(false);
  }

  private toPlaying(): void {
    this.state = 'playing';
    this.deploy.hide();
    this.killCard.hide();
    this.b.cameraOverride = null;
    this.onGameplay?.(true);
  }

  private toDowned(): void {
    this.state = 'downed';
    this.t = 0;
    if (!this.kill) this.recordKill(null, 'Unknown', 0, false);
    this.killCard.show(this.kill!, true);
  }

  private toKillcam(): void {
    this.state = 'killcam';
    this.t = 0;
    if (!this.kill) this.recordKill(null, 'Unknown', 0, false);
    this.killCard.show(this.kill!, false);
    this.camInit = false;
    this.b.cameraOverride = (cam, dt) => this.killerCam(cam, dt);
    this.onGameplay?.(false);
  }

  private toEnd(): void {
    this.state = 'end';
    this.t = 0;
    this.deploy.hide();
    this.killCard.hide();
    this.endData = this.buildEndData();
    this.applyProgression();
    this.endScreen.show(this.endData);
    this.camInit = false;
    this.b.cameraOverride = (cam, dt) => this.overviewCam(cam, dt, true);
    this.onGameplay?.(false);
  }

  private nextRound(): void {
    if (this.state !== 'end') return;
    this.mode.restart();
    this.kill = null;
    this.killer = null;
    this.toDeploy();
  }

  // ---- Per frame -------------------------------------------------------------------------------
  frame(dt: number): void {
    this.t += dt;
    const p = this.b.player;
    if (this.mode.state === 'ended' && this.state !== 'end') {
      // Victory / defeat banner first, then the screen.
      if (this.mode.endT >= S.endBannerSeconds) this.toEnd();
    }
    switch (this.state) {
      case 'deploy': {
        const c = this.deployContext();
        this.deploy.update(dt, c);
        if (flags.autoplay && c.respawnLeft <= 0 && this.t > S.autoDeployDelay) this.deploy.tryDeploy();
        break;
      }
      case 'playing':
        if (!p.alive) this.toKillcam();
        else if (p.downed) this.toDowned();
        break;
      case 'downed': {
        if (p.alive && !p.downed) {
          this.killCard.hide();
          this.kill = null;
          this.state = 'playing';
          break;
        }
        const H = TUNING.health;
        const reviver = p.reviverId >= 0 ? this.b.soldierById(p.reviverId) : null;
        let text = 'No medic nearby';
        if (reviver) text = `${reviver.name} is reviving you · ${Math.round(p.reviveProgress * 100)}%`;
        else {
          let best: Soldier | null = null;
          let bd = S.medicHintRange;
          for (const s of this.b.soldiers)
            if (s.team === p.team && s !== p && s.active && s.cls === 'support') {
              const d = s.pos.distanceTo(p.pos);
              if (d < bd) {
                bd = d;
                best = s;
              }
            }
          if (best) text = `Medic ${best.name} · ${Math.round(bd)} m`;
        }
        const hold = input.heldFor('interact');
        this.killCard.updateDowned(Math.max(0, p.downedT / H.downedSeconds), p.downedT, text, Math.min(1, hold / S.giveUpHold));
        if (hold >= S.giveUpHold) killSoldier(this.b, p);
        break;
      }
      case 'killcam':
        if (this.t >= S.killcamSeconds) this.toDeploy();
        break;
      case 'end': {
        const left = S.endScreenSeconds - this.t;
        this.endScreen.setAuto(flags.autoplay ? Math.max(0, left) : null);
        if (flags.autoplay && left <= 0) this.nextRound();
        break;
      }
    }
  }

  /** True while a full-screen flow screen owns the mouse. */
  get menuOpen(): boolean {
    return this.state === 'deploy' || this.state === 'end';
  }

  // ---- Deploy data -----------------------------------------------------------------------------
  private deployContext(): DeployContext {
    const b = this.b;
    const p = b.player;
    const sq = b.ai.squadOf(p);
    const units: MapUnit[] = [];
    for (const s of b.soldiers) {
      if (!s.alive || s === p) continue;
      if (s.team === p.team) units.push({ x: s.pos.x, z: s.pos.z, yaw: s.yaw, kind: sq && s.squadId === sq.id ? 'squad' : 'friend' });
      else if (s.spottedUntil > b.time && s.spottedByTeam === p.team) units.push({ x: s.pos.x, z: s.pos.z, yaw: s.yaw, kind: 'enemy' });
    }
    return {
      player: p,
      squadName: sq?.name ?? '—',
      squad: sq?.members ?? [p],
      zones: this.mode.zones,
      tickets: this.mode.tickets.tickets,
      hqs: (b.map.hqs ?? []).map((hq) => ({ team: hq.team, x: hq.center.x, z: hq.center.z })),
      limit: TUNING.movement.mapLimit,
      roundT: this.mode.roundT,
      options: this.mode.options(p),
      respawnLeft: Math.max(0, S.respawnDelay - p.deadT),
      units,
      time: b.time,
    };
  }

  // ---- Cameras ---------------------------------------------------------------------------------
  /** Slow orbit above the selected spawn (or the map center at the end of a round). */
  private overviewCam(cam: THREE.PerspectiveCamera, dt: number, center = false): void {
    const C = S.overviewCam;
    let target: THREE.Vector3;
    if (center) target = _v.set(0, 0, 0);
    else {
      const opt = this.deploy.selectedOption();
      target = opt ? _v.copy(opt.pos) : _v.copy(this.mode.hqCenter(this.b.player.team));
    }
    target.y = this.b.terrain.heightAt(target.x, target.z);
    this.orbit += dt * C.orbit;
    const dist = center ? C.distance * 4 : C.distance;
    const hgt = center ? C.height * 3 : C.height;
    const want = _look.set(target.x + Math.sin(this.orbit) * dist, target.y + hgt, target.z + Math.cos(this.orbit) * dist);
    if (!this.camInit) {
      this.camPos.copy(want);
      this.camLook.copy(target);
      this.camInit = true;
    }
    const k = 1 - Math.exp(-C.lerp * dt);
    this.camPos.lerp(want, k);
    this.camLook.lerp(target, k);
    cam.position.copy(this.camPos);
    cam.lookAt(this.camLook);
  }

  /** From where the player fell, turn to face the killer. */
  private killerCam(cam: THREE.PerspectiveCamera, dt: number): void {
    const eye = _v.copy(this.deathPos);
    eye.y += 1.2;
    const k = this.killer;
    const target = k && k.alive ? _look.copy(k.pos).setY(k.pos.y + 1.3) : _look.copy(eye).add(new THREE.Vector3(0, -0.5, -4));
    if (!this.camInit) {
      this.camPos.copy(eye);
      this.camLook.copy(eye).add(new THREE.Vector3(Math.sin(this.b.player.yaw) * -4, 0, Math.cos(this.b.player.yaw) * -4));
      this.camInit = true;
    }
    // Pull back a little behind the death point, away from the killer.
    const dx = target.x - eye.x, dz = target.z - eye.z;
    const yaw = yawOf(dx, dz);
    const back = new THREE.Vector3(Math.sin(yaw) * 2.2, 0.8, Math.cos(yaw) * 2.2);
    const k2 = 1 - Math.exp(-4 * dt);
    this.camPos.lerp(eye.clone().add(back), k2);
    this.camLook.lerp(target, k2);
    cam.position.copy(this.camPos);
    cam.lookAt(this.camLook);
  }

  // ---- End of round ----------------------------------------------------------------------------
  private buildEndData(): EndRoundData {
    const b = this.b;
    const p = b.player;
    const team = p.team;
    const enemy: TeamId = team === 0 ? 1 : 0;
    const won = this.mode.winner === team;
    const all = b.soldiers.filter((s) => !s.dummy);
    const top = (key: keyof Soldier['stats'], title: string, unit = '') => {
      let best: Soldier | null = null;
      for (const s of all) if (s.stats[key] > 0 && (!best || s.stats[key] > best.stats[key])) best = s;
      return best ? { title, name: best.name, value: `${best.stats[key]}${unit}`, friendly: best.team === team } : null;
    };
    const mvps = [top('score', 'MVP', ' pts'), top('kills', 'Most kills'), top('revives', 'Lifesaver'), top('captures', 'Sector taker'), top('spots', 'Eyes on')].filter((m): m is NonNullable<typeof m> => !!m);
    const st = p.stats;
    const xpGain = roundXp(st.score, won, true);
    const before = levelFor(save.data.progression.xp);
    const after = levelFor(save.data.progression.xp + xpGain);
    return {
      won,
      title: won ? 'Victory' : 'Defeat',
      sub: `${FACTIONS[this.mode.winner === -1 ? team : (this.mode.winner as TeamId)].name} holds Breakwater`,
      tickets: [Math.ceil(this.mode.tickets.tickets[team]), Math.ceil(this.mode.tickets.tickets[enemy])],
      teamNames: [FACTIONS[team].name, FACTIONS[enemy].name],
      duration: this.mode.roundT,
      mvps,
      personal: [
        { label: 'Score', value: st.score },
        { label: 'Kills', value: st.kills },
        { label: 'Deaths', value: st.deaths },
        { label: 'Assists', value: st.assists },
        { label: 'Revives', value: st.revives },
        { label: 'Captures', value: st.captures },
        { label: 'Spots', value: st.spots },
        { label: 'Headshots', value: st.headshots },
      ],
      xp: {
        gained: xpGain,
        levelBefore: before.level,
        levelAfter: after.level,
        into: after.into,
        need: after.need,
        lines: [
          { label: 'Round score', value: Math.round(st.score * TUNING.progression.xpPerScore) },
          { label: won ? 'Victory bonus' : 'Victory bonus (none)', value: won ? TUNING.progression.winBonus : 0 },
          { label: 'Completion', value: TUNING.progression.completionBonus },
          { label: 'Total', value: xpGain },
        ],
      },
    };
  }

  private applyProgression(): void {
    const d = this.endData;
    if (!d) return;
    const p = this.b.player;
    save.update((s) => {
      s.progression.xp += d.xp.gained;
      s.progression.matches++;
      if (d.won) s.progression.wins++;
      s.progression.kills += p.stats.kills;
      s.progression.deaths += p.stats.deaths;
    });
  }

  dispose(): void {
    for (const f of this.off) f();
    this.off.length = 0;
  }
}
