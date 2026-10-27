// Campaign levels: the data lives in levels.json, this file only types it
// and derives values (gold zone width, rivals for finals, pass/stars).

import data from './levels.json';
import { parseDiveCode } from './diveCode';
import { degreeOfDifficulty } from '../scoring/dd';
import { Rng, hashSeed } from '../core/rng';
import { COUNTRIES } from './countries';

export type Modifier = 'noLine' | 'noAssist' | 'shortRibbon' | 'night' | 'outdoor';

export interface Unlock {
  partner?: string;
  outfit?: number;
  arena?: string;
}

export interface LevelDef {
  id: number;
  name: string;
  /** dive code, or several for a final */
  dives: string[];
  partner: string;
  /** minimum mean of the kept synchronisation awards (0..10) */
  syncMin: number;
  /** points needed to pass (a final: total of all rounds) */
  scoreMin: number;
  /** points for 2 and 3 stars */
  stars: [number, number];
  ribbon: boolean;
  modifiers: Modifier[];
  tip: string;
  unlock?: Unlock;
  /** finals: number of AI rival pairs on the board */
  rivals?: number;
}

export const LEVELS: LevelDef[] = (data as { levels: LevelDef[] }).levels;

export function level(id: number): LevelDef {
  const l = LEVELS.find((x) => x.id === id);
  if (!l) throw new Error(`No level ${id}`);
  return l;
}

export function isFinal(l: LevelDef): boolean {
  return l.dives.length > 1;
}

/** the gold zone narrows for harder dives */
export function zoneFor(code: string): number {
  const dd = degreeOfDifficulty(parseDiveCode(code));
  return Math.round(Math.min(0.22, Math.max(0.09, 0.22 - (dd - 1.2) * 0.045)) * 1000) / 1000;
}

export function arenaFor(l: LevelDef): 'day' | 'night' | 'outdoor' {
  if (l.modifiers.includes('night')) return 'night';
  if (l.modifiers.includes('outdoor')) return 'outdoor';
  return 'day';
}

export function levelSeed(l: LevelDef, round: number): number {
  return hashSeed('level', l.id, round);
}

export interface Rival {
  country: string;
  rounds: number[];
  total: number;
}

/** AI rival pairs for a final: deterministic per level */
export function rivalsFor(l: LevelDef): Rival[] {
  const rng = new Rng(hashSeed('rivals', l.id));
  const n = l.rivals ?? 5;
  const pool = COUNTRIES.filter((c) => c.code !== 'POL');
  const out: Rival[] = [];
  const tier = l.id / 50;
  for (let i = 0; i < n; i++) {
    const country = pool[(i * 7 + l.id) % pool.length]!.code;
    const skill = 0.6 + tier * 0.22 + (i / n) * 0.12 + rng.range(-0.03, 0.03);
    const rounds = l.dives.map((code) => {
      const max = 30 * degreeOfDifficulty(parseDiveCode(code));
      return Math.round(max * Math.min(0.97, skill + rng.gauss() * 0.04) * 100) / 100;
    });
    out.push({ country, rounds, total: Math.round(rounds.reduce((a, b) => a + b, 0) * 100) / 100 });
  }
  return out.sort((a, b) => b.total - a.total);
}

export interface Verdict {
  passed: boolean;
  stars: number;
  /** why it failed (Polish) */
  reason: string;
  place?: number;
}

/** pass/fail and stars from a score (a final: total over the rounds) */
export function judgeLevel(l: LevelDef, total: number, syncMean: number, failedDive: boolean): Verdict {
  let place: number | undefined;
  let reason = '';
  let passed = total >= l.scoreMin && syncMean >= l.syncMin && !failedDive;
  if (failedDive) reason = 'Nieudany skok';
  else if (syncMean < l.syncMin) reason = `Synchronizacja ${syncMean.toFixed(1)} < ${l.syncMin.toFixed(1)}`;
  else if (total < l.scoreMin) reason = `Za mało punktów (${total.toFixed(1)} / ${l.scoreMin})`;
  if (isFinal(l)) {
    const rivals = rivalsFor(l);
    place = 1 + rivals.filter((r) => r.total > total).length;
    if (place > 3) {
      passed = false;
      reason ||= `Miejsce ${place}: poza podium`;
    }
  }
  const stars = passed ? 1 + (total >= l.stars[0] ? 1 : 0) + (total >= l.stars[1] ? 1 : 0) : 0;
  return place === undefined ? { passed, stars, reason } : { passed, stars, reason, place };
}
