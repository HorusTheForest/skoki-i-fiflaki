import { describe, expect, it } from 'vitest';
import { decodeReplay, encodeReplay, replayFromHash, rle, unrle } from '../src/core/replay';
import { DiverSim } from '../src/physics/diver';
import { parseDiveCode } from '../src/levels/diveCode';
import { runBot } from '../src/ai/bot';

describe('replay codec', () => {
  it('run-length encodes inputs', () => {
    const inputs = [0, 0, 0, 1, 1, 5, 0, 0, 2];
    expect(unrle(rle(inputs))).toEqual(inputs);
    expect(rle([])).toBe('');
  });

  it('round-trips through the URL fragment and replays identically', () => {
    const setup = { dive: parseDiveCode('5253B'), height: 10, zoneWidth: 0.1 };
    const { sim, inputs } = runBot(new DiverSim(setup));
    const enc = encodeReplay({ v: 1, code: '5253B', height: 10, zone: 0.1, seed: 3, assist: false, inputs });
    expect(enc.length).toBeLessThan(400);
    const dec = replayFromHash(`#replay=${enc}`)!;
    expect(dec.inputs).toEqual(inputs);
    const again = new DiverSim({ ...setup, zoneWidth: dec.zone });
    for (const i of dec.inputs) again.step(i);
    expect(again.entry).toEqual(sim.entry);
  });

  it('rejects garbage', () => {
    expect(replayFromHash('#replay=notareplay')).toBeNull();
    expect(() => decodeReplay('')).toThrow();
  });
});
