// Campaign flow: starting a level, carrying a final across its rounds,
// the verdict (pass, stars, place) and what it saves and unlocks.

import type Phaser from 'phaser';
import type { DiveResult } from '../scenes/ResultsScene';
import type { DiveConfig } from '../scenes/DiveScene';
import { getSave, save, type SaveData } from '../core/save';
import { COUNTRIES } from './countries';
import { partnerById } from '../ai/partner';
import { arenaFor, isFinal, judgeLevel, level, LEVELS, levelSeed, rivalsFor, zoneFor, type LevelDef, type Unlock } from './levels';
import { syncMeanOf } from './simulate';

export interface LevelOutcome {
  passed: boolean;
  stars: number;
  title: string;
  detail: string;
  next?: () => void;
  nextLabel?: string;
}

export function levelConfig(l: LevelDef, round = 0): DiveConfig {
  const code = l.dives[round]!;
  return {
    mode: 'level',
    code,
    height: 10,
    synchro: true,
    partner: l.partner,
    zoneWidth: zoneFor(code),
    ribbon: l.ribbon,
    seed: levelSeed(l, round),
    arena: arenaFor(l),
    levelId: l.id,
    round,
    modifiers: l.modifiers,
  };
}

export function startLevel(scene: Phaser.Scene, id: number, round = 0): void {
  if (round === 0) run = null;
  scene.scene.start('Dive', levelConfig(level(id), round));
}

export function isUnlocked(id: number, s: SaveData = getSave()): boolean {
  return id === 1 || (s.levels[String(id - 1)]?.stars ?? 0) > 0;
}

/** the first level not passed yet (or the last one) */
export function currentLevel(s: SaveData = getSave()): number {
  const l = LEVELS.find((x) => !(s.levels[String(x.id)]?.stars ?? 0));
  return l ? l.id : LEVELS.length;
}

interface RoundScore {
  total: number;
  sync: number;
  failed: boolean;
}

/** a final in progress: scores of the rounds done so far */
let run: { id: number; rounds: RoundScore[] } | null = null;

const sum = (a: number[]) => Math.round(a.reduce((s, x) => s + x, 0) * 100) / 100;
const country = (code: string) => COUNTRIES.find((c) => c.code === code)?.name ?? code;

export function unlockText(u: Unlock): string {
  const out: string[] = [];
  if (u.partner) out.push(`partner ${partnerById(u.partner).name}`);
  if (u.outfit !== undefined) out.push('nowy strój');
  if (u.arena) out.push(u.arena === 'night' ? 'hala nocna' : 'basen w plenerze');
  return out.join(', ');
}

function applyUnlock(s: SaveData, u: Unlock | undefined): boolean {
  if (!u) return false;
  let fresh = false;
  const add = <T>(list: T[], v: T | undefined) => {
    if (v !== undefined && !list.includes(v)) {
      list.push(v);
      fresh = true;
    }
  };
  add(s.unlocks.partners, u.partner);
  add(s.unlocks.outfits, u.outfit);
  add(s.unlocks.arenas, u.arena);
  return fresh;
}

export function onLevelResult(r: DiveResult, total: number, scene: Phaser.Scene): LevelOutcome | null {
  const cfg = r.cfg;
  if (cfg.mode !== 'level' || cfg.levelId === undefined || !r.synchro) return null;
  const l = level(cfg.levelId);
  const round = cfg.round ?? 0;
  const n = l.dives.length;
  const j = r.synchro;
  const score: RoundScore = { total, sync: syncMeanOf(j.score.sync), failed: j.execA.failed || j.execB.failed };

  if (!run || run.id !== l.id) run = { id: l.id, rounds: [] };
  run.rounds[round] = score;
  run.rounds.length = round + 1;
  const done = run.rounds;
  const soFar = sum(done.map((x) => x.total));

  // a final still running
  if (isFinal(l) && round < n - 1 && !score.failed) {
    const rivals = rivalsFor(l).map((x) => ({ ...x, part: sum(x.rounds.slice(0, round + 1)) }));
    const place = 1 + rivals.filter((x) => x.part > soFar).length;
    const leader = [...rivals].sort((a, b) => b.part - a.part)[0]!;
    return {
      passed: place <= 3,
      stars: 0,
      title: `Seria ${round + 1}/${n}: razem ${soFar.toFixed(2)}`,
      detail: `Miejsce ${place}/${rivals.length + 1} · ${leader.part > soFar ? `${country(leader.country)} ${leader.part.toFixed(1)}` : 'prowadzicie!'}`,
      next: () => startLevel(scene, l.id, round + 1),
      nextLabel: 'NASTĘPNA SERIA',
    };
  }

  const failed = done.some((x) => x.failed);
  const sync = done.reduce((s, x) => s + x.sync, 0) / done.length;
  const v = judgeLevel(l, soFar, sync, failed);
  run = null;

  const s = getSave();
  const key = String(l.id);
  const prev = s.levels[key] ?? { stars: 0, best: 0 };
  let unlocked = false;
  if (v.passed) {
    s.levels[key] = { stars: Math.max(prev.stars, v.stars), best: Math.max(prev.best, soFar) };
    unlocked = applyUnlock(s, l.unlock);
    save(s);
  } else if (soFar > prev.best && prev.stars > 0) {
    s.levels[key] = { ...prev, best: soFar };
    save(s);
  }

  const place = v.place !== undefined ? `Miejsce ${v.place}. ` : '';
  const title = v.passed ? (l.id === LEVELS.length ? 'ZŁOTO! KAMPANIA UKOŃCZONA' : `ZALICZONE! ${place}`) : `NIEZALICZONE. ${place}`;
  let detail: string;
  if (!v.passed) detail = v.reason;
  else if (unlocked && l.unlock) detail = `Odblokowano: ${unlockText(l.unlock)}`;
  else detail = v.stars < 3 ? `${v.stars + 1}★ od ${l.stars[v.stars - 1]!.toFixed(1)} pkt` : `Wynik ${soFar.toFixed(2)}`;

  const nextId = l.id + 1;
  const out: LevelOutcome = { passed: v.passed, stars: v.stars, title: title.trim(), detail: detail.slice(0, 72) };
  if (v.passed && nextId <= LEVELS.length) {
    out.next = () => startLevel(scene, nextId);
    out.nextLabel = `POZIOM ${nextId}`;
  } else if (!v.passed && isFinal(l)) {
    out.next = () => startLevel(scene, l.id);
    out.nextLabel = 'FINAŁ OD NOWA';
  }
  return out;
}
