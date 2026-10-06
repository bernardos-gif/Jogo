// Rapier wrapper: world, collision groups, terrain heightfield, static boxes, the shared
// kinematic character controller and shape queries used by movement.
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { TUNING } from '../config/tuning';
import type { HeightGrid } from '../world/terrainMesh';

export { RAPIER };

export const G = {
  STATIC: 1 << 0,
  SOLDIER: 1 << 1,
  VEHICLE: 1 << 2,
  DESTRUCT: 1 << 3,
  DEBRIS: 1 << 4,
  SHIELD: 1 << 5,
  GADGET: 1 << 6,
} as const;

/** Rapier interaction groups: membership in the high 16 bits, filter in the low 16 bits. */
export const groups = (member: number, filter: number): number => ((member & 0xffff) << 16) | (filter & 0xffff);

export const SOLDIER_FILTER = G.STATIC | G.VEHICLE | G.DESTRUCT | G.SHIELD | G.GADGET;
export const VEHICLE_FILTER = G.STATIC | G.VEHICLE | G.DESTRUCT;

let ready: Promise<void> | null = null;
export function initPhysics(): Promise<void> {
  return (ready ||= RAPIER.init());
}

const _ray = { origin: { x: 0, y: 0, z: 0 }, dir: { x: 0, y: -1, z: 0 } };

export class Physics {
  readonly world: RAPIER.World;
  readonly cc: RAPIER.KinematicCharacterController;
  private staticBody: RAPIER.RigidBody;

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: -TUNING.movement.gravity, z: 0 });
    this.world.timestep = 1 / TUNING.loop.hz;
    this.staticBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const M = TUNING.movement;
    this.cc = this.world.createCharacterController(M.ccOffset);
    this.cc.setUp({ x: 0, y: 1, z: 0 });
    this.cc.setMaxSlopeClimbAngle(THREE.MathUtils.degToRad(M.maxSlopeDeg));
    this.cc.setMinSlopeSlideAngle(THREE.MathUtils.degToRad(M.slideSlopeDeg));
    this.cc.enableAutostep(M.stepHeight, M.stepMinWidth, false);
    this.cc.enableSnapToGround(M.snapToGround);
    this.cc.setSlideEnabled(true);
    this.cc.setApplyImpulsesToDynamicBodies(false);
  }

  addHeightfield(g: HeightGrid): RAPIER.Collider {
    const n = g.n;
    const heights = new Float32Array(n * n);
    // Rapier: column-major, rows along Z, columns along X.
    for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) heights[ix * n + iz] = g.h[iz * n + ix];
    const size = (n - 1) * g.cell;
    const center = g.origin + size / 2;
    const desc = RAPIER.ColliderDesc.heightfield(n - 1, n - 1, heights, { x: size, y: 1, z: size })
      .setTranslation(center, 0, center)
      .setFriction(0.9)
      .setCollisionGroups(groups(G.STATIC, 0xffff));
    return this.world.createCollider(desc, this.staticBody);
  }

  addStaticBox(center: THREE.Vector3, half: THREE.Vector3, rotY = 0, member: number = G.STATIC): RAPIER.Collider {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
    const desc = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z)
      .setTranslation(center.x, center.y, center.z)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setFriction(0.8)
      .setCollisionGroups(groups(member, 0xffff));
    return this.world.createCollider(desc, this.staticBody);
  }

  addStaticOrientedBox(center: THREE.Vector3, half: THREE.Vector3, quat: THREE.Quaternion, member: number = G.STATIC): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z)
      .setTranslation(center.x, center.y, center.z)
      .setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w })
      .setFriction(0.8)
      .setCollisionGroups(groups(member, 0xffff));
    return this.world.createCollider(desc, this.staticBody);
  }

  removeCollider(c: RAPIER.Collider): void {
    this.world.removeCollider(c, false);
  }

  /** Creates a kinematic capsule for a soldier; the body sits at the capsule center. */
  createSoldierBody(pos: THREE.Vector3, halfHeight: number, radius: number): { body: RAPIER.RigidBody; collider: RAPIER.Collider } {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y + halfHeight + radius, pos.z));
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(halfHeight, radius).setCollisionGroups(groups(G.SOLDIER, SOLDIER_FILTER)),
      body,
    );
    return { body, collider };
  }

  /** Downward ray against physics geometry (ground probe). Returns hit y or null. */
  groundY(x: number, y: number, z: number, maxDown: number, filterGroups = groups(G.SOLDIER, G.STATIC | G.DESTRUCT | G.VEHICLE)): number | null {
    _ray.origin.x = x;
    _ray.origin.y = y;
    _ray.origin.z = z;
    _ray.dir.x = 0;
    _ray.dir.y = -1;
    _ray.dir.z = 0;
    const hit = this.world.castRay(new RAPIER.Ray(_ray.origin, _ray.dir), maxDown, true, undefined, filterGroups);
    return hit ? y - hit.timeOfImpact : null;
  }

  /** Generic physics ray. Returns distance and collider or null. */
  ray(o: THREE.Vector3, d: THREE.Vector3, max: number, filterGroups: number, exclude?: RAPIER.Collider): { dist: number; collider: RAPIER.Collider; normal: THREE.Vector3 } | null {
    const hit = this.world.castRayAndGetNormal(new RAPIER.Ray({ x: o.x, y: o.y, z: o.z }, { x: d.x, y: d.y, z: d.z }), max, true, undefined, filterGroups, exclude);
    if (!hit) return null;
    return { dist: hit.timeOfImpact, collider: hit.collider, normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z) };
  }

  /** True when a capsule placed at `center` overlaps solid geometry. */
  capsuleBlocked(center: THREE.Vector3, halfHeight: number, radius: number, exclude?: RAPIER.Collider): boolean {
    let blocked = false;
    const shape = new RAPIER.Capsule(halfHeight, radius);
    this.world.intersectionsWithShape(
      { x: center.x, y: center.y, z: center.z },
      { x: 0, y: 0, z: 0, w: 1 },
      shape,
      () => {
        blocked = true;
        return false;
      },
      undefined,
      groups(G.SOLDIER, G.STATIC | G.DESTRUCT | G.VEHICLE | G.SHIELD),
      exclude,
    );
    return blocked;
  }

  step(): void {
    this.world.step();
  }

  dispose(): void {
    this.world.free();
  }
}
