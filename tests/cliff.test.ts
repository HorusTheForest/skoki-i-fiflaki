import { describe, expect, it } from 'vitest';
import { CliffSim, BODY_R, LIVES, type CliffEvent } from '../src/cliff/sim';
import { birdX, makeLevel, walls, MIN_PASS } from '../src/cliff/gen';
import { IN } from '../src/physics/diver';

/** A careful player: aims for the next gate, keeps clear of ledges and birds, lines up for a rip. */
function cliffBot(s: CliffSim): number {
  const l = s.level;
  const [L, R] = walls(l, s.y);
  let target = s.x;
  const gate = l.gates.find((g) => g.y < s.y);
  if (gate && s.y - gate.y < 16) target = gate.x;
  const fall = Math.max(1, -s.vy);
  const ledge = l.ledges.find((g) => g.y1 > s.y - 12 && g.y0 < s.y + BODY_R);
  if (ledge) {
    const [wl, wr] = walls(l, ledge.y0);
    const lo = ledge.side < 0 ? ledge.x1 + BODY_R + 0.35 : Math.max(L, wl) + BODY_R + 0.35;
    const hi = ledge.side < 0 ? Math.min(R, wr) - BODY_R - 0.35 : ledge.x0 - BODY_R - 0.35;
    target = Math.min(hi, Math.max(lo, target));
  }
  for (const b of l.birds) {
    if (b.y > s.y || s.y - b.y > 10) continue;
    const bx = birdX(b, s.levelT + (s.y - b.y) / fall);
    if (Math.abs(target - bx) < 1.4) target = bx + (target >= bx ? 1.6 : -1.6);
  }
  target = Math.min(R - BODY_R - 0.4, Math.max(L + BODY_R + 0.4, target));
  const end = s.y < 10;
  const want = end ? 0 : Math.max(-7, Math.min(7, (target - s.x) * 3));
  let m = 0;
  if (want - s.vx > 0.4) m |= IN.RIGHT;
  if (want - s.vx < -0.4) m |= IN.LEFT;
  if (end && Math.abs(s.vx) < 1) m |= IN.DOWN;
  else if (Math.abs(target - s.x) > 2.5) m |= IN.ACTION;
  return m;
}

function play(s: CliffSim, until: (e: CliffEvent) => boolean, maxS = 120): CliffEvent | undefined {
  for (let i = 0; i < maxS * 120; i++) {
    const start = s.events.length;
    s.step(cliffBot(s));
    for (let k = start; k < s.events.length; k++) if (until(s.events[k]!)) return s.events[k];
  }
  return undefined;
}

describe('Klif: canyon generator', () => {
  it('is deterministic and leaves a passage beside every ledge', () => {
    for (let n = 1; n <= 8; n++) {
      const a = makeLevel(n);
      expect(makeLevel(n)).toEqual(a);
      expect(a.ledges.length + a.birds.length).toBeGreaterThan(8);
      for (const g of a.ledges) {
        const [L, R] = walls(a, g.y1);
        const free = g.side < 0 ? R - g.x1 : g.x0 - L;
        expect(free).toBeGreaterThan(MIN_PASS - 0.6);
      }
    }
  });
});

describe('Klif: falling', () => {
  it('a careful player clears the first levels', () => {
    const s = new CliffSim();
    const entries: CliffEvent[] = [];
    for (let n = 1; n <= 3; n++) {
      const e = play(s, (x) => x.type === 'entry' || x.type === 'over');
      expect(e?.type).toBe('entry');
      entries.push(e!);
      play(s, (x) => x.type === 'level');
    }
    expect(s.lives).toBeGreaterThan(0);
    expect(s.events.filter((e) => e.type === 'gate').length).toBeGreaterThan(10);
    expect(entries.every((e) => e.type === 'entry' && e.grade === 'RIP')).toBe(true);
    expect(s.score).toBeGreaterThan(0);
  });

  it('hitting the wall costs a life and half of the pot', () => {
    const s = new CliffSim();
    for (let i = 0; i < 120; i++) s.step(0);
    const pot = s.pot;
    const e = (() => {
      for (let i = 0; i < 120 * 10; i++) {
        s.step(IN.LEFT);
        const h = s.events.find((x) => x.type === 'hit');
        if (h) return h;
      }
      return undefined;
    })();
    expect(e).toMatchObject({ type: 'hit', lives: LIVES - 1 });
    expect(s.pot).toBeLessThan(pot + 200);
  });

  it('spread at the water is a belly flop', () => {
    const s = new CliffSim();
    s.y = 3;
    s.vx = 0;
    let e: CliffEvent | undefined;
    for (let i = 0; i < 240 && !e; i++) {
      s.step(IN.ACTION);
      e = s.events.find((x) => x.type === 'entry');
    }
    expect(e).toMatchObject({ type: 'entry', grade: 'FLAT' });
    expect(s.lives).toBe(LIVES - 1);
  });

  it('three hits end the run', () => {
    const s = new CliffSim();
    let over: CliffEvent | undefined;
    for (let i = 0; i < 120 * 60 && !over; i++) {
      s.step(i % 240 < 120 ? IN.LEFT : IN.RIGHT);
      over = s.events.find((x) => x.type === 'over');
    }
    expect(over).toBeDefined();
    expect(s.phase).toBe('over');
  });

  it('is deterministic', () => {
    const a = new CliffSim();
    const b = new CliffSim();
    for (let i = 0; i < 120 * 30; i++) {
      a.step(cliffBot(a));
      b.step(cliffBot(b));
    }
    expect(a.events).toEqual(b.events);
    expect(a.snapshot()).toEqual(b.snapshot());
  });
});
