import { describe, expect, it } from 'vitest';
import { POSES, inertia } from '../src/physics/body';
import { DiverSim, IN, idealAngularMomentum, type DiveSetup } from '../src/physics/diver';
import { parseDiveCode } from '../src/levels/diveCode';
import { Bot, PERFECT_BOT, runBot } from '../src/ai/bot';

const setup = (code: string, extra: Partial<DiveSetup> = {}): DiveSetup => ({
  dive: parseDiveCode(code),
  height: 10,
  zoneWidth: 0.12,
  ...extra,
});

/** run until take-off with a perfect release, then feed `flight(sim)` */
function fly(s: DiveSetup, flight: (sim: DiverSim) => number, maxTicks = 2000): DiverSim {
  const sim = new DiverSim(s);
  const bot = new Bot(PERFECT_BOT);
  for (let i = 0; i < maxTicks && sim.phase !== 'done'; i++) {
    sim.step(sim.phase === 'flight' || sim.phase === 'water' ? flight(sim) : bot.input(sim));
  }
  return sim;
}

describe('body inertia', () => {
  it('matches the calibration targets', () => {
    expect(inertia(POSES.openHead)).toBeCloseTo(1.0, 5);
    expect(inertia(POSES.pike)).toBeGreaterThan(0.44);
    expect(inertia(POSES.pike)).toBeLessThan(0.56);
    expect(inertia(POSES.tuck)).toBeGreaterThan(0.26);
    expect(inertia(POSES.tuck)).toBeLessThan(0.34);
  });
});

describe('flight', () => {
  it('keeps angular momentum constant in the air', () => {
    const Ls: number[] = [];
    const prod: number[] = [];
    let n = 0;
    fly(setup('105C'), (sim) => {
      if (sim.phase === 'flight') {
        Ls.push(sim.L);
        prod.push(sim.omega * sim.inertia);
      }
      n++;
      // tuck, open, tuck again: shape changes must not change L
      return n % 60 < 30 ? IN.ACTION : 0;
    });
    expect(Ls.length).toBeGreaterThan(100);
    for (const L of Ls) expect(L).toBe(Ls[0]);
    for (const p of prod) expect(p).toBeCloseTo(Ls[0]!, 9);
  });

  it('←/→ in flight trim the spin with the arms', () => {
    // 401A turns backwards (L < 0): ← speeds it up, → slows it down
    const omegaAt = (input: number) => {
      let w = 0;
      fly(setup('401A'), (sim) => {
        if (sim.phase === 'flight' && sim.flightProgress > 0.3 && w === 0) w = Math.abs(sim.omega);
        return input;
      });
      return w;
    };
    const plain = omegaAt(0);
    const sim = new DiverSim(setup('401A'));
    expect(sim.dive.rot).toBe(-1);
    // 401A opens with the arms overhead (largest I), so only speeding up is possible
    expect(omegaAt(IN.LEFT)).toBeGreaterThan(plain * 1.1);
    expect(omegaAt(IN.RIGHT)).toBeCloseTo(plain, 6);
    // feet-first 102A (forward, L > 0) has the arms down: ← only slows it
    const f = (input: number) => {
      let w = 0;
      fly(setup('102A'), (s) => {
        if (s.phase === 'flight' && s.flightProgress > 0.3 && w === 0) w = Math.abs(s.omega);
        return input;
      });
      return w;
    };
    expect(f(IN.LEFT)).toBeLessThan(f(0) * 0.9);
  });

  it('rotates faster tucked than piked than open', () => {
    const omegaAt = (input: number) => {
      let w = 0;
      fly(setup('105C'), (sim) => {
        if (sim.phase === 'flight' && sim.flightProgress > 0.3 && w === 0) w = Math.abs(sim.omega);
        return input;
      });
      return w;
    };
    const open = omegaAt(0);
    const pike = omegaAt(IN.ACTION | IN.DOWN);
    const tuck = omegaAt(IN.ACTION);
    expect(pike).toBeGreaterThan(open * 1.7);
    expect(tuck).toBeGreaterThan(pike * 1.3);
    expect(tuck / open).toBeGreaterThan(2.8);
    expect(tuck / open).toBeLessThan(3.8);
  });

  it('follows a ballistic path for the centre of mass', () => {
    const ys: number[] = [];
    fly(setup('103C'), (sim) => {
      if (sim.phase === 'flight') ys.push(sim.y);
      return IN.ACTION;
    });
    // constant second difference = -g dt^2
    const d2 = ys.slice(2, 50).map((y, i) => y - 2 * ys[i + 1]! + ys[i]!);
    for (const v of d2) expect(v).toBeCloseTo(d2[0]!, 10);
  });
});

