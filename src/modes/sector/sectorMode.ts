// Sector Control runtime: builds both rosters (the player plus bots), squads, zones and tickets;
// steps capture, bleed and deaths; respawns bots on their best spawn; ends and restarts rounds.
import * as THREE from 'three';
import { TUNING } from '../../config/tuning';
import { BOT_NAMES, SPECIALISTS, WEAPON_BY_ID, type ClassId, type TeamId, type ThrowableId, type WeaponId } from '../../config/content';
import { newZone, stepZone, stepTickets, onDeath, inZone, type ZoneState, type TicketState, type Owner } from './logic';
import { spawnOptions, type SpawnOption } from './spawns';
import { yawOf } from '../../core/math';
import { flags } from '../../core/flags';
import { save } from '../../core/save';
import { killSoldier } from '../../weapons/damage';
import { Scoring } from '../../net-sim/scoring';
import type { Battle } from '../battle';
import type { BattleMode } from '../mode';
import type { Soldier } from '../../player/soldier';
import type { AttachmentSet } from '../../art/weaponModels';

const S = TUNING.sector;
const _v = new THREE.Vector3();

export type RoundState = 'playing' | 'ended';

function startTickets(): number {
  return flags.tickets ?? S.tickets;
}

export class SectorMode implements BattleMode {
  readonly id = 'sector';
  zones: ZoneState[] = [];
  readonly tickets: TicketState = { tickets: [startTickets(), startTickets()] };
  state: RoundState = 'playing';
  winner: Owner = -1;
  endT = 0;
  roundT = 0;
  rounds = 0;
  teamSize: number;
  /** Without a deploy screen (tests, dev scenes) the mode deploys the player itself. */
  autoDeployPlayer = true;
  /** Without an end-of-round screen the mode restarts rounds itself. */
  autoRestart = true;
  private b!: Battle;
  private off: (() => void)[] = [];
  private scoring: Scoring | null = null;

  constructor(opts: { teamSize?: number; managedPlayer?: boolean } = {}) {
    const n = opts.teamSize ?? flags.bots ?? save.settings.teamSize;
    this.teamSize = Math.max(S.teamSizeMin, Math.min(S.teamSizeMax, Math.round(n)));
    if (opts.managedPlayer) {
      this.autoDeployPlayer = false;
      this.autoRestart = false;
    }
  }

  setup(b: Battle): void {
    this.b = b;
    const defs = b.map.zones ?? [];
    this.zones = defs.map((d) => newZone(d.id, d.center.x, d.center.z, d.radius));
    this.buildRoster();
    b.ai.buildSquads();
    b.ai.objectives = () => ({ zones: this.zones, tickets: this.tickets.tickets });
    this.scoring = new Scoring(b.events, () => this.zones);
    this.off.push(
      b.events.on('death', (e) => {
        if (this.state !== 'playing') return;
        if (onDeath(this.tickets, e.victim.team) !== -1) this.end();
      }),
    );
    this.deployAll();
  }

  dispose(): void {
    this.scoring?.dispose();
    for (const f of this.off) f();
    this.off.length = 0;
  }

  // ---- Roster ----------------------------------------------------------------------------------
  private buildRoster(): void {
    const b = this.b;
    const L = TUNING.ai.loadout;
    let nameIdx = Math.floor(b.rng.next() * BOT_NAMES.length);
    for (const team of [0, 1] as TeamId[]) {
      const count = team === 0 ? this.teamSize - 1 : this.teamSize;
      for (let i = 0; i < count; i++) {
        const cls = this.pickClass();
        const specs = SPECIALISTS.filter((s) => s.cls === cls);
        const spec = specs[Math.floor(b.rng.next() * specs.length)].id;
        const pool = L.weapons[cls] as WeaponId[];
        const primary = pool[Math.floor(b.rng.next() * pool.length)];
        const tpool = L.throwables[cls] as ThrowableId[];
        const throwable = tpool[Math.floor(b.rng.next() * tpool.length)];
        const name = BOT_NAMES[nameIdx++ % BOT_NAMES.length];
        const s = b.addSoldier(team, name, cls, spec, primary, throwable);
        // Random attachments for variety.
        const info = WEAPON_BY_ID[primary];
        const roll = <T,>(opts: readonly T[], def: T) => (b.rng.next() < L.attachmentRandom ? opts[Math.floor(b.rng.next() * opts.length)] : def);
        const cur = s.arsenal.slots[0].att;
        const att: AttachmentSet = { sight: roll(info.sights, cur.sight), barrel: roll(info.barrels, cur.barrel), underbarrel: roll(info.underbarrels, cur.underbarrel), ammo: roll(info.ammos, cur.ammo) };
        s.arsenal.slots[0].setAttachments(att);
        s.arsenal.slots[0].refill();
        b.ai.addBot(s);
      }
    }
    if (flags.autoplay) b.ai.addBot(b.player);
  }

