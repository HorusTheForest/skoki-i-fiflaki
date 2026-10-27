import Phaser from 'phaser';
import { FONT } from '../render/font';
import { C, col, type ColorIndex } from '../render/palette';

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

export function panel(scene: Phaser.Scene, x: number, y: number, w: number, h: number, fill: ColorIndex = C.navy, border: ColorIndex = C.white): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics().setScrollFactor(0);
  g.fillStyle(col(border));
  g.fillRect(x, y, w, h);
  g.fillStyle(col(fill));
  g.fillRect(x + 1, y + 1, w - 2, h - 2);
  return g;
}
