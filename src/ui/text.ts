import Phaser from 'phaser';
import { FONT } from '../render/font';
import { C, col, cssCol, light, shade, type ColorIndex } from '../render/palette';
import { vGradient } from '../render/fx';
import { HEIGHT, UI_H, UI_W, WIDTH } from '../config';

export function txt(
  scene: Phaser.Scene,
  x: number,
  y: number,
  s: string,
  color: ColorIndex = C.white,
  align: 'left' | 'center' | 'right' = 'left',
): Phaser.GameObjects.BitmapText {
  const t = scene.add.bitmapText(Math.round(x), Math.round(y), FONT, s, 8);
  t.setTint(col(color));
  t.setOrigin(align === 'left' ? 0 : align === 'center' ? 0.5 : 1, 0);
  t.setScrollFactor(0);
  return t;
}

/** text with a 1px palette shadow for readability over the arena */
export function shadowTxt(
  scene: Phaser.Scene,
  x: number,
  y: number,
  s: string,
  color: ColorIndex = C.white,
  align: 'left' | 'center' | 'right' = 'left',
  shadow: ColorIndex = C.black,
): { main: Phaser.GameObjects.BitmapText; shadow: Phaser.GameObjects.BitmapText; set: (s: string) => void; destroy: () => void; setVisible: (v: boolean) => void; setDepth: (d: number) => void } {
  const sh = txt(scene, x + 1, y + 1, s, shadow, align);
  const main = txt(scene, x, y, s, color, align);
  return {
    main,
    shadow: sh,
    set: (v: string) => {
      main.setText(v);
      sh.setText(v);
    },
    destroy: () => {
      main.destroy();
      sh.destroy();
    },
    setVisible: (v: boolean) => {
      main.setVisible(v);
      sh.setVisible(v);
    },
    setDepth: (d: number) => {
      sh.setDepth(d);
      main.setDepth(d + 0.01);
    },
  };
}

/** 16-bit panel: dark rim, light bevel on top, gradient fill */
export function panel(scene: Phaser.Scene, x: number, y: number, w: number, h: number, fill: ColorIndex = C.navy, border: ColorIndex = C.white): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics().setScrollFactor(0);
  g.fillStyle(shade(border, 0.55));
  g.fillRect(x, y, w, h);
  g.fillStyle(col(border));
  g.fillRect(x + 1, y + 1, w - 2, h - 2);
  vGradient(g, x + 2, y + 2, w - 4, h - 4, light(fill, 0.12), shade(fill, 0.25), Math.max(2, Math.round(h / 12)));
  g.fillStyle(light(border, 0.45));
  g.fillRect(x + 2, y + 1, w - 4, 1);
  return g;
}

/**
 * Menus and result screens: lay out in a UI_W x UI_H area centred in the
 * (bigger) game buffer, and colour the page around it.
 */
export function uiFrame(scene: Phaser.Scene, color: ColorIndex): void {
  const cam = scene.cameras.main;
  cam.setViewport(Math.floor((WIDTH - UI_W) / 2), Math.floor((HEIGHT - UI_H) / 2), UI_W, UI_H);
  cam.setBackgroundColor(col(color));
  document.body.style.background = cssCol(color);
}

/** title text with a top-to-bottom tint gradient and a drop shadow */
export function title(scene: Phaser.Scene, x: number, y: number, s: string, size: number, top: number, bottom: number): Phaser.GameObjects.BitmapText {
  const k = size / 8;
  scene.add.bitmapText(x + k, y + k, FONT, s, size).setOrigin(0.5, 0).setScrollFactor(0).setTint(0x0b0b14);
  return scene.add.bitmapText(x, y, FONT, s, size).setOrigin(0.5, 0).setScrollFactor(0).setTint(top, top, bottom, bottom);
}
