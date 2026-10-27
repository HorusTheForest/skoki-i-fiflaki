// Procedural sprites: everything is drawn from tiny pixel maps in code, so
// the game runs without image files. All frames live in one canvas atlas per
// outfit with the same frame names an Aseprite export would use, so a real
// atlas can replace them (see ASEPRITE_ATLAS in config.ts).

import Phaser from 'phaser';
import { C, OUTFITS, cssCol, type ColorIndex } from './palette';
import { COUNTRIES, type Country } from '../levels/countries';

export const FRAME_NAMES = [
  'head',
  'headFront',
  'headBack',
  'torso',
  'torsoFront',
  'torsoBack',
  'upperArm',
  'forearm',
  'thigh',
  'shin',
  'foot',
  'upperArmFar',
  'forearmFar',
  'thighFar',
  'shinFar',
  'footFar',
] as const;
export type FrameName = (typeof FRAME_NAMES)[number];

/**
 * Pixel maps. Side view, front of the body to the right. Limbs are drawn
 * pointing down from the proximal joint, the torso pointing up from the hip.
 * h hair, s skin, S light skin, d dark skin, e eye, c costume, a accent.
 */
const MAPS: Record<FrameName, string[]> = {
  head: ['.hhh.', 'hhhss', 'hhhes', '.hsss', '..ss.'],
  headFront: ['.hhh.', 'hhhhh', 'sesse', 'sssss', '.sss.'],
  headBack: ['.hhh.', 'hhhhh', 'hhhhh', 'hhhhh', '.sss.'],
  torso: ['.sss.', 'sccca', 'scccc', '.cccc', '.cacc', '.cccc', '.cccc', 'ccccc', '.ccc.'],
  torsoFront: ['.sss.', 'scccs', 'caaac', 'ccccc', '.ccc.', '.ccc.', '.ccc.', 'ccccc', '.c.c.'],
  torsoBack: ['.sss.', 'scccs', 'ccacc', 'ccacc', '.ccc.', '.ccc.', '.ccc.', 'ccccc', '.c.c.'],
  upperArm: ['ss', 'ss', 'ss', 'ss', 'ss'],
  forearm: ['ss', 'ss', 'ss', 'ss', 'SS', 'S.'],
  thigh: ['ccc', 'ccc', 'sss', 'sss', 'sss', '.ss', '.ss'],
  shin: ['ss', 'ss', 'ss', 'ss', 'ss', 'ss', 'ss'],
  foot: ['ss', 'ss', 'ss', 'S.'],
  upperArmFar: ['dd', 'dd', 'dd', 'dd', 'dd'],
  forearmFar: ['dd', 'dd', 'dd', 'dd', 'dd', 'd.'],
  thighFar: ['aaa', 'aaa', 'ddd', 'ddd', 'ddd', '.dd', '.dd'],
  shinFar: ['dd', 'dd', 'dd', 'dd', 'dd', 'dd', 'dd'],
  footFar: ['dd', 'dd', 'dd', 'd.'],
};

/** Origin of each frame: the joint the segment rotates around. */
export const ORIGINS: Record<FrameName, [number, number]> = {
  head: [0.5, 0.5],
  headFront: [0.5, 0.5],
  headBack: [0.5, 0.5],
  torso: [0.5, 1],
  torsoFront: [0.5, 1],
  torsoBack: [0.5, 1],
  upperArm: [0.5, 0],
  forearm: [0.5, 0],
  thigh: [0.5, 0],
  shin: [0.5, 0],
  foot: [0.5, 0],
  upperArmFar: [0.5, 0],
  forearmFar: [0.5, 0],
  thighFar: [0.5, 0],
  shinFar: [0.5, 0],
  footFar: [0.5, 0],
};

export interface DiverLook {
  outfit: number;
  hair: ColorIndex;
  skin: 0 | 1 | 2;
}

const SKINS: [ColorIndex, ColorIndex, ColorIndex][] = [
  [C.skin, C.skinLight, C.skinDark],
  [C.skinLight, C.white, C.skin],
  [C.skinDark, C.skin, C.brown],
];

export function diverTextureKey(look: DiverLook): string {
  return `diver-${look.outfit}-${look.hair}-${look.skin}`;
}

