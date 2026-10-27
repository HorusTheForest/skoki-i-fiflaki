// 16-bit style fills: banded vertical gradients with a dithered seam
// between bands, the way console games faked smooth gradients.

import type Phaser from 'phaser';
import { mix } from './palette';

export function vGradient(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, top: number, bottom: number, bands = 8): void {
  const n = Math.max(2, Math.min(bands, Math.floor(h / 2)));
  const bh = h / n;
  for (let i = 0; i < n; i++) {
    g.fillStyle(mix(top, bottom, i / (n - 1)));
    const y0 = Math.round(y + i * bh);
    g.fillRect(x, y0, w, Math.round(y + (i + 1) * bh) - y0);
  }
  // checkerboard row on each seam
  for (let i = 1; i < n; i++) {
    const yy = Math.round(y + i * bh);
    g.fillStyle(mix(top, bottom, (i - 1) / (n - 1)));
    for (let xx = x + (yy & 1); xx < x + w; xx += 2) g.fillRect(xx, yy, 1, 1);
  }
}
