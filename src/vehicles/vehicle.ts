// One vehicle: model, rigid body, hull and components, seats and their weapon mounts, flight or
// hover state, countermeasures and lock warnings.
import * as THREE from 'three';
import { TUNING } from '../config/tuning';
import { buildVehicleModel, type VehicleModel } from '../art/vehicleModels';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Soldier } from '../player/soldier';
import type { TeamId, VehicleKind } from '../config/content';

export type MountKind = 'cannon' | 'coax' | 'rockets' | 'chin' | 'minigun' | 'doorgun' | 'personal' | null;

/** Weapon mount per seat. */
export const SEAT_MOUNTS: Record<VehicleKind, MountKind[]> = {
  wisp: [null, 'personal', 'personal'],
  basalt: ['cannon', 'coax'],
  condor: ['rockets', 'chin'],
  midge: ['minigun', 'doorgun'],
};

/** Seats where the occupant can be shot (open-top buggy, door gunner). */
export const SEAT_EXPOSED: Record<VehicleKind, boolean[]> = {
  wisp: [true, true, true],
  basalt: [false, false],
  condor: [false, false],
  midge: [false, true],
};

export const AIRCRAFT: ReadonlySet<VehicleKind> = new Set<VehicleKind>(['condor', 'midge']);

export interface Mount {
  kind: MountKind;
  heat: number;
  overheatT: number;
  cooldown: number;
  /** Rockets: shots left in the pod; cannon: loaded (1) or reloading (0). */
  ammo: number;
  reloadT: number;
  salvoLeft: number;
  /** Aim relative to the hull (turret / chin) or world (door gun uses world). */
  yaw: number;
  pitch: number;
  /** Alternating barrel index (miniguns, rocket pods). */
  side: number;
}

export interface Components {
  engine: number;
  weapons: number;
  mobility: number;
}

let nextId = 1;

export class Vehicle {
  readonly id = nextId++;
  readonly kind: VehicleKind;
  /** Team that owns it (the crew's team once someone boards). */
  team: TeamId;
  readonly model: VehicleModel;
  body!: RAPIER.RigidBody;
  collider!: RAPIER.Collider;
  readonly pos = new THREE.Vector3();
  readonly prevPos = new THREE.Vector3();
  readonly quat = new THREE.Quaternion();
  readonly prevQuat = new THREE.Quaternion();
  readonly vel = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  roll = 0;
  hp: number;
  readonly maxHp: number;
  readonly comps: Components = { engine: 1, weapons: 1, mobility: 1 };
  readonly seats: (Soldier | null)[];
  readonly mounts: Mount[];
  alive = true;
  wreckT = 0;
  lastDamageT = -999;
  lastAttacker: Soldier | null = null;
  empT = 0;
  grounded = false;
  /** VTOL: forward-flight mode (nacelles forward) or hover mode. */
  forwardFlight = false;
  readonly cm = { charges: TUNING.vehicles.countermeasures.charges, cooldown: 0, activeT: 0 };
  lockWarnT = 0;
  incoming = false;
  /** Pad it respawns on (null for airdrops). */
  pad: { pos: THREE.Vector3; yaw: number; team: TeamId } | null = null;
  /** Seconds since the last driver input (empty vehicles settle). */
  idleT = 0;
  readonly halfExtents: THREE.Vector3;
  /** World-to-local transform for ray tests. */
  readonly inv = new THREE.Matrix4();
  /** Rotor spin for rendering. */
  rotorAngle = 0;

  constructor(kind: VehicleKind, team: TeamId) {
    this.kind = kind;
    this.team = team;
    this.model = buildVehicleModel(kind, team);
    this.maxHp = TUNING.vehicles[kind].hp;
    this.hp = this.maxHp;
    const mounts = SEAT_MOUNTS[kind];
    this.seats = mounts.map(() => null);
    this.mounts = mounts.map((k) => ({ kind: k, heat: 0, overheatT: 0, cooldown: 0, ammo: k === 'rockets' ? TUNING.vehicles.weapons.rockets.salvo : 1, reloadT: 0, salvoLeft: 0, yaw: 0, pitch: 0, side: 0 }));
    this.halfExtents = this.model.half.clone();
  }

  get aircraft(): boolean {
    return AIRCRAFT.has(this.kind);
  }

  get driver(): Soldier | null {
    return this.seats[0];
  }

  get crewCount(): number {
    let n = 0;
    for (const s of this.seats) if (s) n++;
    return n;
  }

  forward(out: THREE.Vector3): THREE.Vector3 {
    return out.set(0, 0, -1).applyQuaternion(this.quat);
  }

  /** Seat position in world space (the occupant's hips). */
  seatWorld(i: number, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.model.seats[i] ?? this.model.seats[0]).applyQuaternion(this.quat).add(this.pos);
  }

  updateInverse(): void {
    const m = new THREE.Matrix4().compose(this.pos.clone().add(new THREE.Vector3(0, this.model.centerY, 0).applyQuaternion(this.quat)), this.quat, new THREE.Vector3(1, 1, 1));
    this.inv.copy(m).invert();
  }
}
