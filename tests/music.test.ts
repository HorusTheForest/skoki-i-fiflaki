import { describe, expect, it } from 'vitest';
import { SONGS, parseChord, parseMelody } from '../src/audio/songs';
import { readFileSync } from 'node:fs';

describe('music', () => {
  it('every melody bar has 16 steps and every song has a bar per chord pair', () => {
    const src = readFileSync('src/audio/songs.ts', 'utf8');
    const bars = [...src.matchAll(/^\s+'([A-G#\d.\- ]+)',$/gm)].map((m) => m[1]!);
    expect(bars.length).toBe(24);
    for (const b of bars) expect(b.split(' ').length).toBe(16);
    for (const song of Object.values(SONGS)) {
      expect(song.lead.length).toBe(song.chords.length);
      for (const p of [song.bass, song.drums.kick, song.drums.snare, song.drums.hat]) expect(p.length).toBe(16);
    }
  });

  it('joins held notes and reads chords', () => {
    const ev = parseMelody(['C5 - - . E5 - . . . . . . . . . .']);
    expect(ev).toEqual([
      { step: 0, midi: 72, len: 3 },
      { step: 4, midi: 76, len: 2 },
    ]);
    expect(parseChord('Am7')).toEqual({ root: 57, tones: [0, 3, 7, 10] });
    expect(parseChord('G')).toEqual({ root: 55, tones: [0, 4, 7] });
  });
});
