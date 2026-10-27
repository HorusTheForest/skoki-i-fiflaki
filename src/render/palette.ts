// Base palette (32 named colours, soft 16-bit console tones). Shading,
// gradients and highlights are derived from these with mix()/shade()/light().

export const PALETTE = [
  0x0b0b14, // 0 black
  0x1d2142, // 1 night navy
  0x4a5378, // 2 slate
  0x7d8599, // 3 grey
  0xbfc5d3, // 4 light grey
  0xf4f6ff, // 5 white
  0x1f3a8a, // 6 deep blue
  0x2f6fd8, // 7 blue
  0x5fb2f0, // 8 sky blue
  0xb8e2fa, // 9 pale blue
  0x0d3d63, // 10 deep water
  0x14788f, // 11 teal
  0x2fb6c9, // 12 cyan
  0x9af0ec, // 13 aqua foam
  0x1e5a2c, // 14 dark green
  0x3a9d3f, // 15 green
  0xa8e04a, // 16 lime
  0x7a1a1a, // 17 dark red
  0xd0342c, // 18 red
  0xf08a6c, // 19 salmon
  0xf29b3a, // 20 orange
  0xf6c443, // 21 gold
  0xf7e3a1, // 22 pale yellow
  0x7a4a24, // 23 brown
  0x3e2414, // 24 dark brown
  0xffd9b8, // 25 skin light
  0xe0a477, // 26 skin
  0xa86a45, // 27 skin dark
  0x7a5cf0, // 28 violet
  0xc4389e, // 29 magenta
  0xf5a8c8, // 30 pink
  0x2c2f3a, // 31 charcoal
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

/** blend two RGB colours (0xRRGGBB), t = 0 gives a, 1 gives b */
export function mix(a: number, b: number, t: number): number {
  const ch = (sh: number) => Math.round(((a >> sh) & 255) * (1 - t) + ((b >> sh) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}
/** darker / lighter version of a palette colour */
export const shade = (i: ColorIndex, f = 0.3): number => mix(col(i), 0x0b0b14, f);
export const light = (i: ColorIndex, f = 0.3): number => mix(col(i), 0xffffff, f);
export const css = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

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
