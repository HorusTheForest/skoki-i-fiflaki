// Level feasibility: the bot plays every campaign level with the level's
// partner, through the same physics and inputs as a player, and must pass.
// It also measures how much timing slack each level leaves (difficulty
// margin): how far the opening and the take-off may drift and still pass.

import { describe, expect, it } from 'vitest';
import { LEVELS, judgeLevel, type LevelDef } from '../src/levels/levels';
import { botOpenTime, simulateRound, type RoundResult } from '../src/levels/simulate';
import { degreeOfDifficulty } from '../src/scoring/dd';
import { parseDiveCode } from '../src/levels/diveCode';

const maxOf = (code: string) => 30 * degreeOfDifficulty(parseDiveCode(code));

/** the share of the level requirement one round has to carry */
function roundPasses(l: LevelDef, res: RoundResult): boolean {
  const total = l.dives.reduce((s, c) => s + maxOf(c), 0);
  const need = (l.scoreMin * maxOf(res.code)) / total;
  return !res.failed && res.total >= need && res.syncMean >= l.syncMin;
}

/** how far (ms, up to 300) the timing may drift early and late and still pass */
function window(l: LevelDef, run: (d: number) => RoundResult): [number, number] {
  const ok = (d: number) => roundPasses(l, run(d));
  const side = (sgn: number) => {
    if (ok(0.3 * sgn)) return 300;
    let lo = 0;
    let hi = 0.3;
    while (hi - lo > 0.002) {
      const mid = (lo + hi) / 2;
      if (ok(mid * sgn)) lo = mid;
      else hi = mid;
    }
    return Math.round(lo * 1000);
  };
  return [side(-1), side(1)];
}

const fmt = (w: [number, number]) => `-${w[0]}/+${w[1]}`.padEnd(9);

describe('campaign bot', () => {
  const rows: string[] = [];

  for (const l of LEVELS) {
    it(`level ${l.id}: ${l.name}`, () => {
      const rounds = l.dives.map((_, r) => simulateRound(l, r));
      const total = rounds.reduce((s, x) => s + x.total, 0);
      const sync = rounds.reduce((s, x) => s + x.syncMean, 0) / rounds.length;
      const v = judgeLevel(l, total, sync, rounds.some((x) => x.failed));
      expect(v.reason).toBe('');
      expect(v.passed).toBe(true);

      // tightest round of the level
      let open: [number, number] = [300, 300];
      let jump: [number, number] = [300, 300];
      const tighter = (a: [number, number], b: [number, number]) => (b[0] + b[1] < a[0] + a[1] ? b : a);
      rounds.forEach((_, r) => {
        const t0 = botOpenTime(l, r);
        if (parseDiveCode(l.dives[r]!).position !== 'A') open = tighter(open, window(l, (d) => simulateRound(l, r, { openAt: t0 + d })));
        jump = tighter(jump, window(l, (d) => simulateRound(l, r, {}, d)));
      });
      rows.push(
        `${String(l.id).padStart(2)} ${l.dives.join(',').padEnd(30)} ${l.partner.padEnd(6)} ` +
          `${total.toFixed(1).padStart(6)} / ${String(l.scoreMin).padStart(6)}  sync ${sync.toFixed(2)} / ${l.syncMin.toFixed(1)}  ` +
          `${'★'.repeat(v.stars).padEnd(3)}${v.place ? ` P${v.place}` : '   '}  open ${fmt(open)} ms  take-off vs partner ${fmt(jump)} ms`,
      );
      // every level must leave a human-sized window (total width, ms)
      expect(open[0] + open[1]).toBeGreaterThanOrEqual(40);
      expect(jump[0] + jump[1]).toBeGreaterThanOrEqual(40);
    });
  }

  it('report', () => {
    console.log(['Level margins (bot + partner):', ...rows].join('\n'));
  });
});
