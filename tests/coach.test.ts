import { describe, expect, it } from 'vitest';
import { DiverSim, IN, SIM_HZ, type DiveSetup } from '../src/physics/diver';
import { parseDiveCode } from '../src/levels/diveCode';
import { Coach, REACTION, type Hint } from '../src/ui/coach';

/** what a player does when reading a hint */
function obey(h: Hint | null, prev: number): number {
  if (!h) return 0;
  if (h.text.startsWith('PUŚĆ')) return 0;
  if (h.text.startsWith('TRZYMAJ AKCJĘ')) return IN.ACTION;
  if (h.text.startsWith('TRZYMAJ →')) return IN.RIGHT;
  if (h.text.startsWith('TRZYMAJ ←')) return IN.LEFT;
  // "TRZYMAJ..." keeps what is held
  if (h.text.startsWith('TRZYMAJ')) return prev & (IN.ACTION | IN.LEFT | IN.RIGHT);
  if (h.text === 'RIP: AKCJA!') return IN.ACTION;
  // twists: tap ↑ (every other tick, so each tap is a fresh press)
  if (h.text.startsWith('↑')) return prev & IN.UP ? 0 : IN.UP;
  return 0;
}

/** a player who does what the coach says, a reaction time late */
function followCoach(code: string, hep?: number): DiverSim {
  const setup: DiveSetup = { dive: parseDiveCode(code), height: 10, zoneWidth: 0.12, hepTime: hep };
  const sim = new DiverSim(setup);
  const coach = new Coach();
  const delay = Math.round(REACTION * SIM_HZ);
  const wants: number[] = [];
  let held = 0;
  for (let i = 0; i < 4000 && sim.phase !== 'done' && sim.phase !== 'water'; i++) {
    wants.push(obey(coach.hint(sim), held));
    held = i >= delay ? wants[i - delay]! : 0;
    sim.step(held);
  }
  return sim;
}

describe('coach', () => {
  for (const code of ['101A', '105C', '107C', '109C', '205C', '207C', '305C', '405B', '407C', '5154B', '5253B']) {
    it(`a player who follows the hints lands ${code} cleanly`, () => {
      const sim = followCoach(code);
      expect(sim.entry).not.toBeNull();
      expect(sim.crashed).toBe(false);
      expect(sim.takeoff!.label === 'PERFECT' || sim.takeoff!.label === 'GOOD').toBe(true);
      expect(Math.abs(sim.entry!.angleErr)).toBeLessThan(8);
    });
  }

  it('synchro: letting go on the PUŚĆ! call hits HEP', () => {
    const sim = followCoach('105C', 1.8);
    expect(sim.takeoff!.label === 'PERFECT' || sim.takeoff!.label === 'GOOD').toBe(true);
  });
});

