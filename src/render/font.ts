// Pixel font: a fixed 8x8 bitmap atlas rasterised once from Press Start 2P
// (SIL Open Font License) by scripts/font-atlas.mjs. Using a stored bitmap
// instead of drawing the web font at runtime keeps every glyph identical on
// all systems (no hinting or ClearType blurring the letters together).

import Phaser from 'phaser';
import { FONT_CHARS, FONT_PNG } from './fontAtlas';

export const FONT = 'px';
const CELL = 8;
const PER_ROW = 16;

export function preloadFont(scene: Phaser.Scene): void {
  if (!scene.textures.exists('font-px')) scene.load.image('font-px', FONT_PNG);
}

export function createBitmapFont(scene: Phaser.Scene): void {
  if (scene.cache.bitmapFont.exists(FONT)) return;
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
