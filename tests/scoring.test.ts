import { describe, expect, it } from 'vitest';
import { cancel, execution, judgeSynchro, panel, record, scoreIndividual, scoreSynchro, synchronisation } from '../src/scoring/judges';
import { degreeOfDifficulty } from '../src/scoring/dd';
import { parseDiveCode } from '../src/levels/diveCode';
import { Rng } from '../src/core/rng';
import { DiverSim } from '../src/physics/diver';
import { PERFECT_BOT, runBot } from '../src/ai/bot';
import { planPartnerDive, PARTNERS } from '../src/ai/partner';

describe('individual scoring (7 judges)', () => {
  it('matches the example from the diving rules: 8.0 7.5 7.5 7.5 7.5 7.5 7.0, DD 2.0 -> 45.0', () => {
    const s = scoreIndividual([8.0, 7.5, 7.5, 7.5, 7.5, 7.5, 7.0], 2.0);
    expect(s.sum).toBe(22.5);
    expect(s.total).toBe(45.0);
    expect(s.awards.filter((a) => a.cancelled).length).toBe(4);
  });

  it('cancels the two highest and two lowest', () => {
    const s = scoreIndividual([5, 9, 6, 8.5, 7, 6.5, 10], 3.2);
    expect(s.awards.filter((a) => !a.cancelled).map((a) => a.value)).toEqual([8.5, 7, 6.5]);
    expect(s.sum).toBe(22);
    expect(s.total).toBe(70.4);
  });

  it('rejects the wrong number of judges', () => {
    expect(() => scoreIndividual([5, 5, 5], 2)).toThrow();
  });
});

describe('synchro scoring (11 judges)', () => {
  it('3 + 3 + 5 judges, cancel high/low in each group, sum x DD x 0.6', () => {
    const s = scoreSynchro([7.0, 7.5, 8.0], [6.5, 7.0, 7.0], [8.0, 8.5, 8.5, 9.0, 7.5], 3.0);
    // kept: 7.5 + 7.0 + (8.0 + 8.5 + 8.5) = 39.5
    expect(s.sum).toBe(39.5);
    expect(s.total).toBe(71.1);
    expect(s.sync.filter((a) => a.cancelled).map((a) => a.value).sort()).toEqual([7.5, 9.0]);
  });

  it('cancels only one of equal extremes', () => {
    const a = cancel([7, 7, 7], 1, 1);
    expect(a.filter((x) => x.cancelled).length).toBe(2);
  });
});

describe('judge panel', () => {
  it('awards are 0..10 in steps of 0.5 and seeded', () => {
    const a = panel(new Rng(42), 7.3, 11);
    const b = panel(new Rng(42), 7.3, 11);
    expect(a).toEqual(b);
    for (const v of a) {
      expect(v * 2).toBe(Math.round(v * 2));
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(10);
    }
    expect(panel(new Rng(1), 12, 5).every((v) => v === 10)).toBe(true);
  });
});

describe('execution from measured parameters', () => {
  const dive = (code: string, params = PERFECT_BOT) => record(runBot(new DiverSim({ dive: parseDiveCode(code), height: 10, zoneWidth: 0.12 }), params).sim);

  it('a perfect bot dive scores near 10', () => {
    const e = execution(dive('105B'));
    expect(e.failed).toBe(false);
    expect(e.base).toBeGreaterThan(9);
  });

  it('a missed rip and a late opening cost points', () => {
    const good = execution(dive('205B')).base;
    const noRip = execution(dive('205B', { ...PERFECT_BOT, ripLead: -1 })).base;
    const over = execution(dive('205B', { ...PERFECT_BOT, openBias: 25 })).base;
    expect(noRip).toBeLessThan(good - 1);
    expect(over).toBeLessThan(good - 1.5);
  });

  it('wrong position is penalised', () => {
    const r = runBot(new DiverSim({ dive: parseDiveCode('105C'), height: 10, zoneWidth: 0.12 }), PERFECT_BOT).sim;
    const asPike = { ...record(r), dive: parseDiveCode('105B') };
    expect(execution(asPike).deductions.some((d) => d.reason.startsWith('Zła pozycja'))).toBe(true);
  });
});

describe('synchronisation', () => {
  it('same inputs = perfect sync; a late partner loses sync points', () => {
    const setup = { dive: parseDiveCode('205C'), height: 10, zoneWidth: 0.12, hepTime: 1.8 };
    const a = record(runBot(new DiverSim(setup)).sim);
    const b = record(runBot(new DiverSim(setup)).sim);
    expect(synchronisation(a, b).base).toBe(10);
    const late = record(runBot(new DiverSim(setup), { ...PERFECT_BOT, releaseDelay: 0.12, bendDelay: 0.15 }).sim);
    expect(synchronisation(a, late).base).toBeLessThan(8.5);
  });

  it('partner dive is deterministic for a seed', () => {
    const setup = { dive: parseDiveCode('5253B'), height: 10, zoneWidth: 0.12, hepTime: 1.8 };
    const p1 = planPartnerDive(setup, PARTNERS[3]!, 99);
    const p2 = planPartnerDive(setup, PARTNERS[3]!, 99);
    expect(p1.inputs).toEqual(p2.inputs);
    expect(p1.cues.map((c) => c.kind)).toEqual(['jump', 'pike', 'open', 'twist', 'twist', 'twist', 'rip']);
  });

  it('judgeSynchro gives a full 11-judge panel', () => {
    const setup = { dive: parseDiveCode('105B'), height: 10, zoneWidth: 0.12, hepTime: 1.8 };
    const a = record(runBot(new DiverSim(setup)).sim);
    const plan = planPartnerDive(setup, PARTNERS[0]!, 5);
    const sim = new DiverSim(setup);
    for (const i of plan.inputs) sim.step(i);
    const j = judgeSynchro(a, record(sim), degreeOfDifficulty(setup.dive), 7);
    expect(j.score.execA.length + j.score.execB.length + j.score.sync.length).toBe(11);
    expect(j.score.total).toBeGreaterThan(40);
  });
});

describe('degree of difficulty (approximate formula)', () => {
  it('grows with somersaults, twists and harder positions', () => {
    const dd = (c: string) => degreeOfDifficulty(parseDiveCode(c));
    expect(dd('101C')).toBeLessThan(dd('103C'));
    expect(dd('105C')).toBeLessThan(dd('107C'));
    expect(dd('107C')).toBeLessThan(dd('107B'));
    expect(dd('5253B')).toBeGreaterThan(dd('205B'));
    expect(dd('109C')).toBeLessThanOrEqual(4.5);
    expect(dd('101C')).toBeGreaterThanOrEqual(1.0);
  });
});
