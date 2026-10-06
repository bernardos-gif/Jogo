// Local progression math: score to XP and XP to level.
import { TUNING } from '../config/tuning';

const P = TUNING.progression;

/** XP needed to go from `level` to `level + 1`. */
export function xpForNext(level: number): number {
  return Math.round(P.levelBase * Math.pow(P.levelGrowth, level - 1));
}

/** Level (1-based) and progress within it for a total XP. */
export function levelFor(xp: number): { level: number; into: number; need: number } {
  let level = 1;
  let left = xp;
  while (level < P.maxLevel && left >= xpForNext(level)) {
    left -= xpForNext(level);
    level++;
  }
  return { level, into: left, need: level >= P.maxLevel ? 0 : xpForNext(level) };
}

/** XP earned for a finished round. */
export function roundXp(score: number, won: boolean, completed: boolean): number {
  return Math.round(score * P.xpPerScore + (won ? P.winBonus : 0) + (completed ? P.completionBonus : 0));
}