function paintMap(ctx: CanvasRenderingContext2D, rows: string[], ox: number, oy: number, colors: Record<string, ColorIndex>) {
  rows.forEach((r, y) => {
    for (let x = 0; x < r.length; x++) {
      const ci = colors[r[x]!];
      if (ci === undefined) continue;
      ctx.fillStyle = cssCol(ci);
      ctx.fillRect(ox + x, oy + y, 1, 1);
    }
  });
}

/** Build (once) the procedural diver atlas for a look. Returns its texture key. */
export function ensureDiverTexture(scene: Phaser.Scene, look: DiverLook): string {
  const key = diverTextureKey(look);
  if (scene.textures.exists(key)) return key;
  const outfit = OUTFITS[look.outfit % OUTFITS.length]!;
  const [skin, light, dark] = SKINS[look.skin]!;
  const colors: Record<string, ColorIndex> = {
    h: look.hair,
    s: skin,
    S: light,
    d: dark,
    e: C.black,
    c: outfit.main,
    a: outfit.accent,
  };
  const canvas = document.createElement('canvas');
  canvas.width = FRAME_NAMES.length * 6;
  canvas.height = 10;
  const ctx = canvas.getContext('2d')!;
  const rects: [FrameName, number, number, number, number][] = [];
  FRAME_NAMES.forEach((name, i) => {
    const rows = MAPS[name];
    const w = Math.max(...rows.map((r) => r.length));
    const x = i * 6;
    const far = name.endsWith('Far');
    const cmap = far ? { ...colors, a: outfit.main, c: outfit.main } : colors;
    paintMap(ctx, rows, x, 0, cmap);
    rects.push([name, x, 0, w, rows.length]);
  });
  const tex = scene.textures.addCanvas(key, canvas)!;
  for (const [name, x, y, w, h] of rects) tex.add(name, 0, x, y, w, h);
  return key;
}

// ---------------------------------------------------------------------------
// Arena sprites

/** crowd strip: two frames (arms down / arms up) of a row of spectators */
export function ensureCrowdTexture(scene: Phaser.Scene, key: string, seed: number, night: boolean): void {
  if (scene.textures.exists(key)) return;
  const W = 64;
  const H = 8;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H * 2;
  const ctx = canvas.getContext('2d')!;
  // muted colours so the divers stand out in front of the stands
  const shirts = night ? [C.slate, C.deepBlue, C.charcoal, C.navy, C.grey] : [C.slate, C.grey, C.lightGrey, C.teal, C.sky, C.salmon, C.paleBlue];
  const skins = night ? [C.grey, C.slate] : [C.skinDark, C.skin, C.grey];
  let s = seed;
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  for (let f = 0; f < 2; f++) {
    let st = seed;
    s = st;
    for (let x = 0; x < W; x += 4) {
      const shirt = shirts[Math.floor(rnd() * shirts.length)]!;
      const skin = skins[Math.floor(rnd() * skins.length)]!;
      const jump = rnd() < 0.5 ? 1 : 0;
      const oy = f * H + (f === 1 ? -jump : 0);
      ctx.fillStyle = cssCol(skin);
      ctx.fillRect(x + 1, oy + 2, 2, 2);
      ctx.fillStyle = cssCol(shirt);
      ctx.fillRect(x, oy + 4, 4, 4);
      if (f === 1 && jump) {
        ctx.fillStyle = cssCol(skin);
        ctx.fillRect(x, oy + 1, 1, 3);
        ctx.fillRect(x + 3, oy + 1, 1, 3);
      }
      st++;
    }
  }
  const tex = scene.textures.addCanvas(key, canvas)!;
  tex.add('a', 0, 0, 0, W, H);
  tex.add('b', 0, 0, H, W, H);
}

export const FLAG_W = 9;
export const FLAG_H = 6;