describe('determinism', () => {
  it('same seed and inputs give an identical dive', () => {
    const a = runBot(new DiverSim(setup('5253B')));
    const replay = new DiverSim(setup('5253B'));
    for (const i of a.inputs) replay.step(i);
    expect(replay.x).toBe(a.sim.x);
    expect(replay.y).toBe(a.sim.y);
    expect(replay.theta).toBe(a.sim.theta);
    expect(replay.entry).toEqual(a.sim.entry);
    expect(replay.trace).toEqual(a.sim.trace);
  });
});

describe('perfect bot', () => {
  const codes = ['101B', '103C', '105B', '107B', '109C', '201A', '205B', '207C', '305C', '405C', '407C', '5132D', '5253B', '5355B'];
  for (const code of codes) {
    it(`${code} enters near vertical with a rip`, () => {
      const { sim } = runBot(new DiverSim(setup(code)));
      const e = sim.entry!;
      expect(sim.crashed).toBe(false);
      expect(Math.abs(e.angleErr)).toBeLessThan(5);
      expect(e.rip).toBe('PERFECT');
      expect(e.halfTwistsDone).toBe(sim.dive.halfTwists);
      expect(e.twistInProgress).toBe(false);
      expect(e.clearance).toBeGreaterThan(0.1);
    });
  }
});

describe('take-off', () => {
  it('weak release under-rotates, strong release over-rotates', () => {
    const weak = runBot(new DiverSim(setup('105C')), { ...PERFECT_BOT, powerOffset: -0.3 }).sim;
    const perfect = runBot(new DiverSim(setup('105C')), PERFECT_BOT).sim;
    expect(weak.takeoff!.label).not.toBe('PERFECT');
    expect(Math.abs(weak.takeoff!.L)).toBeLessThan(Math.abs(perfect.takeoff!.L));
    expect(weak.entry!.height).toBeLessThan(perfect.entry!.height);
  });

  it('gold zone gives the ideal angular momentum', () => {
    const s = setup('107B');
    const sim = runBot(new DiverSim(s)).sim;
    expect(sim.takeoff!.label).toBe('PERFECT');
    expect(sim.takeoff!.L).toBeCloseTo(idealAngularMomentum(s), 9);
  });

  it('weak inward take-off hits the platform', () => {
    const sim = runBot(new DiverSim(setup('405C', { zoneWidth: 0.02 })), { ...PERFECT_BOT, powerOffset: -0.75 }).sim;
    expect(sim.crashed).toBe(true);
  });
});

describe('entry', () => {
  it('staying tucked into the water is a tuck entry', () => {
    const sim = fly(setup('103C'), () => IN.ACTION);
    expect(sim.entry!.tuckEntry).toBe(true);
  });

  it('rip timing labels', () => {
    const lead = (ripLead: number) => runBot(new DiverSim(setup('203C')), { ...PERFECT_BOT, ripLead }).sim.entry!.rip;
    expect(lead(0.06)).toBe('PERFECT');
    expect(lead(0.15)).toBe('GOOD');
    expect(lead(0.27)).toBe('EARLY');
    expect(lead(-1)).toBe('NONE');
  });

  it('late press after contact counts as LATE', () => {
    let waterTicks = 0;
    const sim = fly(setup('203C'), (s) => {
      if (s.phase === 'water' && ++waterTicks === 7) return IN.ACTION;
      if (s.phase === 'flight' && s.flightProgress > 0.1 && s.flightProgress < 0.5) return IN.ACTION;
      return 0;
    });
    expect(sim.entry!.rip).toBe('LATE');
  });

  it('arm assist reduces an early opening error', () => {
    const run = (assist: boolean) =>
      runBot(new DiverSim(setup('205C', { assist })), { ...PERFECT_BOT, openBias: -12 }).sim.entry!.angleErr;
    const off = run(false);
    const on = run(true);
    expect(off).toBeLessThan(-8);
    expect(Math.abs(on)).toBeLessThan(Math.abs(off) - 3);
  });
});

describe('water entry', () => {
  const plunge = (openBias: number) => {
    const sim = new DiverSim(setup('105C'));
    const bot = new Bot({ ...PERFECT_BOT, openBias });
    let minY = Infinity;
    while (sim.phase !== 'done') {
      sim.step(bot.input(sim));
      if (sim.phase === 'water') minY = Math.min(minY, sim.y);
    }
    return { minY, sim };
  };

  it('a clean entry plunges deep, a flat one stops near the surface', () => {
    const clean = plunge(0);
    const flat = plunge(40);
    expect(clean.sim.entry!.flat).toBe(false);
    expect(flat.sim.entry!.flat).toBe(true);
    expect(clean.minY).toBeLessThan(-1.8);
    expect(flat.minY).toBeGreaterThan(-1);
    // and the body drifts back up only slowly afterwards
    expect(clean.sim.y).toBeLessThan(-1);
  });
});