  private pickClass(): ClassId {
    const w = TUNING.ai.loadout.classWeights;
    let r = this.b.rng.next() * (w.assault + w.engineer + w.support + w.recon);
    for (const c of ['assault', 'engineer', 'support', 'recon'] as ClassId[]) {
      r -= w[c];
      if (r <= 0) return c;
    }
    return 'assault';
  }

  // ---- Spawning --------------------------------------------------------------------------------
  hqCenter(team: TeamId): THREE.Vector3 {
    const hq = this.b.map.hqs?.find((h) => h.team === team);
    return hq ? hq.center : this.b.map.spawn;
  }

  options(s: Soldier): SpawnOption[] {
    const sq = this.b.ai.squadOf(s);
    return spawnOptions(s.team, this.zones, this.hqCenter(s.team), sq ? sq.members : [], s, this.b.soldiers, this.b.time);
  }

  /** World position and facing for a spawn option. */
  spawnPoint(opt: SpawnOption, team: TeamId, out: THREE.Vector3): number {
    const b = this.b;
    const rng = b.rng;
    const enemyHq = this.hqCenter(team === 0 ? 1 : 0);
    if (opt.kind === 'squad' && opt.mate) {
      const m = opt.mate;
      out.set(m.pos.x + Math.sin(m.yaw) * 1.4, m.pos.y + 0.2, m.pos.z + Math.cos(m.yaw) * 1.4);
      if (!b.nav || !b.nav.closest(out, out)) out.copy(m.pos);
      return m.yaw;
    }
    if (opt.kind === 'zone') {
      // Ring around the zone, on the side facing our HQ.
      const own = this.hqCenter(team);
      const base = Math.atan2(own.x - opt.pos.x, own.z - opt.pos.z);
      const a = base + rng.range(-1.2, 1.2);
      const d = rng.range(S.zoneSpawnMinRadius, S.zoneSpawnMaxRadius);
      out.set(opt.pos.x + Math.sin(a) * d, 0, opt.pos.z + Math.cos(a) * d);
    } else {
      const a = rng.next() * Math.PI * 2, d = Math.sqrt(rng.next()) * S.hqSpawnRadius;
      out.set(opt.pos.x + Math.cos(a) * d, 0, opt.pos.z + Math.sin(a) * d);
    }
    out.y = b.terrain.heightAt(out.x, out.z) + 1;
    if (b.nav) b.nav.closest(out, out);
    out.y += 0.1;
    return yawOf(enemyHq.x - out.x, enemyHq.z - out.z);
  }

