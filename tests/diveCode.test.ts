import { describe, expect, it } from 'vitest';
import { diveName, parseDiveCode, withDir } from '../src/levels/diveCode';

describe('parseDiveCode', () => {
  it('parses group 1-4 codes', () => {
    const d = parseDiveCode('107B');
    expect(d).toMatchObject({ group: 1, dir: 1, halfSoms: 7, halfTwists: 0, position: 'B', facing: 1, rot: 1, headFirst: true });
    expect(parseDiveCode('207C')).toMatchObject({ dir: 2, facing: -1, rot: 1 });
    expect(parseDiveCode('307C')).toMatchObject({ dir: 3, facing: 1, rot: -1 });
    expect(parseDiveCode('407c')).toMatchObject({ code: '407C', dir: 4, facing: -1, rot: -1 });
    expect(parseDiveCode('112B')).toMatchObject({ flying: true, halfSoms: 2, headFirst: false });
  });

  it('parses twisting codes', () => {
    const d = parseDiveCode('5253B');
    expect(d).toMatchObject({ group: 5, dir: 2, halfSoms: 5, halfTwists: 3, position: 'B', facing: -1, rot: 1 });
    expect(parseDiveCode('5355B')).toMatchObject({ dir: 3, halfSoms: 5, halfTwists: 5 });
  });

  it('rejects invalid codes', () => {
    for (const c of ['', '7B', '107', '107E', '1007B', '5053B', '5253', '100C', '626C', '127B']) {
      expect(() => parseDiveCode(c)).toThrow();
    }
  });

  it('names dives in Polish', () => {
    expect(diveName(parseDiveCode('107B'))).toBe('3½ salta w przód, łamana');
    expect(diveName(parseDiveCode('5253B'))).toBe('2½ salta w tył, 1½ śr., łamana');
    expect(diveName(parseDiveCode('101C'))).toBe('skok w przód, kuczna');
  });

  it('switches the rotation group', () => {
    expect(withDir(parseDiveCode('105C'), 4).code).toBe('405C');
    expect(withDir(parseDiveCode('5132D'), 2).code).toBe('5232D');
  });
});
