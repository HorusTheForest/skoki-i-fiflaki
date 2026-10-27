// 1980s TV replay overlay: scanlines, blinking REPLAY tag, channel bug with
// the rings, timecode and a lower third. Palette colours only.

import Phaser from 'phaser';
import { HEIGHT, SHOW_RINGS, WIDTH } from '../config';
import { C, col } from '../render/palette';
import { ensureRingsTexture } from '../render/sprites';
import { txt } from './text';

export class TvOverlay {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly tag: Phaser.GameObjects.BitmapText;
  private readonly time: Phaser.GameObjects.BitmapText;
  private readonly objs: Phaser.GameObjects.GameObject[] = [];
  private t = 0;

  constructor(scene: Phaser.Scene, score?: number) {
    this.g = scene.add.graphics().setScrollFactor(0).setDepth(300);
    this.g.fillStyle(col(C.black));
    for (let y = 0; y < HEIGHT; y += 3) this.g.fillRect(0, y, WIDTH, 1);
    // letterbox bars
    this.g.fillRect(0, 0, WIDTH, 10);
    this.g.fillRect(0, HEIGHT - 22, WIDTH, 22);
    this.g.fillStyle(col(C.deepBlue));
    this.g.fillRect(6, HEIGHT - 19, 180, 12);
    this.g.fillStyle(col(C.gold));
    this.g.fillRect(6, HEIGHT - 19, 3, 12);
    this.tag = txt(scene, 6, 1, '▶ POWTÓRKA', C.red).setDepth(301);
    this.time = txt(scene, WIDTH - 6, HEIGHT - 9, '00:00:00', C.lightGrey, 'right').setDepth(301);
    this.objs.push(this.tag, this.time, this.g);
    this.objs.push(txt(scene, 12, HEIGHT - 17, score !== undefined ? `NOTA ${score.toFixed(2)}` : 'SKOKI TV', C.white).setDepth(301));
    if (SHOW_RINGS) {
      ensureRingsTexture(scene, 'rings-tv', 3, C.white);
      this.objs.push(scene.add.image(WIDTH - 22, 6, 'rings-tv').setScrollFactor(0).setDepth(301));
    }
    this.objs.push(txt(scene, WIDTH - 44, 1, 'TV', C.white, 'right').setDepth(301));
  }

  update(dt: number, simT: number): void {
    this.t += dt;
    this.tag.setVisible(Math.floor(this.t * 2) % 2 === 0);
    const f = Math.floor(simT * 25) % 25;
    const s = Math.floor(simT);
    this.time.setText(`00:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`);
  }

  destroy(): void {
    for (const o of this.objs) o.destroy();
  }
}
