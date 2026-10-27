import { describe, expect, it } from 'vitest';
import { DiverSim, DT, IN } from '../src/physics/diver';
import { Ragdoll, segmentsWorld } from '../src/physics/ragdoll';
import { parseDiveCode } from '../src/levels/diveCode';
import { Bot, PERFECT_BOT } from '../src/ai/bot';

function midFlight(): DiverSim {
  const sim = new DiverSim({ dive: parseDiveCode('205C'), height: 10, zoneWidth: 0.12 });
  const bot = new Bot(PERFECT_BOT);
  while (!(sim.phase === 'flight' && sim.flightProgress > 0.5)) sim.step(sim.phase === 'flight' ? IN.ACTION : bot.input(sim));
  // hold the pose for a while so joint velocities are ~0
  for (let i = 0; i < 30; i++) sim.step(IN.ACTION);
  return sim;
}

describe('ragdoll hand-over', () => {
  it('every segment keeps its velocity v + omega x r', () => {
    const sim = midFlight();
    const before = segmentsWorld(sim.snapshot()).segs;
    const rag = new Ragdoll(sim.snapshot(), sim.L / sim.inertia, sim.vx, sim.vy, 10);
    // advance the kinematic body one step with the same pose
    sim.step(IN.ACTION);
    const after = segmentsWorld(sim.snapshot()).segs;
    const ragBefore = rag.segments();
    for (const s of before) {
      const r = ragBefore.find((x) => x.name === s.name)!;
      expect(r.px).toBeCloseTo(s.px, 6);
      expect(r.py).toBeCloseTo(s.py, 6);
    }
    rag.step();
    const ragAfter = rag.segments();
    for (const s of after) {
      const r = ragAfter.find((x) => x.name === s.name)!;
      // same motion within a few millimetres after one step (gravity acts on both)
      expect(Math.abs(r.px - s.px)).toBeLessThan(0.01);
      expect(Math.abs(r.py - s.py)).toBeLessThan(0.01);
    }
    expect(DT).toBeGreaterThan(0);
  });

  it('floats back up in the water', () => {
    const sim = midFlight();
    const rag = new Ragdoll(sim.snapshot(), sim.L / sim.inertia, sim.vx, sim.vy, 10);
    let minY = Infinity;
    for (let i = 0; i < 120 * 8; i++) {
      rag.step();
      minY = Math.min(minY, rag.centre()[1]);
    }
    expect(minY).toBeLessThan(-0.3);
    expect(rag.centre()[1]).toBeGreaterThan(-0.6);
  });
});
