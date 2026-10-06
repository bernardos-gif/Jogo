import { describe, expect, it } from 'vitest';
import { TUNING } from '../../src/config/tuning';
import { levelFor, roundXp, xpForNext } from '../../src/net-sim/progression';
import { Scoring } from '../../src/net-sim/scoring';
import { EventBus } from '../../src/core/events';
import { Soldier } from '../../src/player/soldier';
import { newZone } from '../../src/modes/sector/logic';

const P = TUNING.progression;

describe('progression', () => {
  it('levels grow geometrically and cap at the max level', () => {
    expect(xpForNext(1)).toBe(P.levelBase);
    expect(xpForNext(2)).toBeGreaterThan(xpForNext(1));
    expect(levelFor(0)).toEqual({ level: 1, into: 0, need: P.levelBase });
    expect(levelFor(P.levelBase).level).toBe(2);
    expect(levelFor(P.levelBase - 1).level).toBe(1);
    expect(levelFor(1e12).level).toBe(P.maxLevel);
    expect(levelFor(1e12).need).toBe(0);
  });

  it('round XP is score plus win and completion bonuses', () => {
    expect(roundXp(1000, true, true)).toBe(1000 * P.xpPerScore + P.winBonus + P.completionBonus);
    expect(roundXp(1000, false, true)).toBe(1000 * P.xpPerScore + P.completionBonus);
    expect(roundXp(0, false, false)).toBe(0);
  });
});

describe('scoring', () => {
  const SC = TUNING.sector.score;
  const mk = (id: number, team: 0 | 1) => new Soldier(id, `S${id}`, team, 'assault', 'varga', 'tern', 'frag');

  it('awards kills, headshots, assists, defense, revives and spots', () => {
    const ev = new EventBus();
    const zone = newZone('A', 0, 0, 30, 0);
    const sc = new Scoring(ev, () => [zone]);
    const k = mk(1, 0), v = mk(2, 1), a = mk(3, 0), r = mk(4, 1);
    const scored: string[] = [];
    ev.on('score', (e) => scored.push(e.reason));
    k.pos.set(200, 0, 0);
    v.pos.set(210, 0, 0);
    ev.emit('kill', { victim: v, killer: k, weapon: 'tern', headshot: true, distance: 10, assists: [a], vehicle: false });
    expect(k.stats.score).toBe(SC.kill + SC.headshotBonus);
    expect(a.stats.score).toBe(SC.assist);
    // A kill inside an owned zone counts as defense.
    v.pos.set(5, 0, 5);
    ev.emit('kill', { victim: v, killer: k, weapon: 'tern', headshot: false, distance: 10, assists: [], vehicle: false });
    expect(k.stats.score).toBe(SC.kill * 2 + SC.headshotBonus + SC.defend);
    ev.emit('revive', { victim: v, reviver: r });
    expect(r.stats.score).toBe(SC.revive);
    ev.emit('spotted', { soldier: v, by: k });
    expect(k.stats.score).toBe(SC.kill * 2 + SC.headshotBonus + SC.defend + SC.spot);
    expect(scored).toContain('Headshot kill');
    expect(scored).toContain('Sector A defense');
    sc.dispose();
  });
});
