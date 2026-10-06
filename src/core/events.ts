// Typed event bus. Systems publish gameplay events; the HUD, audio, scoring, AI and stats subscribe.
import type * as THREE from 'three';
import type { Soldier } from '../player/soldier';
import type { HitPart } from '../physics/collision';
import type { Surface } from '../world/surface';
import type { EnergyFamily, WeaponId, ZoneId, TeamId } from '../config/content';

export interface GameEvents {
  shot: { soldier: Soldier; weapon: WeaponId; pos: THREE.Vector3; dir: THREE.Vector3; suppressed: boolean; energy: EnergyFamily };
  hit: { attacker: Soldier; victim: Soldier | null; kind: 'soldier' | 'vehicle' | 'shield' | 'object'; part: HitPart | null; damage: number; armorBreak: boolean; kill: boolean; downed: boolean; pos: THREE.Vector3 };
  damaged: { victim: Soldier; attacker: Soldier | null; amount: number; from: THREE.Vector3; explosive: boolean };
  downed: { victim: Soldier; attacker: Soldier | null; weapon: string; headshot: boolean };
  kill: { victim: Soldier; killer: Soldier | null; weapon: string; headshot: boolean; distance: number; assists: Soldier[]; vehicle: boolean };
  revive: { victim: Soldier; reviver: Soldier };
  death: { victim: Soldier };
  spawn: { soldier: Soldier };
  score: { soldier: Soldier; amount: number; reason: string };
  impact: { pos: THREE.Vector3; surface: Surface; energy: EnergyFamily; heavy: boolean };
  explosion: { pos: THREE.Vector3; radius: number; kind: string; owner: Soldier | null };
  whiz: { pos: THREE.Vector3; crack: boolean };
  reload: { soldier: Soldier; weapon: WeaponId };
  empty: { soldier: Soldier };
  throw: { soldier: Soldier; kind: string };
  melee: { soldier: Soldier; hit: boolean };
  capture: { zone: ZoneId; team: TeamId; neutralized: boolean };
  contest: { zone: ZoneId };
  announce: { text: string; sub?: string; tone: 'info' | 'good' | 'bad' | 'warn' };
  ping: { soldier: Soldier; pos: THREE.Vector3; kind: string; follow?: Soldier | null };
  spotted: { soldier: Soldier; by: Soldier };
  destruct: { pos: THREE.Vector3; kind: string };
  vehicleDestroyed: { pos: THREE.Vector3; kind: string; killer: Soldier | null };
  lightning: { pos: THREE.Vector3 };
  ui: { sound: string };
}

type Handler<T> = (e: T) => void;

export class EventBus {
  private handlers = new Map<keyof GameEvents, Handler<unknown>[]>();

  on<K extends keyof GameEvents>(type: K, fn: Handler<GameEvents[K]>): () => void {
    let list = this.handlers.get(type);
    if (!list) this.handlers.set(type, (list = []));
    list.push(fn as Handler<unknown>);
    return () => {
      const l = this.handlers.get(type);
      if (l) l.splice(l.indexOf(fn as Handler<unknown>), 1);
    };
  }

  emit<K extends keyof GameEvents>(type: K, e: GameEvents[K]): void {
    const list = this.handlers.get(type);
    if (!list) return;
    for (const fn of list) fn(e);
  }

  clear(): void {
    this.handlers.clear();
  }
}
