// Pings and comms callouts: world markers a team shares (location, enemy, vehicle, attack, defend,
// need medic, need ammo). Players and bots publish them through the 'ping' event.
import * as THREE from 'three';
import { TUNING } from '../config/tuning';
import type { EventBus } from '../core/events';
import type { Soldier } from '../player/soldier';
import type { TeamId } from '../config/content';

export type PingKind = 'location' | 'enemy' | 'vehicle' | 'attack' | 'defend' | 'medic' | 'ammo';

export interface Ping {
  id: number;
  kind: PingKind;
  team: TeamId;
  owner: Soldier;
  pos: THREE.Vector3;
  /** Pings on soldiers follow them (enemy, need medic, need ammo). */
  follow: Soldier | null;
  t: number;
  life: number;
}

export const PING_LABELS: Record<PingKind, string> = {
  location: 'Ping',
  enemy: 'Enemy',
  vehicle: 'Vehicle',
  attack: 'Attack',
  defend: 'Defend',
  medic: 'Need medic',
  ammo: 'Need ammo',
};

export class Pings {
  readonly list: Ping[] = [];
  private nextId = 1;
  private off: () => void;

  constructor(events: EventBus) {
    this.off = events.on('ping', (e) => this.add(e.soldier, e.kind as PingKind, e.pos, e.follow ?? null));
  }

  add(owner: Soldier, kind: PingKind, pos: THREE.Vector3, follow: Soldier | null): Ping {
    const P = TUNING.ui.pings;
    // One active ping of each kind per owner: a new one replaces the old.
    for (let i = this.list.length - 1; i >= 0; i--) if (this.list[i].owner === owner && (this.list[i].kind === kind || (owner.isPlayer && this.list.filter((p) => p.owner === owner).length >= P.maxPerOwner))) this.list.splice(i, 1);
    const p: Ping = { id: this.nextId++, kind, team: owner.team, owner, pos: pos.clone(), follow, t: 0, life: kind === 'enemy' ? TUNING.ui.pingEnemyLife : kind === 'medic' || kind === 'ammo' ? P.requestLife : TUNING.ui.pingLife };
    this.list.push(p);
    return p;
  }

  update(dt: number): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.t += dt;
      if (p.follow) {
        if (!p.follow.alive) p.follow = null;
        else p.pos.copy(p.follow.pos).setY(p.follow.pos.y + 2.1);
      }
      if (p.t >= p.life) this.list.splice(i, 1);
    }
  }

  clear(): void {
    this.list.length = 0;
  }

  dispose(): void {
    this.off();
  }
}
