// Firing range: enemy-faction target dummies at measured distances (static, strafing, armored),
// automatic respawn, and a readout of the last hit (distance, part, damage, time to kill).
import * as THREE from 'three';
import { TUNING } from '../config/tuning';
import { teleport } from '../player/movement';
import type { Battle } from './battle';
import type { BattleMode } from './mode';
import type { Soldier } from '../player/soldier';
import type { ClassId, SpecialistId } from '../config/content';

interface Dummy {
  s: Soldier;
  home: THREE.Vector3;
  strafe: number;
  armored: boolean;
  respawnT: number;
  firstHitT: number;
}

const LANES: { d: number; x: number; strafe: number; armored: boolean; cls: ClassId; spec: SpecialistId }[] = [
  { d: 10, x: 0, strafe: 0, armored: false, cls: 'assault', spec: 'varga' },
  { d: 25, x: -6, strafe: 0, armored: true, cls: 'support', spec: 'lindqvist' },
  { d: 25, x: 6, strafe: 3, armored: false, cls: 'engineer', spec: 'halloran' },
  { d: 50, x: 0, strafe: 4, armored: false, cls: 'recon', spec: 'tanaka' },
  { d: 100, x: -6, strafe: 0, armored: false, cls: 'assault', spec: 'okonjo' },
  { d: 100, x: 6, strafe: 5, armored: true, cls: 'support', spec: 'adeyemi' },
  { d: 200, x: 0, strafe: 0, armored: false, cls: 'engineer', spec: 'petrova' },
  { d: 400, x: 0, strafe: 0, armored: false, cls: 'recon', spec: 'rousseau' },
];

export class RangeMode implements BattleMode {
  readonly id = 'range';
  private b!: Battle;
  private dummies: Dummy[] = [];
  private t = 0;
  private stats = { lastDist: 0, lastPart: '-', lastDmg: 0, ttk: 0, shots: 0, hits: 0 };

  setup(b: Battle): void {
    this.b = b;
    const o = b.map.laneOrigin;
    for (const L of LANES) {
      const s = b.addSoldier(1, `Target ${L.d}m`, L.cls, L.spec, 'tern', 'frag');
      s.dummy = true;
      const home = new THREE.Vector3(o.x + L.x, 0, o.z - L.d);
      home.y = b.terrain.heightAt(home.x, home.z);
      teleport(s, home);
      s.yaw = 0;
      s.input.yaw = 0;
      this.dummies.push({ s, home, strafe: L.strafe, armored: L.armored, respawnT: 0, firstHitT: -1 });
      this.reset(this.dummies[this.dummies.length - 1]);
    }
    b.hud?.setReadout('Firing range', ['Distance', 'Hit part', 'Damage', 'Time to kill', 'Accuracy']);
    b.events.on('shot', (e) => {
      if (e.soldier === b.player) this.stats.shots++;
    });
    b.events.on('hit', (e) => {
      if (e.attacker !== b.player || !e.victim) return;
      this.stats.hits++;
      const d = this.dummies.find((x) => x.s === e.victim);
      if (d && d.firstHitT < 0) d.firstHitT = b.time;
      this.stats.lastDist = e.victim.pos.distanceTo(b.player.pos);
      this.stats.lastPart = e.part ?? 'body';
      this.stats.lastDmg = e.damage;
      if ((e.kill || e.downed) && d) this.stats.ttk = b.time - d.firstHitT;
    });
  }

  private reset(d: Dummy): void {
    const s = d.s;
    this.b.respawn(s, d.home, Math.PI);
    s.maxArmor = d.armored ? TUNING.health.armorPlate : 0;
    s.armor = s.maxArmor;
    s.spawnProtectT = 0;
    d.firstHitT = -1;
  }

  update(dt: number): void {
    this.t += dt;
    for (const d of this.dummies) {
      const s = d.s;
      const i = s.input;
      i.moveX = 0;
      i.moveZ = 0;
      i.yaw = Math.PI;
      i.pitch = 0;
      if (s.alive && !s.downed && d.strafe > 0) {
        // Strafe across the lane. Facing south, +moveX walks toward -X.
        const target = d.home.x + Math.sin(this.t * 0.8 + d.home.z) * d.strafe;
        i.moveX = -Math.max(-1, Math.min(1, (target - s.pos.x) * 1.5));
      }
      if (!s.alive || s.downed) {
        d.respawnT += dt;
        if (d.respawnT > 3) {
          d.respawnT = 0;
          this.reset(d);
        }
      }
    }
    // The player respawns at the platform after dying (grenade self-damage).
    const p = this.b.player;
    if (!p.alive || p.downed) {
      p.deadT += p.downed ? dt : 0;
      if (p.deadT > 3) this.b.respawn(p, this.b.map.spawn, this.b.map.spawnYaw);
    }
  }

  frame(): void {
    const h = this.b.hud;
    if (!h) return;
    h.setReadoutValue('Distance', `${this.stats.lastDist.toFixed(1)} m`);
    h.setReadoutValue('Hit part', this.stats.lastPart);
    h.setReadoutValue('Damage', this.stats.lastDmg.toFixed(1));
    h.setReadoutValue('Time to kill', this.stats.ttk > 0 ? `${(this.stats.ttk * 1000).toFixed(0)} ms` : '-');
    h.setReadoutValue('Accuracy', this.stats.shots ? `${((this.stats.hits / this.stats.shots) * 100).toFixed(0)}%` : '-');
  }
}
