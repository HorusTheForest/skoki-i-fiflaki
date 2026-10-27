// The one and only palette (32 colours, NES-like). Every colour in the game
// comes from here: graphics, text, particles and palette swaps.

export const PALETTE = [
  0x000000, // 0 black
  0x1c1c3c, // 1 night navy
  0x545474, // 2 slate
  0x7c7c7c, // 3 grey
  0xbcbcbc, // 4 light grey
  0xfcfcfc, // 5 white
  0x0000a8, // 6 deep blue
  0x0058f8, // 7 blue
  0x3cbcfc, // 8 sky blue
  0xa4e4fc, // 9 pale blue
  0x00406c, // 10 deep water
  0x00788c, // 11 teal
  0x00b8b8, // 12 cyan
  0x7cf8e8, // 13 aqua foam
  0x005800, // 14 dark green
  0x00a800, // 15 green
  0xb8f818, // 16 lime
  0x881400, // 17 dark red
  0xd82800, // 18 red
  0xf87858, // 19 salmon
  0xfca044, // 20 orange
  0xf8b800, // 21 gold
  0xf8d878, // 22 pale yellow
  0x7c4c00, // 23 brown
  0x3c2000, // 24 dark brown
  0xfcd8a8, // 25 skin light
  0xd89060, // 26 skin
  0x9c5c30, // 27 skin dark
  0x6844fc, // 28 violet
  0xd800cc, // 29 magenta
  0xf8a4c0, // 30 pink
  0x2c2c2c, // 31 charcoal
] as const;

export type ColorIndex = number;

/** Named colours (indices into PALETTE). */
export const C = {
  black: 0,
  navy: 1,
  slate: 2,
  grey: 3,
  lightGrey: 4,
  white: 5,
  deepBlue: 6,
  blue: 7,
  sky: 8,
  paleBlue: 9,
  deepWater: 10,
  teal: 11,
  cyan: 12,
  foam: 13,
  darkGreen: 14,
  green: 15,
  lime: 16,
  darkRed: 17,
  red: 18,
  salmon: 19,
  orange: 20,
  gold: 21,
  paleYellow: 22,
  brown: 23,
  darkBrown: 24,
  skinLight: 25,
  skin: 26,
  skinDark: 27,
  violet: 28,
  magenta: 29,
  pink: 30,
  charcoal: 31,
} as const;

export function col(i: ColorIndex): number {
  const c = PALETTE[i];
  if (c === undefined) throw new Error(`Colour ${i} is not in the palette`);
  return c;
}

export function cssCol(i: ColorIndex): string {
  return `#${col(i).toString(16).padStart(6, '0')}`;
}

export function rgb(i: ColorIndex): [number, number, number] {
  const c = col(i);
  return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
}

/** Underwater remap: every colour shifts to a blue/teal counterpart. */
export const UNDERWATER: readonly ColorIndex[] = PALETTE.map((_, i) => {
  const map: Record<number, ColorIndex> = {
    [C.white]: C.foam,
    [C.lightGrey]: C.cyan,
    [C.grey]: C.teal,
    [C.skinLight]: C.cyan,
    [C.skin]: C.teal,
    [C.skinDark]: C.deepWater,
    [C.gold]: C.foam,
    [C.paleYellow]: C.foam,
    [C.red]: C.teal,
    [C.orange]: C.cyan,
  };
  return map[i] ?? (i === C.black ? C.navy : C.deepWater);
});

/** Costume palettes: [main, accent]. Unlocked as rewards. */
export const OUTFITS: { name: string; main: ColorIndex; accent: ColorIndex }[] = [
  { name: 'Czerwień', main: C.red, accent: C.white },
  { name: 'Granat', main: C.deepBlue, accent: C.sky },
  { name: 'Złoto', main: C.gold, accent: C.brown },
  { name: 'Zieleń', main: C.green, accent: C.lime },
  { name: 'Fiolet', main: C.violet, accent: C.pink },
  { name: 'Noc', main: C.charcoal, accent: C.cyan },
  { name: 'Magenta', main: C.magenta, accent: C.paleYellow },
  { name: 'Pomarańcz', main: C.orange, accent: C.darkRed },
];
