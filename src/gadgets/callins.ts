// Call-ins: vehicle airdrops requested from the wrist tablet. Each team has its own cooldown per
// kind; a drop pod falls from high altitude, opens its parachute, lands with a dust burst and hands
// its payload to the vehicle system.
import * as THREE from 'three';
import { TUNING } from '../config/tuning';
import { buildDropPod } from '../art/vehicleModels';
import { dustKick } from '../render/recipes';
import type { VFX } from '../render/vfx';
import type { Soldier } from '../player/soldier';
import type { TeamId, VehicleKind } from '../config/content';

const C = TUNING.callins;

export type CallInKind = 'wisp' | 'basalt';
export const CALL_IN_KINDS: CallInKind[] = ['wisp', 'basalt'];

interface Pod {
  kind: CallInKind;
  team: TeamId;
  requester: Soldier;
  pos: THREE.Vector3;
  prevY: number;
  groundY: number;
  yaw: number;
  chute: boolean;
  landed: boolean;
  t: number;
  pod: THREE.Group;
  canopy: THREE.Group;
}

export class CallIns {
  /** Seconds left per team and kind. */
  readonly cooldowns: Record<TeamId, Record<CallInKind, number>> = { 0: { wisp: 0, basalt: 0 }, 1: { wisp: 0, basalt: 0 } };
  readonly pods: Pod[] = [];
  /** Called when a pod lands (the vehicle system spawns the vehicle). */
  onLand: ((kind: VehicleKind, team: TeamId, pos: THREE.Vector3, yaw: number, requester: Soldier) => void) | null = null;
  requests = 0;
  /** Off in infantry-only modes. */
  enabled = true;

  constructor(private scene: THREE.Scene) {}

  ready(team: TeamId, kind: CallInKind): boolean {
    return this.enabled && this.cooldowns[team][kind] <= 0;
  }

  /** Requests a drop at a ground point. Returns false while on cooldown. */
  request(by: Soldier, kind: CallInKind, at: THREE.Vector3, groundY: number): boolean {
    if (!this.ready(by.team, kind)) return false;
    this.cooldowns[by.team][kind] = C.cooldowns[kind];
    const { pod, chute } = buildDropPod(by.team);
    const yaw = by.yaw;
    pod.rotation.y = yaw;
    chute.visible = false;
    this.scene.add(pod, chute);
    this.pods.push({ kind, team: by.team, requester: by, pos: at.clone().setY(groundY + C.dropHeight), prevY: groundY + C.dropHeight, groundY, yaw, chute: false, landed: false, t: 0, pod, canopy: chute });
    this.requests++;
    return true;
  }

  step(dt: number, vfx: VFX): void {
    for (const team of [0, 1] as TeamId[]) for (const k of CALL_IN_KINDS) this.cooldowns[team][k] = Math.max(0, this.cooldowns[team][k] - dt);
    for (let i = this.pods.length - 1; i >= 0; i--) {
      const p = this.pods[i];
      p.t += dt;
      if (p.landed) {
        // The empty pod lingers a moment, then is recycled.
        if (p.t > 2.5) {
          p.pod.removeFromParent();
          p.canopy.removeFromParent();
          this.pods.splice(i, 1);
        } else p.canopy.position.y -= dt * 3;
        continue;
      }
      p.prevY = p.pos.y;
      const alt = p.pos.y - p.groundY;
      p.chute = alt < C.chuteAltitude;
      p.pos.y -= (p.chute ? C.chuteSpeed : C.fallSpeed) * dt;
      if (p.pos.y <= p.groundY) {
        p.pos.y = p.groundY;
        p.landed = true;
        p.t = 0;
        dustKick(vfx, p.pos, 3);
        this.onLand?.(p.kind, p.team, p.pos.clone(), p.yaw, p.requester);
      }
    }
  }

  render(alpha: number): void {
    for (const p of this.pods) {
      const y = p.prevY + (p.pos.y - p.prevY) * alpha;
      p.pod.position.set(p.pos.x, y, p.pos.z);
      p.canopy.visible = p.chute || p.landed;
      if (!p.landed) p.canopy.position.set(p.pos.x, y, p.pos.z);
    }
  }

  clear(): void {
    for (const p of this.pods) {
      p.pod.removeFromParent();
      p.canopy.removeFromParent();
    }
    this.pods.length = 0;
    for (const team of [0, 1] as TeamId[]) for (const k of CALL_IN_KINDS) this.cooldowns[team][k] = 0;
  }
}
