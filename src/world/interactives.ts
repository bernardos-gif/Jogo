// Traversal objects: ladders, ziplines and elevators.
import * as THREE from 'three';
import { RAPIER, G, groups, type Physics } from '../physics/physics';
import { TUNING } from '../config/tuning';

export interface Ladder {
  id: number;
  /** Bottom and top of the climb line (just in front of the wall face). */
  base: THREE.Vector3;
  top: THREE.Vector3;
  /** Yaw a climber faces (toward the wall). */
  yaw: number;
  /** Where the climber steps off at the top. */
  exit: THREE.Vector3;
}

export interface Zipline {
  id: number;
  a: THREE.Vector3;
  b: THREE.Vector3;
}

export class Elevator {
  readonly id: number;
  readonly base: THREE.Vector3;
  readonly height: number;
  readonly half: THREE.Vector3;
  offset = 0;
  /** Change in height this tick (riders move with it). */
  delta = 0;
  private dir = 1;
  private wait = 0;
  readonly mesh: THREE.Object3D;
  private body: RAPIER.RigidBody;

  constructor(id: number, base: THREE.Vector3, height: number, half: THREE.Vector3, mesh: THREE.Object3D, physics: Physics) {
    this.id = id;
    this.base = base.clone();
    this.height = height;
    this.half = half.clone();
    this.mesh = mesh;
    this.body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(base.x, base.y - half.y, base.z));
    physics.world.createCollider(RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setCollisionGroups(groups(G.STATIC, 0xffff)), this.body);
    this.wait = TUNING.movement.elevatorWait;
  }

  /** Top surface height of the platform. */
  get floorY(): number {
    return this.base.y + this.offset;
  }

  contains(p: THREE.Vector3, margin = 0.1): boolean {
    return Math.abs(p.x - this.base.x) < this.half.x + margin && Math.abs(p.z - this.base.z) < this.half.z + margin && Math.abs(p.y - this.floorY) < 0.45;
  }

  update(dt: number): void {
    const M = TUNING.movement;
    const prev = this.offset;
    if (this.wait > 0) this.wait -= dt;
    else {
      this.offset += this.dir * M.elevatorSpeed * dt;
      if (this.offset >= this.height) {
        this.offset = this.height;
        this.dir = -1;
        this.wait = M.elevatorWait;
      } else if (this.offset <= 0) {
        this.offset = 0;
        this.dir = 1;
        this.wait = M.elevatorWait;
      }
    }
    this.delta = this.offset - prev;
    this.body.setNextKinematicTranslation({ x: this.base.x, y: this.floorY - this.half.y, z: this.base.z });
    this.mesh.position.y = this.offset;
  }
}

export class Interactives {
  ladders: Ladder[] = [];
  ziplines: Zipline[] = [];
  elevators: Elevator[] = [];

  nearestLadder(p: THREE.Vector3, range: number): Ladder | null {
    let best: Ladder | null = null;
    let bd = range;
    for (const l of this.ladders) {
      if (p.y < l.base.y - 0.6 || p.y > l.top.y + 0.3) continue;
      const d = Math.hypot(p.x - l.base.x, p.z - l.base.z);
      if (d < bd) {
        bd = d;
        best = l;
      }
    }
    return best;
  }

  /** Closest zipline point within range (returns line and parameter t). */
  nearestZipline(p: THREE.Vector3, range: number): { line: Zipline; t: number } | null {
    let best: { line: Zipline; t: number } | null = null;
    let bd = range;
    const ab = new THREE.Vector3();
    const ap = new THREE.Vector3();
    for (const z of this.ziplines) {
      ab.subVectors(z.b, z.a);
      ap.subVectors(p, z.a);
      ap.y += 1.6;
      const t = THREE.MathUtils.clamp(ap.dot(ab) / ab.lengthSq(), 0.02, 0.98);
      const q = z.a.clone().addScaledVector(ab, t);
      const d = q.distanceTo(p.clone().setY(p.y + 1.6));
      if (d < bd) {
        bd = d;
        best = { line: z, t };
      }
    }
    return best;
  }

  elevatorUnder(p: THREE.Vector3): Elevator | null {
    for (const e of this.elevators) if (e.contains(p)) return e;
    return null;
  }

  update(dt: number): void {
    for (const e of this.elevators) e.update(dt);
  }
}
