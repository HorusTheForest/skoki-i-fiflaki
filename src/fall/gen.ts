// Nieskończona wieża (prototype): the course of one fall. Height y in metres
// above the water (the fall starts on the platform at `depth`), x across the
// lane between the tower face (x = 0) and the glass of the stands (x = width).
// All of a level comes from its seed, so the same level is always the same.

import { Rng, hashSeed } from '../core/rng';

export interface Ledge {
  kind: 'ledge';
  /** -1 a platform of the tower (left), +1 a lighting truss (right) */
  side: -1 | 1;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface Drone {
  kind: 'drone';
  y: number;
  /** centre and half-width of its path, speed along it (m/s) */
  mid: number;
  amp: number;
  speed: number;
  phase: number;
}

/** which diver a gate is for: 0 red, 1 blue, -1 either */
export type GateFor = -1 | 0 | 1;

export interface Gate {
  y: number;
  x: number;
  /** opening width (m) */
  gap: number;
  who: GateFor;
}

export interface Level {
  n: number;
  depth: number;
  width: number;
  ledges: Ledge[];
  drones: Drone[];
  gates: Gate[];
}

/** the first and last metres are free: the platform and the pool */
const FREE_TOP = 14;
const FREE_BOTTOM = 16;
/** narrowest free passage next to a ledge */
export const MIN_PASS = 2.6;
export const DRONE_R = 0.35;
/** the start platform reaches this far into the lane */
export const PLATFORM_LEN = 4.6;

export function makeLevel(n: number): Level {
  const rng = new Rng(hashSeed('wieza', n));
  const depth = 260 + 40 * Math.min(n - 1, 6);
  const width = Math.max(7, 10.5 - 0.5 * (n - 1));
  const lvl: Level = { n, depth, width, ledges: [], drones: [], gates: [] };
  const step = () => Math.max(8, rng.range(14, 20) - 0.8 * (n - 1));
  let y = depth - FREE_TOP - 4;
  while (y > FREE_BOTTOM + 4) {
    const r = rng.next();
    if (r < 0.62) {
      const side: -1 | 1 = rng.next() < 0.5 ? -1 : 1;
      // long ledges leave one gap: both divers have to be moved into it
      const reach = Math.min(0.25, 0.04 * (n - 1));
      const len = Math.min(width - MIN_PASS, rng.range(0.3 + reach, 0.5 + reach) * width);
      const th = side < 0 ? rng.range(0.5, 0.8) : 0.45;
      const x0 = side < 0 ? -1 : width - len;
      const x1 = side < 0 ? len : width + 1;
      lvl.ledges.push({ kind: 'ledge', side, x0, x1, y0: y - th, y1: y });
    } else if (r < 0.8 + 0.03 * n) {
      lvl.drones.push({ kind: 'drone', y, mid: width / 2, amp: width / 2 - 1, speed: rng.range(1.5, 2.5) + 0.3 * n, phase: rng.range(0, 6.28) });
    }
    if (rng.next() < 0.75) {
      const g = rng.next();
      const who: GateFor = g < 0.35 ? -1 : g < 0.675 ? 0 : 1;
      const gap = Math.max(1.6, 2.6 - 0.12 * (n - 1));
      lvl.gates.push({ y: y - 4, x: rng.range(gap / 2 + 0.6, width - gap / 2 - 0.6), gap, who });
    }
    y -= step();
  }
  return lvl;
}

/** left and right edge of the lane */
export function walls(l: Level): [number, number] {
  return [0, l.width];
}

export function droneX(d: Drone, t: number): number {
  return d.mid + d.amp * Math.sin(d.phase + (t * d.speed) / Math.max(1, d.amp));
}
