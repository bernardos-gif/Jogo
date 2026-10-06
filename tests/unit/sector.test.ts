import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { TUNING } from '../../src/config/tuning';
import { newZone, stepZone, captureMul, bleedRates, stepTickets, onDeath, inZone, ownedCounts, type ZoneState } from '../../src/modes/sector/logic';
import { spawnOptions, squadmateSpawnable, zoneSpawnable } from '../../src/modes/sector/spawns';
import { Soldier } from '../../src/player/soldier';

const S = TUNING.sector;
const DT = 1 / 60;

function run(z: ZoneState, counts: [number, number], seconds: number) {
  const events = [];
  for (let t = 0; t < seconds; t += DT) {
    const e = stepZone(z, counts, DT);
    if (e) events.push(e);
  }
  return events;
}

describe('zone capture', () => {
  it('one attacker captures a neutral zone in captureSeconds', () => {
    const z = newZone('A', 0, 0, 30);
    const ev = run(z, [1, 0], S.captureSeconds - 0.5);
    expect(z.owner).toBe(-1);
    expect(ev).toHaveLength(0);
    const ev2 = run(z, [1, 0], 1);
    expect(z.owner).toBe(0);
    expect(ev2).toEqual([{ kind: 'captured', team: 0 }]);
    expect(z.control).toBe(1);
  });

  it('more attackers capture faster, up to the cap', () => {
    expect(captureMul(1)).toBe(1);
    expect(captureMul(2)).toBeCloseTo(1 + S.capturePerExtra);
    expect(captureMul(3)).toBeGreaterThan(captureMul(2));
    expect(captureMul(40)).toBe(S.maxCaptureMul);
    const z = newZone('B', 0, 0, 30);
    run(z, [3, 0], S.captureSeconds / captureMul(3) + 0.2);
    expect(z.owner).toBe(0);
  });

  it('contested zones freeze', () => {
    const z = newZone('C', 0, 0, 30);
    run(z, [2, 0], 5);
    const c = z.control;
    run(z, [2, 1], 30);
    expect(z.control).toBe(c);
    expect(z.contested).toBe(true);
    expect(z.capturing).toBe(-1);
  });

  it('an enemy zone is neutralized before it is captured', () => {
    const z = newZone('D', 0, 0, 30, 1);
    expect(z.control).toBe(-1);
    const ev = run(z, [1, 0], S.captureSeconds * 2 + 0.5);
    expect(ev[0]).toEqual({ kind: 'neutralized', team: 0, from: 1 });
    expect(ev[1]).toEqual({ kind: 'captured', team: 0 });
    expect(z.owner).toBe(0);
  });

  it('an empty owned zone drifts back to full control', () => {
    const z = newZone('E', 0, 0, 30, 0);
    run(z, [0, 2], 4);
    expect(z.control).toBeLessThan(1);
    expect(z.owner).toBe(0);
    run(z, [0, 0], S.captureSeconds * 2);
    expect(z.control).toBe(1);
  });

  it('inZone uses the horizontal radius', () => {
    const z = newZone('A', 10, 10, 5);
    expect(inZone(z, 13, 13)).toBe(true);
    expect(inZone(z, 16, 10)).toBe(false);
  });
});

describe('tickets', () => {
  const zones = (owners: (0 | 1 | -1)[]) => owners.map((o, i) => newZone((['A', 'B', 'C', 'D', 'E'] as const)[i], 0, 0, 10, o));

  it('the zone majority bleeds the other team, scaled by the lead', () => {
    expect(bleedRates(zones([0, 0, 1, -1, -1]))).toEqual([0, S.bleed[1]]);
    expect(bleedRates(zones([1, 1, 1, 0, -1]))).toEqual([S.bleed[2], 0]);
    expect(bleedRates(zones([0, 1, -1, -1, -1]))).toEqual([0, 0]);
    expect(bleedRates(zones([0, 0, 0, 0, 0]))).toEqual([0, S.bleed[5]]);
    expect(ownedCounts(zones([0, 0, 1, -1, 1]))).toEqual([2, 2]);
  });

  it('bleed and deaths drain tickets until a team loses', () => {
    const t = { tickets: [S.tickets, S.tickets] as [number, number] };
    const zs = zones([0, 0, 0, -1, -1]);
    expect(stepTickets(t, zs, 10)).toBe(-1);
    expect(t.tickets[1]).toBeCloseTo(S.tickets - S.bleed[3] * 10);
    expect(t.tickets[0]).toBe(S.tickets);
    expect(onDeath(t, 0)).toBe(-1);
    expect(t.tickets[0]).toBe(S.tickets - S.ticketsPerDeath);
    t.tickets[1] = 0.5;
    expect(stepTickets(t, zs, 10)).toBe(1);
    expect(t.tickets[1]).toBe(0);
  });
});

describe('spawn rules', () => {
  const mk = (id: number, team: 0 | 1, x: number) => {
    const s = new Soldier(id, `S${id}`, team, 'assault', 'varga', 'tern', 'frag');
    s.pos.set(x, 0, 0);
    s.lastCombatT = -100;
    return s;
  };

  it('HQ is always available; owned quiet zones are; contested or enemy zones are not', () => {
    const owned = newZone('A', 0, 0, 30, 0);
    const contested = newZone('B', 100, 0, 30, 0);
    contested.contested = true;
    const taking = newZone('C', 200, 0, 30, 0);
    taking.capturing = 1;
    const enemy = newZone('D', 300, 0, 30, 1);
    expect(zoneSpawnable(owned, 0)).toBe(true);
    expect(zoneSpawnable(contested, 0)).toBe(false);
    expect(zoneSpawnable(taking, 0)).toBe(false);
    expect(zoneSpawnable(enemy, 0)).toBe(false);
    const opts = spawnOptions(0, [owned, contested, taking, enemy], new THREE.Vector3(0, 0, 500), [], null, [], 0);
    expect(opts.map((o) => o.key)).toEqual(['hq', 'A']);
  });

  it('squadmates are spawnable only alive, upright, out of combat and with no enemy close', () => {
    const me = mk(1, 0, 0);
    const mate = mk(2, 0, 50);
    const foe = mk(3, 1, 500);
    const all = [me, mate, foe];
    expect(squadmateSpawnable(mate, all, 10)).toBe(true);
    mate.lastCombatT = 8;
    expect(squadmateSpawnable(mate, all, 10)).toBe(false);
    mate.lastCombatT = -100;
    foe.pos.set(50 + S.squadSpawnEnemyRadius * 0.5, 0, 0);
    expect(squadmateSpawnable(mate, all, 10)).toBe(false);
    foe.pos.set(500, 0, 0);
    mate.downed = true;
    expect(squadmateSpawnable(mate, all, 10)).toBe(false);
    mate.downed = false;
    mate.state = 'parachute';
    expect(squadmateSpawnable(mate, all, 10)).toBe(false);
    mate.state = 'ground';
    const opts = spawnOptions(0, [], new THREE.Vector3(), [me, mate], me, all, 10);
    expect(opts.map((o) => o.kind)).toEqual(['hq', 'squad']);
    expect(opts[1].mate).toBe(mate);
  });
});
