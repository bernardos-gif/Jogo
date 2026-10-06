// The soldier entity. The player and every bot are the same class: each tick a controller (human
// input or bot brain) fills `input`, and the shared systems (movement, weapons, gadgets, damage)
// act on it.
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { SoldierAnimator, type BodyMode } from '../art/soldierAnim';
import type { ClassId, SpecialistId, TeamId, ThrowableId, WeaponId } from '../config/content';
import type { Ladder, Zipline, Elevator } from '../world/interactives';

export interface SoldierInput {
  /** Strafe (+right) and forward (+forward), each -1..1. */
  moveX: number;
  moveZ: number;
  yaw: number;
  pitch: number;
  jump: boolean;
  jumpHeld: boolean;
  sprint: boolean;
  tacSprint: boolean;
  crouch: boolean;
  prone: boolean;
  fire: boolean;
  firePressed: boolean;
  aim: boolean;
  reload: boolean;
  slot: number;
  gadget: boolean;
  gadgetHeld: boolean;
  grenade: boolean;
  melee: boolean;
  fireMode: boolean;
  interact: boolean;
  interactHeld: boolean;
  inspect: boolean;
  seat: number;
}

export function emptyInput(): SoldierInput {
  return {
    moveX: 0,
    moveZ: 0,
    yaw: 0,
    pitch: 0,
    jump: false,
    jumpHeld: false,
    sprint: false,
    tacSprint: false,
    crouch: false,
    prone: false,
    fire: false,
    firePressed: false,
    aim: false,
    reload: false,
    slot: -1,
    gadget: false,
    gadgetHeld: false,
    grenade: false,
    melee: false,
    fireMode: false,
    interact: false,
    interactHeld: false,
    inspect: false,
    seat: -1,
  };
}

/** Clears one-shot edges after the first sim step of a frame consumed them. */
export function clearEdges(i: SoldierInput): void {
  i.jump = false;
  i.tacSprint = false;
  i.crouch = false;
  i.prone = false;
  i.firePressed = false;
  i.reload = false;
  i.slot = -1;
  i.gadget = false;
  i.grenade = false;
  i.melee = false;
  i.fireMode = false;
  i.interact = false;
  i.inspect = false;
  i.seat = -1;
}

export type Stance = 'stand' | 'crouch' | 'prone';
export type MoveState = 'ground' | 'air' | 'slide' | 'mantle' | 'ladder' | 'zipline' | 'parachute' | 'wingsuit' | 'grapple' | 'vehicle' | 'downed' | 'dead';

export interface SoldierStats {
  kills: number;
  deaths: number;
  assists: number;
  revives: number;
  captures: number;
  score: number;
  damage: number;
  headshots: number;
  spots: number;
  vehicleKills: number;
}

export class Soldier {
  readonly id: number;
  name: string;
  team: TeamId;
  squadId = -1;
  isPlayer = false;
  specialist: SpecialistId;
  cls: ClassId;
  primary: WeaponId;
  throwable: ThrowableId;

  // ---- Physical state
  readonly pos = new THREE.Vector3();
  readonly prevPos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  prevYaw = 0;
  prevPitch = 0;
  body: RAPIER.RigidBody | null = null;
  collider: RAPIER.Collider | null = null;
  halfHeight = 0;
  stance: Stance = 'stand';
  state: MoveState = 'ground';
  grounded = true;
  /** Smoothed eye height above the feet. */
  eye = 1.66;
  tacSprint = false;
  tacSprintT = 0;
  tacCooldown = 0;
  sprinting = false;
  slideT = 0;
  slideCooldown = 0;
  airT = 0;
  jumpCooldown = 0;
  lastGroundedT = 0;
  fallStartY = 0;
  minVy = 0;
  /** Scripted traversal (mantle / vault). */
  readonly moveFrom = new THREE.Vector3();
  readonly moveTo = new THREE.Vector3();
  moveT = 0;
  moveDur = 0;
  ladder: Ladder | null = null;
  zipline: Zipline | null = null;
  zipT = 0;
  zipDir = 1;
  zipSpeed = 0;
  elevator: Elevator | null = null;
  readonly grapplePoint = new THREE.Vector3();
  outOfBoundsT = 0;
  /** Landing impulse for camera kick (0..1). */
  landKick = 0;

  // ---- Health
  health = 100;
  armor = 0;
  maxArmor = 0;
  alive = true;
  downed = false;
  downedT = 0;
  deadT = 0;
  lastDamageT = -999;
  lastCombatT = -999;
  regenBoostT = 0;
  /** Last attacker id and weapon (for kill credit). */
  lastAttacker = -1;
  lastAttackerWeapon = '';
  assistants = new Map<number, number>();
  reviveProgress = 0;
  reviverId = -1;
  spawnProtectT = 0;

  // ---- Spotting and comms
  spottedUntil = 0;
  spottedByTeam = -1;
  firedUntil = 0;

  // ---- Controller and visuals
  readonly input: SoldierInput = emptyInput();
  readonly anim = new SoldierAnimator();
  bodyMode: BodyMode = 'normal';
  flashT = 0;
  readonly deathSeed = Math.random();

  /** Vehicle seat while mounted. */
  vehicleId = -1;
  seat = -1;

  readonly stats: SoldierStats = { kills: 0, deaths: 0, assists: 0, revives: 0, captures: 0, score: 0, damage: 0, headshots: 0, spots: 0, vehicleKills: 0 };

  /** AI level-of-detail bucket (0 full, 1 reduced, 2 far). */
  lod = 0;

  constructor(id: number, name: string, team: TeamId, cls: ClassId, specialist: SpecialistId, primary: WeaponId, throwable: ThrowableId) {
    this.id = id;
    this.name = name;
    this.team = team;
    this.cls = cls;
    this.specialist = specialist;
    this.primary = primary;
    this.throwable = throwable;
  }

  get eyePos(): THREE.Vector3 {
    return _eye.set(this.pos.x, this.pos.y + this.eye, this.pos.z);
  }

  /** True when the soldier can act (alive and not downed). */
  get active(): boolean {
    return this.alive && !this.downed;
  }

  get inVehicle(): boolean {
    return this.vehicleId >= 0;
  }
}

const _eye = new THREE.Vector3();
