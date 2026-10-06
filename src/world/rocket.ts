// The launch vehicle on pad A. It stands on the pad with colliders until the launch-sequence event
// lifts it off; once it clears the gantry its colliders are removed and it climbs out of sight.
import * as THREE from 'three';
import { ModelBuilder } from '../render/toon';
import { rocketParts } from './structures';
import type { RocketSpec } from './maps/breakwater/districts';
import type { Physics } from '../physics/physics';
import type { CollisionWorld, DynBox } from '../physics/collision';
import type RAPIER from '@dimforge/rapier3d-compat';

export type RocketPhase = 'pad' | 'ignition' | 'ascent' | 'gone';

export class Rocket {
  readonly group: THREE.Group;
  readonly spec: RocketSpec;
  phase: RocketPhase = 'pad';
  /** Seconds since the current phase began. */
  phaseT = 0;
  /** Height above the pad. */
  lift = 0;
  private speed = 0;
  private colliders: RAPIER.Collider[] = [];
  private boxes: DynBox[] = [];

  constructor(spec: RocketSpec, private physics: Physics, private collision: CollisionWorld) {
    this.spec = spec;
    const { toon, glow } = rocketParts(spec.height, spec.radius);
    const mb = new ModelBuilder();
    for (const g of toon) mb.add(g);
    for (const g of glow) mb.addGlow(g);
    this.group = mb.build();
    this.group.position.copy(spec.base);
    const body = spec.height * 0.86;
    const half = new THREE.Vector3(spec.radius * 0.88, body / 2, spec.radius * 0.88);
    const c = spec.base.clone().setY(spec.base.y + body / 2);
    for (const ry of [0, Math.PI / 4]) {
      this.colliders.push(physics.addStaticBox(c, half, ry));
      this.boxes.push(collision.addBox(c, half, ry, 'metal', 'prop', this, { opaque: true }));
    }
  }

  /** Starts the launch countdown (ignition, then ascent). */
  ignite(): void {
    if (this.phase !== 'pad') return;
    this.phase = 'ignition';
    this.phaseT = 0;
  }

  /** Advances the launch; ignitionSeconds is how long the engines burn on the pad. */
  update(dt: number, ignitionSeconds: number, accel: number): void {
    this.phaseT += dt;
    if (this.phase === 'ignition' && this.phaseT >= ignitionSeconds) {
      this.phase = 'ascent';
      this.phaseT = 0;
      this.releaseColliders();
    } else if (this.phase === 'ascent') {
      this.speed += accel * dt;
      this.lift += this.speed * dt;
      if (this.lift > 1400) {
        this.phase = 'gone';
        this.group.visible = false;
      }
    }
    this.group.position.set(this.spec.base.x, this.spec.base.y + this.lift, this.spec.base.z);
  }

  /** World position of the engine bells (for exhaust effects). */
  exhaust(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.group.position).setY(this.group.position.y - 1.6);
  }

  private releaseColliders(): void {
    for (const c of this.colliders) this.physics.removeCollider(c);
    for (const b of this.boxes) this.collision.remove(b);
    this.colliders.length = 0;
    this.boxes.length = 0;
  }
}
