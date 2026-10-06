// Free roam on a full map (used until Sector Control takes over): respawn at the HQ after death.
import type { Battle } from './battle';
import type { BattleMode } from './mode';

export class FreeplayMode implements BattleMode {
  readonly id = 'freeplay';
  private b!: Battle;

  setup(b: Battle): void {
    this.b = b;
  }

  update(dt: number): void {
    const p = this.b.player;
    if (!p.alive || p.downed) {
      p.deadT += p.downed ? dt : 0;
      if (p.deadT > 3) this.b.respawn(p, this.b.map.spawn, this.b.map.spawnYaw);
    }
  }
}