export function drawFlag(ctx: CanvasRenderingContext2D, c: Country, x: number, y: number): void {
  const f = c.flag;
  const n = f.colors.length;
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = cssCol(f.colors[i]!);
    if (f.layout === 'h') {
      const y0 = Math.round((i * FLAG_H) / n);
      const y1 = Math.round(((i + 1) * FLAG_H) / n);
      ctx.fillRect(x, y + y0, FLAG_W, y1 - y0);
    } else {
      const x0 = Math.round((i * FLAG_W) / n);
      const x1 = Math.round(((i + 1) * FLAG_W) / n);
      ctx.fillRect(x + x0, y, x1 - x0, FLAG_H);
    }
  }
  if (f.mark) {
    ctx.fillStyle = cssCol(f.mark.color);
    const m = f.mark;
    switch (m.kind) {
      case 'dot':
        ctx.fillRect(x + 3, y + 2, 3, 2);
        ctx.fillRect(x + 4, y + 1, 1, 4);
        break;
      case 'cross':
        ctx.fillRect(x + 2, y, 2, FLAG_H);
        ctx.fillRect(x, y + 2, FLAG_W, 2);
        break;
      case 'canton':
        ctx.fillRect(x, y, 4, 3);
        break;
      case 'star':
        ctx.fillRect(x + 1, y + 1, 2, 2);
        break;
      case 'centerCross':
        ctx.fillRect(x + 4, y, 1, FLAG_H);
        ctx.fillRect(x, y + 2, FLAG_W, 2);
        break;
      case 'triangle':
        for (let j = 0; j < FLAG_H; j++) {
          const w = Math.min(j + 1, FLAG_H - j);
          ctx.fillRect(x, y + j, w, 1);
        }
        break;
    }
  }
}

export function ensureFlagsTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists('flags')) return;
  const canvas = document.createElement('canvas');
  canvas.width = COUNTRIES.length * (FLAG_W + 1);
  canvas.height = FLAG_H;
  const ctx = canvas.getContext('2d')!;
  COUNTRIES.forEach((c, i) => drawFlag(ctx, c, i * (FLAG_W + 1), 0));
  const tex = scene.textures.addCanvas('flags', canvas)!;
  COUNTRIES.forEach((c, i) => tex.add(c.code, 0, i * (FLAG_W + 1), 0, FLAG_W, FLAG_H));
}

/** pixel circle outline (midpoint algorithm), thickness 2 */
function ring(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, colr: ColorIndex, clip?: (x: number, y: number) => boolean) {
  ctx.fillStyle = cssCol(colr);
  for (let y = -r - 1; y <= r + 1; y++) {
    for (let x = -r - 1; x <= r + 1; x++) {
      const d = Math.sqrt(x * x + y * y);
      if (d >= r - 1.2 && d <= r + 0.6) {
        if (clip && !clip(cx + x, cy + y)) continue;
        ctx.fillRect(cx + x, cy + y, 1, 1);
      }
    }
  }
}

/** Olympic rings in pixel art (blue, yellow, black, green, red), interlaced. */
export function ensureRingsTexture(scene: Phaser.Scene, key: string, r: number, black: ColorIndex = C.black): void {
  if (scene.textures.exists(key)) return;
  const gap = Math.round(r * 2.2);
  const w = gap * 2 + r * 2 + 4;
  const h = r * 3 + 4;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const top = r + 1;
  const bottom = top + r;
  const x0 = r + 2;
  const rings: [number, number, ColorIndex][] = [
    [x0, top, C.blue],
    [x0 + gap, top, black],
    [x0 + gap * 2, top, C.red],
    [x0 + gap / 2, bottom, C.gold],
    [x0 + gap * 1.5, bottom, C.green],
  ];
  // draw bottom rings first, then top rings, then re-draw bottom ring pieces
  // on top at the right crossings to fake the interlace
  for (const [x, y, c] of rings.slice(3)) ring(ctx, Math.round(x), y, r, c);
  for (const [x, y, c] of rings.slice(0, 3)) ring(ctx, Math.round(x), y, r, c);
  for (const [x, y, c] of rings.slice(3)) ring(ctx, Math.round(x), y, r, c, (px, py) => py > y - 1 && px > x);
  scene.textures.addCanvas(key, canvas);
}

/** 1x1 white pixel and a few utility textures */
export function ensureBasics(scene: Phaser.Scene): void {
  if (!scene.textures.exists('px')) {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = cssCol(C.white);
    ctx.fillRect(0, 0, 1, 1);
    scene.textures.addCanvas('px', c);
  }
  ensureFlagsTexture(scene);
}
