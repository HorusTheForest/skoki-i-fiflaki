// Klif (prototype): a generated canyon to fall through. Height y in metres
// above the water (the fall starts at `depth`), x across the canyon. All of a
// level comes from its seed, so the same level number is always the same.

import { Rng, hashSeed } from '../core/rng';

export interface Ledge {
  kind: 'ledge';
  /** -1 grows from the left wall, +1 from the right one */
  side: -1 | 1;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface Bird {
  kind: 'bird';
  y: number;
  /** centre and half-width of its path, speed along it (m/s) */
  mid: number;
  amp: number;
  speed: number;
  phase: number;
}

export interface Gate {
  y: number;
  x: number;
  /** opening width (m) */
  gap: number;
}

export interface Level {
  n: number;
  depth: number;
  ledges: Ledge[];
  birds: Bird[];
  gates: Gate[];
  /** wall shape parameters */
  readonly w0: number;
  readonly p: [number, number, number];
}

/** the canyon opens wide over the pool and at the top */
const OPEN_TOP = 12;
const OPEN_BOTTOM = 18;
/** narrowest free passage next to a ledge */
export const MIN_PASS = 2.6;
export const BIRD_R = 0.35;

export function makeLevel(n: number): Level {
  const rng = new Rng(hashSeed('klif', n));
  const depth = 260 + 40 * Math.min(n - 1, 6);
  const w0 = Math.max(6, 10.5 - 0.6 * (n - 1));
  const lvl: Level = {
    n,
    depth,
    ledges: [],
    birds: [],
    gates: [],
    w0,
    p: [rng.range(0, 6.28), rng.range(0, 6.28), rng.range(0, 6.28)],
  };
  const step = () => Math.max(6.5, rng.range(9, 14) - 0.5 * (n - 1));
  let y = depth - OPEN_TOP - 4;
  while (y > OPEN_BOTTOM + 4) {
    const [L, R] = walls(lvl, y);
    const w = R - L;
    const r = rng.next();
    if (r < 0.62) {
      const side: -1 | 1 = rng.next() < 0.5 ? -1 : 1;
      const len = Math.min(w - MIN_PASS, rng.range(0.35, 0.62) * w);
      const th = rng.range(0.5, 0.9);
      const x0 = side < 0 ? L - 1 : R - len;
      const x1 = side < 0 ? L + len : R + 1;
      lvl.ledges.push({ kind: 'ledge', side, x0, x1, y0: y - th, y1: y });
    } else if (r < 0.8 + 0.03 * n) {
      lvl.birds.push({ kind: 'bird', y, mid: (L + R) / 2, amp: w / 2 - 1, speed: rng.range(1.5, 2.5) + 0.3 * n, phase: rng.range(0, 6.28) });
    }
    // a gate between this obstacle and the next one, away from the ledge
    if (rng.next() < 0.7) {
      const gy = y - 4;
      const [gl, gr] = walls(lvl, gy);
      const gap = Math.max(1.6, 2.6 - 0.12 * (n - 1));
      lvl.gates.push({ y: gy, x: rng.range(gl + gap / 2 + 0.6, gr - gap / 2 - 0.6), gap });
    }
    y -= step();
  }
  return lvl;
}

/** left and right wall x at height y */
export function walls(l: Level, y: number): [number, number] {
  const [p1, p2, p3] = l.p;
  const c = 2.2 * Math.sin(y / 17 + p1) + 1.1 * Math.sin(y / 7.3 + p2);
  let w = l.w0 + 1.5 * Math.sin(y / 11 + p3);
  // flare open at the top and over the pool
  const top = Math.max(0, y - (l.depth - OPEN_TOP)) / OPEN_TOP;
  const bottom = Math.max(0, OPEN_BOTTOM - y) / OPEN_BOTTOM;
  w += 8 * top * top + 10 * bottom * bottom;
  const cc = c * (1 - bottom);
  return [cc - w / 2, cc + w / 2];
}

export function birdX(b: Bird, t: number): number {
  return b.mid + b.amp * Math.sin(b.phase + (t * b.speed) / Math.max(1, b.amp));
}
