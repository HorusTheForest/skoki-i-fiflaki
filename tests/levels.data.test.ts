import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildLevels } from '../scripts/levels.src';
import { LEVELS } from '../src/levels/levels';
import { parseDiveCode } from '../src/levels/diveCode';
import { partnerById, PARTNERS } from '../src/ai/partner';

const FILE = new URL('../src/levels/levels.json', import.meta.url);

describe('campaign data', () => {
  it('levels.json matches the source table', () => {
    const built = buildLevels();
    const json = JSON.stringify({ levels: built }, null, 1) + '\n';
    if (process.env.WRITE_LEVELS) writeFileSync(FILE, json);
    expect(readFileSync(FILE, 'utf8')).toBe(json);
  });

  it('has 50 valid levels with finals every 10th', () => {
    expect(LEVELS.map((l) => l.id)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    for (const l of LEVELS) {
      for (const c of l.dives) expect(() => parseDiveCode(c)).not.toThrow();
      expect(PARTNERS.some((p) => p.id === l.partner)).toBe(true);
      expect(l.dives.length > 1).toBe(l.id % 10 === 0);
      expect(l.stars[0]).toBeGreaterThan(l.scoreMin);
      expect(l.stars[1]).toBeGreaterThan(l.stars[0]);
      if (l.unlock?.partner) expect(partnerById(l.unlock.partner).id).toBe(l.unlock.partner);
    }
  });
});
