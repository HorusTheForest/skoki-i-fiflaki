// Degree of difficulty (WT, współczynnik trudności).
//
// The official World Aquatics value is A + B + C + D + E from the tables in
// the appendix of the diving rules (somersaults, position, twists, approach,
// unnatural entry). Those tables could not be verified for this build, so
// this is a SIMPLIFIED formula with the same structure and a similar range
// (about 1.2 to 4.5 on the 10 m platform). The UI marks it as approximate.

import type { DiveSpec } from '../levels/diveCode';

export const DD_IS_APPROXIMATE = true;

/** A: somersaults (by half somersaults), 10 m platform */
const A = [0, 1.0, 1.3, 1.5, 1.8, 2.1, 2.4, 2.7, 3.0, 3.3];

export function degreeOfDifficulty(d: DiveSpec, height = 10): number {
  const hs = Math.min(9, d.halfSoms);
  const a = A[hs]!;
  // B: flight position; straight and pike get harder with more somersaults
  const k = Math.max(1, hs - 2);
  const b = d.position === 'A' ? 0.1 * k + 0.1 : d.position === 'B' ? 0.06 * k : d.position === 'D' ? 0.02 * k : 0;
  // C: twists
  const c = d.halfTwists * (0.2 + 0.03 * hs);
  // D: rotation group (back, reverse, inward are blind or towards the tower)
  const dg = [0, 0, 0.2, 0.3, 0.1][d.dir]!;
  // E: unnatural entry (feet first after forward rotation is blind)
  const e = !d.headFirst && (d.dir === 1 || d.dir === 4) && hs >= 2 ? 0.1 : 0;
  // lower platforms make rotations harder to fit
  const h = height >= 10 ? 0 : height >= 7.5 ? 0.1 : height >= 5 ? 0.2 : 0.3;
  return Math.round((a + b + c + dg + e + h * (hs / 3)) * 10) / 10;
}
