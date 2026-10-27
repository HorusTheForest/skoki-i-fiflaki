// Pixel font: Press Start 2P (SIL Open Font License, bundled locally via
// @fontsource). It is rasterised once at its native 8 px size and the alpha
// is thresholded to 1 bit, which gives a crisp bitmap font in Phaser.

import '@fontsource/press-start-2p/400.css';
import Phaser from 'phaser';

export const FONT = 'px';
export const FONT_FAMILY = '"Press Start 2P"';
const CELL = 8;
export const FONT_CHARS =
  ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~' +
  'ąćęłńóśźżĄĆĘŁŃÓŚŹŻ½°×←→↑↓★·';
const PER_ROW = 16;

export async function loadFont(): Promise<void> {
  try {
    await document.fonts.load(`8px ${FONT_FAMILY}`, 'AąŁ½');
    await document.fonts.ready;
  } catch {
    // fall back to the browser's monospace; the game still works
  }
}

/** Draw arrows and the star by hand: they are not in the font. */
function drawSymbol(ctx: CanvasRenderingContext2D, ch: string, x: number, y: number): boolean {
  const px = (rows: string[]) => {
    rows.forEach((r, j) => {
      for (let i = 0; i < r.length; i++) if (r[i] === '#') ctx.fillRect(x + i, y + j, 1, 1);
    });
  };
  const maps: Record<string, string[]> = {
    '←': ['', '  #', ' ##', '#######', ' ##', '  #'],
    '→': ['', '    #', '    ##', '#######', '    ##', '    #'],
    '↑': ['   #', '  ###', ' #####', '   #', '   #', '   #', '   #'],
    '↓': ['   #', '   #', '   #', '   #', ' #####', '  ###', '   #'],
    '★': ['   #', '   #', '#######', ' #####', '  ###', ' ## ##', ' #   #'],
    '·': ['', '', '', '  ##', '  ##'],
  };
  const m = maps[ch];
  if (!m) return false;
  px(m);
  return true;
}

export function createBitmapFont(scene: Phaser.Scene): void {
  if (scene.cache.bitmapFont.exists(FONT)) return;
  const chars = [...FONT_CHARS];
  const rows = Math.ceil(chars.length / PER_ROW);
  const canvas = document.createElement('canvas');
  canvas.width = PER_ROW * CELL;
  canvas.height = rows * CELL;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fcfcfc';
  ctx.textBaseline = 'top';
  ctx.font = `8px ${FONT_FAMILY}`;
  chars.forEach((ch, i) => {
    const x = (i % PER_ROW) * CELL;
    const y = Math.floor(i / PER_ROW) * CELL;
    if (!drawSymbol(ctx, ch, x, y)) ctx.fillText(ch, x, y);
  });
  // 1-bit threshold: no anti-aliasing anywhere
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const on = d[i + 3]! >= 110;
    d[i] = d[i + 1] = d[i + 2] = 252;
    d[i + 3] = on ? 255 : 0;
  }
  ctx.putImageData(img, 0, 0);
  scene.textures.addCanvas('font-px', canvas);
  const data = Phaser.GameObjects.RetroFont.Parse(scene, {
    image: 'font-px',
    width: CELL,
    height: CELL,
    chars: FONT_CHARS,
    charsPerRow: PER_ROW,
    'offset.x': 0,
    'offset.y': 0,
    'spacing.x': 0,
    'spacing.y': 0,
    lineSpacing: 2,
  });
  // Phaser 4 returns a ready cache entry ({ data, texture, frame }); Phaser 3 returned bare font data
  const entry = 'chars' in (data as object) ? { data, texture: 'font-px', frame: null } : data;
  scene.cache.bitmapFont.add(FONT, entry);
}
