// Sector Control rules as pure functions: zone capture (attacker-scaled, contested zones freeze,
// neutralize before capture), ticket bleed from the zone majority, death costs and the winner.
import { TUNING } from '../../config/tuning';
import type { TeamId, ZoneId } from '../../config/content';

export type Owner = TeamId | -1;

export interface ZoneState {
  id: ZoneId;
  x: number;
  z: number;
  radius: number;
  owner: Owner;
  /** -1..1: +1 is full team 0 control, -1 full team 1 control. */
  control: number;
  /** Soldiers of each team inside the zone this tick. */
  counts: [number, number];
  contested: boolean;
  /** Team currently moving the control value (-1 when idle or frozen). */
  capturing: Owner;
}

export type ZoneEvent = { kind: 'captured'; team: TeamId } | { kind: 'neutralized'; team: TeamId; from: TeamId } | null;

export function newZone(id: ZoneId, x: number, z: number, radius: number, owner: Owner = -1): ZoneState {
  return { id, x, z, radius, owner, control: owner === 0 ? 1 : owner === 1 ? -1 : 0, counts: [0, 0], contested: false, capturing: -1 };
}

const sign = (t: TeamId) => (t === 0 ? 1 : -1);

/** Capture rate multiplier for n attackers (1 for one, growing per extra, capped). */
export function captureMul(n: number, S = TUNING.sector): number {
  if (n <= 0) return 0;
  return Math.min(S.maxCaptureMul, 1 + (n - 1) * S.capturePerExtra);
}

/**
 * Advances one zone by dt given the soldiers inside. Returns the event the step caused.
 * Only one team inside moves the control value; both teams inside freeze it (contested).
 */
export function stepZone(z: ZoneState, counts: [number, number], dt: number, S = TUNING.sector): ZoneEvent {
  z.counts[0] = counts[0];
  z.counts[1] = counts[1];
  z.contested = counts[0] > 0 && counts[1] > 0;
  z.capturing = -1;
  if (z.contested) return null;
  const base = dt / S.captureSeconds;
  const team: TeamId | -1 = counts[0] > 0 ? 0 : counts[1] > 0 ? 1 : -1;
  if (team === -1) {
    // Nobody inside: an owned zone drifts back to full control.
    if (z.owner !== -1) {
      const target = sign(z.owner);
      const step = base * S.regainMul;
      z.control = target > 0 ? Math.min(1, z.control + step) : Math.max(-1, z.control - step);
    }
    return null;
  }
  const n = counts[team];
  const dir = sign(team);
  const full = z.owner === team && z.control * dir >= 1;
  if (full) return null;
  z.capturing = team;
  const prev = z.control;
  z.control = Math.max(-1, Math.min(1, z.control + dir * base * captureMul(n, S)));
  // Crossing zero from the other side neutralizes the previous owner.
  if (z.owner !== -1 && z.owner !== team && prev * dir < 0 && z.control * dir >= 0) {
    const from = z.owner;
    z.owner = -1;
    return { kind: 'neutralized', team, from };
  }
  if (z.owner !== team && z.control * dir >= 1) {
    z.owner = team;
    z.control = dir;
    return { kind: 'captured', team };
  }
  return null;
}

/** Zones owned by each team. */
export function ownedCounts(zones: readonly ZoneState[]): [number, number] {
  const c: [number, number] = [0, 0];
  for (const z of zones) if (z.owner !== -1) c[z.owner]++;
  return c;
}

/** Ticket loss per second for each team from the zone majority. */
export function bleedRates(zones: readonly ZoneState[], S = TUNING.sector): [number, number] {
  const [a, b] = ownedCounts(zones);
  const lead = Math.abs(a - b);
  const rate = S.bleed[Math.min(lead, S.bleed.length - 1)];
  if (a > b) return [0, rate];
  if (b > a) return [rate, 0];
  return [0, 0];
}

export interface TicketState {
  tickets: [number, number];
}

/** Applies bleed for dt. Returns the losing team when tickets run out, else -1. */
export function stepTickets(t: TicketState, zones: readonly ZoneState[], dt: number, S = TUNING.sector): Owner {
  const [r0, r1] = bleedRates(zones, S);
  t.tickets[0] = Math.max(0, t.tickets[0] - r0 * dt);
  t.tickets[1] = Math.max(0, t.tickets[1] - r1 * dt);
  return loser(t);
}

/** A death costs its team tickets. */
export function onDeath(t: TicketState, team: TeamId, S = TUNING.sector): Owner {
  t.tickets[team] = Math.max(0, t.tickets[team] - S.ticketsPerDeath);
  return loser(t);
}

export function loser(t: TicketState): Owner {
  if (t.tickets[0] <= 0 && t.tickets[1] <= 0) return 0;
  if (t.tickets[0] <= 0) return 0;
  if (t.tickets[1] <= 0) return 1;
  return -1;
}

/** True when a point lies inside the zone's capture radius (horizontal distance). */
export function inZone(z: ZoneState, x: number, zz: number): boolean {
  const dx = x - z.x, dz = zz - z.z;
  return dx * dx + dz * dz <= z.radius * z.radius;
}
