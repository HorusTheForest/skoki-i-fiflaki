import { describe, expect, it } from 'vitest';
import { FallSim, BODY_R, LIVES, type FallEvent } from '../src/fall/sim';
import { droneX, makeLevel, MIN_PASS } from '../src/fall/gen';
import { IN } from '../src/physics/diver';

/**
 * A careful player: works out where each diver should be (its gates, the gap
 * beside the next ledge, away from drones), switches to the diver that is
 * furthest from its spot relative to the time left, steers it and lines both
 * up for a rip.
 */
function fallBot(s: FallSim): number {
  if (s.phase === 'stand') return s.tick % 20 === 0 ? IN.ACTION : 0;
  const l = s.level;
  const fall = Math.max(1, -s.vy);
  const targets: number[] = [];
  const urgency: number[] = [];
  s.divers.forEach((d, i) => {
    let target = d.x;
    let when = 99;
    const gate = l.gates.find((g) => g.y < s.y && (g.who === i || g.who === -1));
    if (gate && s.y - gate.y < 18) {
      target = gate.x;
      when = (s.y - gate.y) / fall;
    }
    const ledge = l.ledges.find((g) => g.y1 > s.y - 16 && g.y0 < s.y + BODY_R);
    if (ledge) {
      const lo = ledge.side < 0 ? ledge.x1 + BODY_R + 0.35 : BODY_R + 0.35;
      const hi = ledge.side < 0 ? l.width - BODY_R - 0.35 : ledge.x0 - BODY_R - 0.35;
      if (target < lo || target > hi) when = Math.min(when, Math.max(0.05, (s.y - ledge.y1) / fall));
      target = Math.min(hi, Math.max(lo, target));
    }
    for (const b of l.drones) {
      if (b.y > s.y || s.y - b.y > 10) continue;
      const bx = droneX(b, s.levelT + (s.y - b.y) / fall);
      if (Math.abs(target - bx) < 1.4) {
        target = bx + (target >= bx ? 1.6 : -1.6);
        when = Math.min(when, (s.y - b.y) / fall);
      }
    }
    target = Math.min(l.width - BODY_R - 0.4, Math.max(BODY_R + 0.4, target));
    targets.push(target);
    urgency.push(Math.abs(target - d.x) / Math.max(0.2, when));
  });
  let m = 0;
  const other = s.active === 0 ? 1 : 0;
  const a = s.divers[s.active];
  const settled = Math.abs(targets[s.active]! - a.x) < 0.3 && Math.abs(a.vx) < 0.8;
  if (urgency[other]! > 0.5 && (settled || urgency[other]! > urgency[s.active]! * 2) && s.tick % 2 === 0) return IN.UP;
  const end = s.y < 10;
  const want = end ? 0 : Math.max(-7, Math.min(7, (targets[s.active]! - a.x) * 3));
  if (want - a.vx > 0.4) m |= IN.RIGHT;
  if (want - a.vx < -0.4) m |= IN.LEFT;
  if (end && Math.abs(s.divers[0].vx) < 1 && Math.abs(s.divers[1].vx) < 1) m |= IN.DOWN;
  // brake (spread: slower and stronger steering) when there is a lot to do
  else if (!end && urgency[0]! + urgency[1]! > 1.5) m |= IN.ACTION;
  return m;
}

function play(s: FallSim, until: (e: FallEvent) => boolean, maxS = 120): FallEvent | undefined {
  for (let i = 0; i < maxS * 120; i++) {
    const start = s.events.length;
    s.step(fallBot(s));
    for (let k = start; k < s.events.length; k++) if (until(s.events[k]!)) return s.events[k];
  }
  return undefined;
}

describe('Nieskończona wieża: course generator', () => {
  it('is deterministic, leaves a gap beside every ledge and has gates for both divers', () => {
    for (let n = 1; n <= 8; n++) {
      const a = makeLevel(n);
      expect(makeLevel(n)).toEqual(a);
      expect(a.ledges.length + a.drones.length).toBeGreaterThan(8);
      for (const g of a.ledges) {
        const free = g.side < 0 ? a.width - g.x1 : g.x0;
        expect(free).toBeGreaterThanOrEqual(MIN_PASS - 1e-9);
      }
      expect(a.gates.some((g) => g.who === 0)).toBe(true);
      expect(a.gates.some((g) => g.who === 1)).toBe(true);
    }
  });
});

describe('Nieskończona wieża: the fall', () => {
  it('the pair waits on the platform until ACTION', () => {
    const s = new FallSim();
    for (let i = 0; i < 240; i++) s.step(0);
    expect(s.phase).toBe('stand');
    s.step(IN.ACTION);
    expect(s.events[0]).toMatchObject({ type: 'jump' });
  });

  it('a careful player switching between the divers clears the first towers', () => {
    const s = new FallSim();
    for (let n = 1; n <= 2; n++) {
      const e = play(s, (x) => x.type === 'entry' || x.type === 'over');
      expect(e).toMatchObject({ type: 'entry', grade: 'RIP' });
      play(s, (x) => x.type === 'level');
    }
    expect(s.lives).toBeGreaterThan(0);
    const ev = s.events;
    expect(ev.filter((e) => e.type === 'switch').length).toBeGreaterThan(4);
    expect(ev.some((e) => e.type === 'gate' && e.who === 0)).toBe(true);
    expect(ev.some((e) => e.type === 'gate' && e.who === 1)).toBe(true);
    expect(s.score).toBeGreaterThan(0);
  });

  it('only the steered diver moves', () => {
    const s = new FallSim();
    s.step(IN.ACTION);
    for (let i = 0; i < 120; i++) s.step(0);
    const x1 = s.divers[1].x;
    for (let i = 0; i < 60; i++) s.step(IN.RIGHT);
    expect(s.divers[1].x).toBeCloseTo(x1, 1);
    expect(s.divers[0].vx).toBeGreaterThan(1);
    s.step(IN.UP);
    expect(s.active).toBe(1);
  });

  it('a gate for the blue diver does not count for the red one', () => {
    const s = new FallSim();
    const g = s.level.gates.find((x) => x.who === 1)!;
    s.step(IN.ACTION);
    s.y = g.y + 0.5;
    s.divers[0].x = g.x;
    s.divers[1].x = g.x > s.level.width / 2 ? 1 : s.level.width - 1;
    for (let i = 0; i < 120; i++) s.step(0);
    expect(s.events.some((e) => e.type === 'gateMiss' && e.who === 1)).toBe(true);
  });

  it('a spread entry is a belly flop for the pair', () => {
    const s = new FallSim();
    s.step(IN.ACTION);
    for (let i = 0; i < 120; i++) s.step(0);
    s.y = 3;
    let e: FallEvent | undefined;
    for (let i = 0; i < 240 && !e; i++) {
      s.step(IN.ACTION);
      e = s.events.find((x) => x.type === 'entry');
    }
    expect(e).toMatchObject({ type: 'entry', grade: 'FLAT' });
    expect(s.lives).toBe(LIVES - 1);
  });

  it('is deterministic', () => {
    const a = new FallSim();
    const b = new FallSim();
    for (let i = 0; i < 120 * 30; i++) {
      a.step(fallBot(a));
      b.step(fallBot(b));
    }
    expect(a.events).toEqual(b.events);
    expect(a.snapshot(0)).toEqual(b.snapshot(0));
    expect(a.snapshot(1)).toEqual(b.snapshot(1));
  });
});
