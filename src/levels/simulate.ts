// Headless synchro dive: the player's inputs come from a bot, the partner
// from the humanised plan, scored exactly like the dive scene does it.
// Used by the level bot in CI.

import { DiverSim, type DiveSetup } from '../physics/diver';
import { Bot, PERFECT_BOT, type BotParams } from '../ai/bot';
import { partnerById, planPartnerDive } from '../ai/partner';
import { parseDiveCode } from './diveCode';
import { degreeOfDifficulty } from '../scoring/dd';
import { judgeSynchro, record } from '../scoring/judges';
import { hashSeed } from '../core/rng';
import { levelSeed, zoneFor, type LevelDef } from './levels';

export const HEP_T = 1.8;

export function levelSetup(l: LevelDef, code: string): DiveSetup {
  return {
    dive: parseDiveCode(code),
    height: 10,
    zoneWidth: zoneFor(code),
    hepTime: HEP_T,
    assist: !l.modifiers.includes('noAssist'),
  };
}

export interface RoundResult {
  code: string;
  total: number;
  /** mean of the kept synchronisation awards */
  syncMean: number;
  failed: boolean;
  execA: number;
}

export function syncMeanOf(kept: { value: number; cancelled: boolean }[]): number {
  const k = kept.filter((a) => !a.cancelled);
  return k.reduce((s, a) => s + a.value, 0) / k.length;
}

/** releaseShift moves the take-off relative to the partner's jump (margin tests) */
export function simulateRound(l: LevelDef, round: number, params: Partial<BotParams> = {}, releaseShift = 0): RoundResult {
  const code = l.dives[round]!;
  const setup = levelSetup(l, code);
  const seed = levelSeed(l, round);
  const partner = planPartnerDive(setup, partnerById(l.partner), seed);
  const player = new DiverSim(setup);
  const mate = new DiverSim(setup);
  // a good player watches the partner (or the ribbon) and jumps with them
  const jump = partner.cues.find((c) => c.kind === 'jump');
  const follow = { releaseDelay: (jump ? jump.t - HEP_T : 0) + releaseShift };
  const bot = new Bot({ ...PERFECT_BOT, ...follow, ...params });
  const inputs: number[] = [];
  for (let i = 0; i < 120 * 14 && (player.phase !== 'done' || mate.phase !== 'done'); i++) {
    const inp = player.phase === 'done' ? 0 : bot.input(player);
    inputs.push(inp);
    player.step(inp);
    mate.step(partner.inputs[i] ?? 0);
  }
  const dd = degreeOfDifficulty(setup.dive, 10);
  const j = judgeSynchro(record(player), record(mate), dd, hashSeed(seed, code, inputs.length));
  return {
    code,
    total: j.score.total,
    syncMean: syncMeanOf(j.score.sync),
    failed: j.execA.failed || j.execB.failed,
    execA: j.execA.base,
  };
}

/** time the perfect bot opens in this round (for margin tests) */
export function botOpenTime(l: LevelDef, round: number): number {
  const setup = levelSetup(l, l.dives[round]!);
  const bot = new Bot(PERFECT_BOT);
  const sim = new DiverSim(setup);
  for (let i = 0; i < 120 * 14 && sim.phase !== 'done'; i++) sim.step(bot.input(sim));
  return bot.openedAt;
}

