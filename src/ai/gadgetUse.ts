// Bot gadget use per specialist: when to grapple, raise a Bulwark, place a sentry, drop a supply
// cache, heal or revive with Mender darts, overload enemy gadgets with the Arc Tool, launch the
// scout drone and throw motion sensors. Decisions run a few times a second per bot; aiming for a
// gadget is a one-tick snap of the body orientation just before the gadget system reads it.
import * as THREE from 'three';
import { TUNING } from '../config/tuning';
import { yawOf } from '../core/math';
import { throwPitch } from './aim';
import { chestPoint } from '../weapons/hitboxes';
import type { BotBrain } from './brain';
import type { GadgetSystem } from '../gadgets/system';
import type { Soldier } from '../player/soldier';
import type { Rng } from '../core/rng';

const GT = TUNING.gadgets;
const B = TUNING.ai.gadgets;

interface Plan {
  t: number;
  phase: 'idle' | 'hold' | 'release' | 'beam';
  target: Soldier | null;
  aimYaw: number;
  aimPitch: number;
}

const _v = new THREE.Vector3();

export class BotGadgets {
  private plans = new Map<number, Plan>();

  constructor(
    private gadgets: GadgetSystem,
    private soldiers: () => readonly Soldier[],
    private rng: Rng,
  ) {}

  private plan(s: Soldier): Plan {
    let p = this.plans.get(s.id);
    if (!p) this.plans.set(s.id, (p = { t: this.rng.next() * B.interval, phase: 'idle', target: null, aimYaw: 0, aimPitch: 0 }));
    return p;
  }

