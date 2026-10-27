import { describe, expect, it } from 'vitest';
import { BounceSim, BASE_H, type BounceEvent } from '../src/bounce/sim';
import { Combo, trickName, trickValue, type Trick } from '../src/bounce/score';
import { IN } from '../src/physics/diver';

/** A player who follows the landing line: spins `turns` times (or not), opens when the line is green, sticks the landing. */
function player(sim: BounceSim, plan: { spin: number; turns: number; bank?: boolean; pike?: boolean; stayTucked?: boolean }) {
  let launchAxis = 0;
  let seen = 0;
  let opened = false;
  let stuck = false;
  return (): number => {
    for (; seen < sim.events.length; seen++) {
      const e = sim.events[seen]!;
      if (e.type === 'launch') {
        launchAxis = sim.axisAngle;
        opened = false;
        stuck = false;
      }
    }
    let m = 0;
    if (sim.phase === 'bed') {
      if (plan.spin > 0) m |= IN.RIGHT;
      if (plan.spin < 0) m |= IN.LEFT;
      if (plan.bank) m |= IN.DOWN;
      return m;
    }
    if (sim.phase !== 'air') return 0;
    const step = plan.bank ? Math.PI : Math.PI * 2;
    if (sim.L !== 0 && !opened) {
      const done = Math.abs(sim.axisAngle - launchAxis);
      if (!plan.stayTucked && done > (plan.turns - 1) * step + 0.2 && Math.abs(sim.predictError()) < 4) opened = true;
      else return IN.ACTION | (plan.pike ? IN.DOWN : 0);
    }
    if (sim.armed && !stuck && sim.timeToContact() <= 0.06) {
      stuck = true;
      return IN.ACTION;
    }
    return 0;
  };
}

function runUntil(sim: BounceSim, inputFn: () => number, done: (e: BounceEvent) => boolean, maxS = 20): BounceEvent | undefined {
  const start = sim.events.length;
  for (let i = 0; i < maxS * 120; i++) {
    sim.step(inputFn());
    for (let k = start; k < sim.events.length; k++) if (done(sim.events[k]!)) return sim.events[k];
  }
  return undefined;
}

const isLand = (e: BounceEvent) => e.type === 'land' || e.type === 'bail';

