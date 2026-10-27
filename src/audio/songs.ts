// Songs for the music engine: chord charts, hand-written melodies and
// patterns, plus the small parsers that turn them into notes.

/** one bar = 16 sixteenth steps; '-' holds the previous note, '.' is a rest */
type Bar = string;

export interface Song {
  bpm: number;
  /** two chords per bar (first and second half) */
  chords: [string, string][];
  lead: Bar[];
  /** steps (0-15) of the bass, 'o' marks an octave pop */
  bass: string;
  drums: { kick: string; snare: string; hat: string };
  /** offbeat brass stabs */
  stabs: boolean;
  /** sixteenth arpeggio from this bar on (-1: never) */
  arpFrom: number;
  pads: boolean;
}

const C = (a: string, b = a): [string, string] => [a, b];

export const SONGS: Record<string, Song> = {
  // bright summer-games theme, A (8 bars) + B (8 bars)
  menu: {
    bpm: 126,
    chords: [
      C('Cmaj7'), C('Am7'), C('Fmaj7'), C('Gsus', 'G7'), C('Cmaj7'), C('Em7'), C('Fmaj7'), C('G'),
      C('Dm7'), C('G7'), C('Em7'), C('Am7'), C('Fmaj7'), C('G'), C('Em7', 'A7'), C('Dm7', 'G7'),
    ],
    lead: [
      'E5 - - G5 - - B5 - C6 - - - B5 - G5 -',
      'A5 - - - G5 - E5 - - - C5 - E5 - G5 -',
      'A5 - - C6 - - A5 - G5 - F5 - E5 - F5 -',
      'G5 - - - - - D5 - F5 - G5 - B5 - - -',
      'E5 - - G5 - - B5 - C6 - - - D6 - E6 -',
      'D6 - - B5 - - G5 - E5 - - - G5 - B5 -',
      'C6 - - A5 - - F5 - A5 - C6 - E6 - D6 -',
      'D6 - - - - - - - B5 - . . G5 - - -',
      'F5 - . F5 - . A5 - C6 - - - A5 - F5 -',
      'G5 - - - B5 - D6 - F6 - - - D6 - B5 -',
      'E5 - . E5 - . G5 - B5 - - - G5 - E5 -',
      'A5 - - - C6 - E6 - - - D6 - C6 - A5 -',
      'A5 - - C6 - - F6 - E6 - - - C6 - A5 -',
      'B5 - - D6 - - G6 - F6 - E6 - D6 - B5 -',
      'G5 - - - E5 - - - A5 - - - C#6 - E6 -',
      'F6 - - - E6 - D6 - - - B5 - G5 - - -',
    ],
    bass: 'x..o..x.x.x..ox.',
    drums: { kick: 'x.....x.x.....x.', snare: '....x.......x...', hat: 'h.h.h.h.h.h.h.o.' },
    stabs: true,
    arpFrom: 8,
    pads: false,
  },
  // laid-back groove for the hall: sparse hook, pads, softer drums
  arena: {
    bpm: 108,
    chords: [C('Fmaj7'), C('G'), C('Em7'), C('Am7'), C('Fmaj7'), C('G'), C('Em7'), C('Am7', 'G')],
    lead: [
      'A5 - - - - - G5 - A5 - C6 - - - - -',
      'B5 - - - - - A5 - G5 - D5 - - - - -',
      'G5 - - - - - E5 - G5 - B5 - - - A5 -',
      'A5 - - - - - - - . . . . . . . .',
      'C6 - - - - - A5 - C6 - E6 - - - - -',
      'D6 - - - - - B5 - D6 - G6 - - - - -',
      'E6 - - - D6 - B5 - G5 - - - E5 - G5 -',
      'A5 - - - - - - - . . . . . . . .',
    ],
    bass: 'x.....x.x..o....',
    drums: { kick: 'x.......x.x.....', snare: '....x.......x...', hat: '..h...h...h...h.' },
    stabs: false,
    arpFrom: 4,
    pads: true,
  },
};

const NOTE: Record<string, number> = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };

function midiOf(n: string): number {
  const m = /^([A-G]#?)(\d)$/.exec(n);
  if (!m) return -1;
  return 12 * (Number(m[2]) + 1) + NOTE[m[1]!]!;
}

export const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

const QUALITY: Record<string, number[]> = {
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  '7': [0, 4, 7, 10],
  sus: [0, 5, 7, 10],
  m: [0, 3, 7],
  '': [0, 4, 7],
};

/** chord name to root midi (octave 3) and intervals */
export function parseChord(name: string): { root: number; tones: number[] } {
  const m = /^([A-G]#?)(.*)$/.exec(name)!;
  return { root: 48 + NOTE[m[1]!]!, tones: QUALITY[m[2]!] ?? QUALITY['']! };
}

export interface NoteEv {
  step: number;
  midi: number;
  len: number;
}

/** melody bars to note events with lengths (holds joined) */
export function parseMelody(bars: Bar[]): NoteEv[] {
  const out: NoteEv[] = [];
  bars.forEach((bar, b) => {
    bar.split(' ').forEach((tok, i) => {
      const step = b * 16 + i;
      if (tok === '-') {
        const last = out[out.length - 1];
        if (last && last.step + last.len === step) last.len++;
      } else if (tok !== '.') {
        out.push({ step, midi: midiOf(tok), len: 1 });
      }
    });
  });
  return out;
}

