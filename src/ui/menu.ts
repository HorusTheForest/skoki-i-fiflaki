// A vertical menu usable with keyboard, mouse, touch and gamepad.

import Phaser from 'phaser';
import { BACK, input } from '../core/input';
import { IN } from '../physics/diver';
import { audio } from '../audio/engine';
import { C, col } from '../render/palette';
import { txt } from './text';

export interface MenuItem {
  label: string | (() => string);
  onSelect?: () => void;
  onLeft?: () => void;
  onRight?: () => void;
  disabled?: boolean;
  hint?: string;
}

export class Menu {
  private readonly texts: Phaser.GameObjects.BitmapText[] = [];
  private readonly g: Phaser.GameObjects.Graphics;
  index = 0;
  private readonly x: number;
  private readonly y: number;
  private readonly w: number;
  private readonly lineH: number;
  private readonly items: MenuItem[];
  onBack: (() => void) | null = null;
  onMove: ((i: number) => void) | null = null;
  private hintText: Phaser.GameObjects.BitmapText | null = null;

  constructor(scene: Phaser.Scene, items: MenuItem[], x: number, y: number, w: number, lineH = 12, hintY?: number) {
    this.items = items;
    this.x = x;
    this.y = y;
    this.w = w;
    this.lineH = lineH;
    this.g = scene.add.graphics().setScrollFactor(0).setDepth(100);
    items.forEach((_, i) => {
      this.texts.push(txt(scene, x + 10, y + i * lineH, '', C.white).setDepth(101));
    });
    if (hintY !== undefined) this.hintText = txt(scene, scene.scale.width / 2, hintY, '', C.lightGrey, 'center').setDepth(101);
    while (this.items[this.index]?.disabled && this.index < items.length - 1) this.index++;
    this.refresh();
  }

  refresh(): void {
    this.g.clear();
    this.items.forEach((it, i) => {
      const t = this.texts[i]!;
      const label = typeof it.label === 'function' ? it.label() : it.label;
      const sel = i === this.index;
      t.setText(label);
      t.setTint(col(it.disabled ? C.grey : sel ? C.gold : C.white));
      if (sel) {
        this.g.fillStyle(col(C.gold));
        const yy = this.y + i * this.lineH;
        this.g.fillRect(this.x + 2, yy + 2, 4, 4);
      }
    });
    this.hintText?.setText(this.items[this.index]?.hint ?? '');
  }

  private move(d: number): void {
    const n = this.items.length;
    let i = this.index;
    for (let k = 0; k < n; k++) {
      i = (i + d + n) % n;
      if (!this.items[i]!.disabled) break;
    }
    if (i !== this.index) {
      this.index = i;
      audio.play('menu');
      this.onMove?.(i);
      this.refresh();
    }
  }

  /** call once per frame; returns true when something happened */
  update(): boolean {
    const inp = input();
    inp.poll();
    const m = inp.menuPressed();
    if (m) audio.unlock();
    const it = this.items[this.index];
    if (m & IN.UP) this.move(-1);
    else if (m & IN.DOWN) this.move(1);
    else if (m & IN.LEFT && it?.onLeft) {
      it.onLeft();
      audio.play('menu');
      this.refresh();
    } else if (m & IN.RIGHT && it?.onRight) {
      it.onRight();
      audio.play('menu');
      this.refresh();
    } else if (m & IN.ACTION && it && !it.disabled) {
      audio.play('select');
      if (it.onSelect) it.onSelect();
      else it.onRight?.();
      this.refresh();
      return true;
    } else if (m & BACK && this.onBack) {
      audio.play('back');
      this.onBack();
      return true;
    }
    const click = inp.takeClick();
    if (click) {
      audio.unlock();
      const i = Math.floor((click.y - this.y + 2) / this.lineH);
      if (click.x >= this.x - 4 && click.x <= this.x + this.w && i >= 0 && i < this.items.length) {
        const target = this.items[i]!;
        if (target.disabled) return false;
        if (this.index !== i) {
          this.index = i;
          this.onMove?.(i);
        }
        // value items: left half decreases, right half increases
        if (target.onLeft && target.onRight && !target.onSelect) {
          if (click.x < this.x + this.w / 2) target.onLeft();
          else target.onRight();
          audio.play('menu');
        } else {
          audio.play('select');
          (target.onSelect ?? target.onRight)?.();
        }
        this.refresh();
        return true;
      }
    }
    return m !== 0;
  }

  destroy(): void {
    for (const t of this.texts) t.destroy();
    this.g.destroy();
    this.hintText?.destroy();
  }
}