  /** Bot spawn choice: the owned zone nearest the squad's objective, a squadmate, or HQ. */
  private chooseBotSpawn(s: Soldier): SpawnOption {
    const opts = this.options(s);
    const sq = this.b.ai.squadOf(s);
    const goal = sq?.order.zone ? sq.order.pos : null;
    const mates = opts.filter((o) => o.kind === 'squad');
    if (mates.length && this.b.rng.next() < TUNING.ai.squad.squadSpawnChance) return mates[Math.floor(this.b.rng.next() * mates.length)];
    let best = opts[0];
    let bd = goal ? Math.hypot(best.pos.x - goal.x, best.pos.z - goal.z) : Infinity;
    for (const o of opts) {
      if (o.kind !== 'zone') continue;
      const d = goal ? Math.hypot(o.pos.x - goal.x, o.pos.z - goal.z) : this.b.rng.next() * 500;
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    return best;
  }

  deploy(s: Soldier, opt: SpawnOption): void {
    const yaw = this.spawnPoint(opt, s.team, _v);
    this.b.respawn(s, _v, yaw);
    s.spawnProtectT = S.spawnProtect;
    this.b.ai.brain(s)?.reset(this.b.ai);
    this.b.events.emit('spawn', { soldier: s });
  }

  private deployAll(): void {
    for (const s of this.b.soldiers) {
      if (s.dummy) continue;
      if (s.isPlayer && !this.autoDeployPlayer) {
        this.b.park(s, this.hqCenter(s.team));
        continue;
      }
      this.deploy(s, { kind: 'hq', key: 'hq', label: 'HQ', pos: this.hqCenter(s.team).clone() });
    }
  }

  // ---- Round flow ------------------------------------------------------------------------------
  private end(): void {
    if (this.state === 'ended') return;
    const loser = this.tickets.tickets[0] <= 0 ? 0 : 1;
    this.winner = loser === 0 ? 1 : 0;
    this.state = 'ended';
    this.endT = 0;
    this.b.events.emit('announce', { text: this.winner === this.b.player.team ? 'Victory' : 'Defeat', sub: 'Sector Control', tone: this.winner === this.b.player.team ? 'good' : 'bad' });
  }

  restart(): void {
    this.rounds++;
    this.state = 'playing';
    this.winner = -1;
    this.roundT = 0;
    this.tickets.tickets[0] = startTickets();
    this.tickets.tickets[1] = startTickets();
    for (const z of this.zones) {
      z.owner = -1;
      z.control = 0;
      z.contested = false;
      z.capturing = -1;
    }
    this.b.resetWorld();
    for (const s of this.b.soldiers) {
      for (const k of Object.keys(s.stats) as (keyof typeof s.stats)[]) s.stats[k] = 0;
    }
    this.deployAll();
  }

  update(dt: number): void {
    const b = this.b;
    if (this.state === 'ended') {
      this.endT += dt;
      if (this.endT > S.endScreenSeconds && this.autoRestart) this.restart();
      return;
    }
    this.roundT += dt;
    // Capture.
    for (const z of this.zones) {
      const counts: [number, number] = [0, 0];
      for (const s of b.soldiers) if (s.active && !s.dummy && inZone(z, s.pos.x, s.pos.z) && Math.abs(s.pos.y - b.terrain.heightAt(z.x, z.z)) < 40) counts[s.team]++;
      const ev = stepZone(z, counts, dt);
      if (ev) {
        b.events.emit('capture', { zone: z.id, team: ev.team, neutralized: ev.kind === 'neutralized' });
        const sc = ev.kind === 'captured' ? TUNING.sector.score.capture : TUNING.sector.score.neutralize;
        for (const s of b.soldiers)
          if (s.team === ev.team && s.active && inZone(z, s.pos.x, s.pos.z)) {
            s.stats.score += sc;
            if (ev.kind === 'captured') s.stats.captures++;
            b.events.emit('score', { soldier: s, amount: sc, reason: ev.kind === 'captured' ? `Sector ${z.id} captured` : `Sector ${z.id} neutralized` });
          }
      }
    }
    if (stepTickets(this.tickets, this.zones, dt) !== -1) {
      this.end();
      return;
    }
    // Respawns and downed bots that give up.
    for (const s of b.soldiers) {
      if (s.dummy) continue;
      const bot = !s.isPlayer || flags.autoplay;
      if (!s.alive) {
        // The player respawns through the deploy screen unless the mode manages it.
        if (s.deadT > S.respawnDelay && (!s.isPlayer || this.autoDeployPlayer)) this.deploy(s, bot ? this.chooseBotSpawn(s) : this.options(s)[0]);
        continue;
      }
      if (s.downed && bot && TUNING.health.downedSeconds - s.downedT > TUNING.ai.downedGiveUp && s.reviverId === -1) {
        const help = b.soldiers.some((t) => t !== s && t.team === s.team && t.active && t.pos.distanceTo(s.pos) < TUNING.ai.downedHelpRange);
        if (!help) killSoldier(b, s);
      }
    }
  }
}