describe('Odbicie: trampoline run', () => {
  it('a stuck straight bounce is PERFECT and the next bounce is higher', () => {
    const sim = new BounceSim();
    const e = runUntil(sim, player(sim, { spin: 0, turns: 0 }), isLand);
    expect(e).toMatchObject({ type: 'land', grade: 'PERFECT', points: 0 });
    expect(sim.height).toBeGreaterThan(BASE_H);
  });

  it('a straight bounce without the stick is only GOOD', () => {
    const sim = new BounceSim();
    const e = runUntil(sim, () => 0, isLand);
    expect(e).toMatchObject({ type: 'land', grade: 'GOOD' });
    expect(sim.height).toBe(BASE_H);
  });

  it('following the landing line lands a back tuck salto', () => {
    const sim = new BounceSim();
    const p = player(sim, { spin: 1, turns: 1 });
    runUntil(sim, p, isLand);
    const e = runUntil(sim, p, isLand);
    expect(e?.type).toBe('land');
    if (e?.type !== 'land') return;
    expect(e.grade).toBe('PERFECT');
    expect(e.trick).toMatchObject({ turns: 1, pos: 'tuck', dir: -1, halfTwists: 0 });
    expect(trickName(e.trick)).toBe('SALTO W TYŁ KUCZNE');
    expect(sim.combo.sum).toBe(200);
  });

  it('a double needs more height: from a higher bounce it lands', () => {
    const sim = new BounceSim();
    const pump = player(sim, { spin: 0, turns: 0 });
    for (let k = 0; k < 4; k++) runUntil(sim, pump, isLand);
    expect(sim.height).toBeGreaterThan(3.5);
    const e = runUntil(sim, player(sim, { spin: -1, turns: 2 }), isLand);
    expect(e).toMatchObject({ type: 'land', trick: { turns: 2, dir: 1 } });
  });

  it('staying tucked is a bail and loses the combo', () => {
    const sim = new BounceSim();
    runUntil(sim, player(sim, { spin: 0, turns: 0 }), isLand);
    runUntil(sim, player(sim, { spin: 1, turns: 1 }), isLand);
    expect(sim.combo.sum).toBeGreaterThan(0);
    const e = runUntil(sim, player(sim, { spin: 1, turns: 1, stayTucked: true }), isLand);
    expect(e?.type).toBe('bail');
    expect(sim.combo.sum).toBe(0);
    expect(sim.height).toBe(BASE_H);
  });

  it('a ripped dive into the pool banks the combo twice over', () => {
    const sim = new BounceSim();
    runUntil(sim, player(sim, { spin: 0, turns: 0 }), isLand);
    runUntil(sim, player(sim, { spin: 1, turns: 1 }), isLand);
    const before = sim.combo.sum;
    const e = runUntil(sim, player(sim, { spin: 1, turns: 3, bank: true }), (x) => x.type === 'entry');
    expect(e?.type).toBe('entry');
    if (e?.type !== 'entry') return;
    expect(e.grade).toBe('RIP');
    expect(e.trick.turns).toBe(3);
    expect(e.x).toBeLessThan(24);
    // salto (200) + 1½ tuck into the pool, two kinds of trick: x2, rip: x2
    const dive: Trick = { turns: 3, pos: 'tuck', halfTwists: 0, dir: -1, pool: true };
    expect(e.banked).toBe(Math.round((before + trickValue(dive)) * 2 * 2));
    expect(sim.score).toBe(e.banked);
    const back = runUntil(sim, () => 0, (x) => x.type === 'respawn');
    expect(back).toBeDefined();
  });

  it('the run ends when the clock runs out and unbanked points are lost', () => {
    const sim = new BounceSim();
    sim.timeLeft = 3;
    const p = player(sim, { spin: 1, turns: 1 });
    const e = runUntil(sim, p, (x) => x.type === 'over', 30);
    expect(e).toMatchObject({ type: 'over', score: 0 });
    expect(sim.phase).toBe('over');
  });

  it('is deterministic', () => {
    const a = new BounceSim();
    const b = new BounceSim();
    const pa = player(a, { spin: 1, turns: 1 });
    const pb = player(b, { spin: 1, turns: 1 });
    for (let i = 0; i < 120 * 12; i++) {
      a.step(pa());
      b.step(pb());
    }
    expect(a.snapshot()).toEqual(b.snapshot());
    expect(a.events).toEqual(b.events);
  });
});

describe('Odbicie: combo', () => {
  const t = (over: Partial<Trick>): Trick => ({ turns: 1, pos: 'tuck', halfTwists: 0, dir: -1, pool: false, ...over });
  it('new kinds of trick raise the multiplier, repeats are worth half', () => {
    const c = new Combo();
    expect(c.add(t({}))).toBe(200);
    expect(c.add(t({}))).toBe(100);
    expect(c.add(t({ pos: 'pike' }))).toBe(300);
    expect(c.mult).toBe(2);
    expect(c.value(2)).toBe(2400);
  });
  it('a plain bounce is not a trick', () => {
    const c = new Combo();
    expect(c.add(t({ turns: 0 }))).toBe(0);
    expect(c.empty).toBe(true);
  });
  it('names tricks in Polish', () => {
    expect(trickName(t({ turns: 2, pos: 'pike', halfTwists: 1, dir: 1 }))).toBe('2 SALTA W PRZÓD ŁAMANE + ½ ŚR.');
    expect(trickName(t({ turns: 3, pool: true }))).toBe('1½ SALTA W TYŁ KUCZNE');
  });
});
