// Analytic soldier hitboxes (head sphere, torso capsule, legs capsule) by stance, and the ray
// target set that plugs soldiers into the collision world.
import * as THREE from 'three';
import { TUNING } from '../config/tuning';
import { rayCapsule, raySphere } from '../core/math';
import type { Hit, HitPart, RayTargetSet } from '../physics/collision';
import type { Soldier } from '../player/soldier';

const HB = TUNING.hitboxes;
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _f = new THREE.Vector3();

export interface PartHit {
  dist: number;
  part: HitPart;
}

/** Ray against one soldier's hitboxes. Returns nearest part hit or null. */
export function raySoldier(s: Soldier, o: THREE.Vector3, d: THREE.Vector3, max: number): PartHit | null {
  const p = s.pos;
  // Broad phase: bounding sphere around the body.
  _c.set(p.x, p.y + 0.9, p.z);
  if (raySphere(o, d, _c, HB.broadRadius, max) < 0 && o.distanceToSquared(_c) > HB.broadRadius * HB.broadRadius) return null;
  let best: PartHit | null = null;
  const consider = (t: number, part: HitPart) => {
    if (t >= 0 && t <= max && (!best || t < best.dist)) best = { dist: t, part };
  };
  const lying = s.stance === 'prone' || s.state === 'downed' || s.state === 'dead' || s.state === 'wingsuit';
  if (lying) {
    const P = HB.prone;
    _f.set(-Math.sin(s.yaw), 0, -Math.cos(s.yaw));
    if (s.state === 'downed' || s.state === 'dead') _f.negate();
    _c.copy(p).addScaledVector(_f, P.headFwd).setY(p.y + P.headY);
    consider(raySphere(o, d, _c, P.headR, max), 'head');
    _a.copy(p).addScaledVector(_f, P.torsoFwd[0]).setY(p.y + P.torsoY);
    _b.copy(p).addScaledVector(_f, P.torsoFwd[1]).setY(p.y + P.torsoY);
    consider(rayCapsule(o, d, _a, _b, P.torsoR, max), 'body');
    _a.copy(p).addScaledVector(_f, P.legsFwd[0]).setY(p.y + P.legsY);
    _b.copy(p).addScaledVector(_f, P.legsFwd[1]).setY(p.y + P.legsY);
    consider(rayCapsule(o, d, _a, _b, P.legsR, max), 'limb');
    return best;
  }
  const B = s.stance === 'crouch' || s.state === 'slide' ? HB.crouch : HB.stand;
  _c.set(p.x, p.y + B.head, p.z);
  consider(raySphere(o, d, _c, B.headR, max), 'head');
  _a.set(p.x, p.y + B.torso[0], p.z);
  _b.set(p.x, p.y + B.torso[1], p.z);
  consider(rayCapsule(o, d, _a, _b, B.torsoR, max), 'body');
  _a.set(p.x, p.y + B.legs[0], p.z);
  _b.set(p.x, p.y + B.legs[1], p.z);
  consider(rayCapsule(o, d, _a, _b, B.legsR, max), 'limb');
  return best;
}

/** Center of mass target points (for AI aim and explosions). */
export function chestPoint(s: Soldier, out: THREE.Vector3): THREE.Vector3 {
  if (s.stance === 'prone' || s.state === 'downed') return out.set(s.pos.x, s.pos.y + 0.3, s.pos.z);
  const B = s.stance === 'crouch' ? HB.crouch : HB.stand;
  return out.set(s.pos.x, s.pos.y + (B.torso[0] + B.torso[1]) / 2, s.pos.z);
}

export function headPoint(s: Soldier, out: THREE.Vector3): THREE.Vector3 {
  if (s.stance === 'prone' || s.state === 'downed') {
    const f = _f.set(-Math.sin(s.yaw), 0, -Math.cos(s.yaw));
    return out.copy(s.pos).addScaledVector(f, HB.prone.headFwd).setY(s.pos.y + HB.prone.headY);
  }
  const B = s.stance === 'crouch' ? HB.crouch : HB.stand;
  return out.set(s.pos.x, s.pos.y + B.head, s.pos.z);
}

/** Soldiers as collision ray targets (alive, downed and not mounted in enclosed seats). */
export class SoldierTargets implements RayTargetSet {
  constructor(
    private soldiers: () => readonly Soldier[],
    private exposed: (s: Soldier) => boolean,
  ) {}

  raycast(o: THREE.Vector3, d: THREE.Vector3, max: number, ignore: unknown, out: Hit): boolean {
    let best = max;
    let found: Soldier | null = null;
    let part: HitPart = 'body';
    for (const s of this.soldiers()) {
      if (!s.alive || s === ignore || !this.exposed(s)) continue;
      const h = raySoldier(s, o, d, best);
      if (h && h.dist < best) {
        best = h.dist;
        found = s;
        part = h.part;
      }
    }
    if (!found) return false;
    out.dist = best;
    out.point.copy(o).addScaledVector(d, best);
    out.normal.copy(d).negate();
    out.surface = 'armor';
    out.kind = 'soldier';
    out.ref = found;
    out.part = part;
    return true;
  }
}
