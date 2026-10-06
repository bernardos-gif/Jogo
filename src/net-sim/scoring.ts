// Match scoring: turns gameplay events into score for every soldier (player and bots alike) and
// publishes 'score' events for the HUD's score stack.
import { TUNING } from '../config/tuning';
import { inZone, type ZoneState } from '../modes/sector/logic';
import type { EventBus } from '../core/events';
import type { Soldier } from '../player/soldier';

const SC = TUNING.sector.score;

export class Scoring {
  private off: (() => void)[] = [];

  constructor(
    private events: EventBus,
    private zones: () => readonly ZoneState[],
  ) {
    this.off.push(
      events.on('kill', (e) => {
        const k = e.killer;
        if (k && k.team !== e.victim.team) {
          this.award(k, SC.kill, e.headshot ? 'Headshot kill' : 'Enemy down');
          if (e.headshot) this.award(k, SC.headshotBonus, 'Headshot bonus');
          // Defending: the kill happened inside a zone the killer's team owns.
          for (const z of this.zones()) if (z.owner === k.team && (inZone(z, e.victim.pos.x, e.victim.pos.z) || inZone(z, k.pos.x, k.pos.z))) {
            this.award(k, SC.defend, `Sector ${z.id} defense`);
            break;
          }
        }
        for (const a of e.assists) this.award(a, SC.assist, 'Kill assist');
      }),
      events.on('revive', (e) => {
        const squad = e.reviver.squadId >= 0 && e.reviver.squadId === e.victim.squadId;
        this.award(e.reviver, SC.revive, squad ? 'Squad revive' : 'Revive');
      }),
      events.on('spotted', (e) => this.award(e.by, SC.spot, 'Spot')),
    );
  }

  award(s: Soldier, amount: number, reason: string): void {
    if (amount <= 0) return;
    s.stats.score += amount;
    this.events.emit('score', { soldier: s, amount, reason });
  }

  dispose(): void {
    for (const f of this.off) f();
    this.off.length = 0;
  }
}