  /** Called every tick for each bot after its brain wrote the command. */
  step(b: BotBrain, dt: number): void {
    const s = b.s;
    const g = s.gadget;
    if (!g || !s.active || s.inVehicle) return;
    const p = this.plan(s);
    const inp = s.input;
    // Multi-tick actions first.
    if (p.phase === 'hold') {
      inp.gadgetHeld = true;
      p.phase = 'release';
      return;
    }
    if (p.phase === 'release') {
      this.snap(s, p.aimYaw, p.aimPitch);
      inp.gadgetHeld = false;
      p.phase = 'idle';
      return;
    }
    if (p.phase === 'beam') {
      const t = p.target;
      if (!t || g.overheated || p.t <= 0) {
        inp.gadgetHeld = false;
        p.phase = 'idle';
        return;
      }
      p.t -= dt;
      inp.gadgetHeld = true;
      return;
    }
    p.t -= dt;
    if (p.t > 0) return;
    p.t = B.interval * (0.7 + this.rng.next() * 0.6);
    if (g.disabledT > 0 || s.empT > 0) return;
    const ready = g.cooldown <= 0 && g.charges > 0;
    const sq = b.squad?.order;
    switch (g.id) {
      case 'mender': {
        if (g.charges <= 0) return;
        // Downed or hurt allies in sight first, then ourselves.
        let best: Soldier | null = null;
        let bs = 0;
        for (const o of this.soldiers()) {
          if (o === s || o.team !== s.team || !o.alive) continue;
          const d = o.pos.distanceTo(s.pos);
          if (d > B.healRange) continue;
          const need = o.downed ? 2 : o.health < B.healBelow ? (100 - o.health) / 100 : 0;
          const sc = need / (1 + d / 20);
          if (sc > bs) {
            bs = sc;
            best = o;
          }
        }
        if (best && !b.targetVisible) {
          chestPoint(best, _v);
          const eye = s.eyePos;
          p.aimYaw = yawOf(_v.x - eye.x, _v.z - eye.z);
          p.aimPitch = Math.atan2(_v.y - eye.y, Math.hypot(_v.x - eye.x, _v.z - eye.z)) + 0.01 * eye.distanceTo(_v) / 10;
          p.phase = 'hold';
          inp.gadgetHeld = true;
          return;
        }
        if (s.health < B.selfHealBelow && !b.targetVisible) {
          // Hold long enough to self-heal (the release afterwards fires nothing).
          inp.gadgetHeld = true;
          p.phase = 'beam';
          p.target = s;
          p.t = GT.mender.selfHold + 0.1;
        }
        return;
      }
      case 'arctool': {
        // Overload enemy gadgets in reach.
        let tgt: { pos: THREE.Vector3 } | null = null;
        for (const list of [this.gadgets.sentries, this.gadgets.walls, this.gadgets.caches, this.gadgets.drones] as { pos: THREE.Vector3; team: number }[][])
          for (const d of list) if (d.team !== s.team && d.pos.distanceTo(s.pos) < GT.arctool.range * 0.9) tgt = d;
        if (!tgt) return;
        p.phase = 'beam';
        p.target = s;
        p.t = 2.5;
        const eye = s.eyePos;
        this.snap(s, yawOf(tgt.pos.x - eye.x, tgt.pos.z - eye.z), Math.atan2(tgt.pos.y + 0.5 - eye.y, Math.hypot(tgt.pos.x - eye.x, tgt.pos.z - eye.z)));
        inp.gadgetHeld = true;
        return;
      }
      case 'shield':
        if (ready && b.mode === 'combat' && b.target && !b.cover && (b.suppression > B.shieldSuppression || s.health < 60)) {
          this.snap(s, yawOf(b.target.pos.x - s.pos.x, b.target.pos.z - s.pos.z), 0);
          inp.gadget = true;
        }
        return;
      case 'sentry':
        if (!ready) return;
        if ((b.mode === 'objective' && b.arrived && sq?.kind === 'defend') || (b.mode === 'combat' && b.target && s.pos.distanceTo(b.target.pos) > 15 && s.pos.distanceTo(b.target.pos) < GT.sentry.range)) {
          const look = b.target ? yawOf(b.target.pos.x - s.pos.x, b.target.pos.z - s.pos.z) : s.yaw;
          this.snap(s, look, -0.5);
          inp.gadget = true;
        }
        return;
      case 'cache': {
        if (!ready) return;
        let near = 0;
        let needy = false;
        for (const o of this.soldiers())
          if (o !== s && o.team === s.team && o.active && o.pos.distanceTo(s.pos) < B.cacheRadius) {
            near++;
            const w = o.arsenal.slots[0];
            if (!w.usesHeat && w.reserve < w.stats.mag * 2) needy = true;
          }
        const self = s.arsenal.slots[0];
        if (needy || (near >= 2 && b.arrived) || (!self.usesHeat && self.reserve < self.stats.mag)) {
          this.snap(s, s.yaw, -0.6);
          inp.gadget = true;
        }
        return;
      }
      case 'drone': {
        const mine = this.gadgets.droneOf(s);
        if (mine) {
          if (sq) mine.orbit.copy(sq.pos);
          return;
        }
        if (ready && sq && b.mode !== 'combat' && Math.hypot(s.pos.x - sq.pos.x, s.pos.z - sq.pos.z) < B.droneRange) {
          this.gadgets.botPilot.add(s.id);
          inp.gadget = true;
        }
        return;
      }
      case 'sensor': {
        if (!ready || !sq) return;
        const d = Math.hypot(s.pos.x - sq.pos.x, s.pos.z - sq.pos.z);
        if (d < B.sensorMin || d > B.sensorMax) return;
        const yaw = yawOf(sq.pos.x - s.pos.x, sq.pos.z - s.pos.z);
        const pitch = throwPitch(Math.min(d, 30), 0, GT.sensor.throwSpeed, 3, 0.15, TUNING.weapons.gravity);
        this.snap(s, yaw, pitch);
        inp.gadget = true;
        return;
      }
      case 'grapple': {
        if (!ready || b.mode === 'combat' || !b.path.length) return;
        // Pull up to a high waypoint within reach.
        for (let i = b.pathIdx; i < Math.min(b.path.length, b.pathIdx + 4); i++) {
          const w = b.path[i];
          const dy = w.y - s.pos.y;
          const dh = Math.hypot(w.x - s.pos.x, w.z - s.pos.z);
          if (dy > B.grappleRise && dh < GT.grapple.range * 0.8) {
            const eye = s.eyePos;
            this.snap(s, yawOf(w.x - eye.x, w.z - eye.z), Math.atan2(w.y + 0.5 - eye.y, dh));
            inp.gadget = true;
            return;
          }
        }
        return;
      }
    }
  }

  /** Points the body (what the gadget system reads) for this tick. */
  private snap(s: Soldier, yaw: number, pitch: number): void {
    s.yaw = yaw;
    s.pitch = pitch;
  }

  forget(s: Soldier): void {
    this.plans.delete(s.id);
  }
}
