// Campaign map: 50 levels in a 10 x 5 grid with stars, locks and finals,
// and a panel describing the selected level. Keyboard, mouse, touch, pad.

import Phaser from 'phaser';
import { HEIGHT, WIDTH } from '../config';
import { C, col } from '../render/palette';
import { panel, txt } from '../ui/text';
import { BACK, input } from '../core/input';
import { IN } from '../physics/diver';
import { getSave } from '../core/save';
import { audio } from '../audio/engine';
import { music } from '../audio/music';
import { isFinal, LEVELS, type Modifier } from '../levels/levels';
import { currentLevel, isUnlocked, startLevel, unlockText } from '../levels/progress';
import { partnerById } from '../ai/partner';

const COLS = 10;
const CELL_W = 30;
const CELL_H = 18;
const GX = (WIDTH - COLS * CELL_W) / 2;
const GY = 18;

const MOD_TEXT: Record<Modifier, string> = {
  noLine: 'bez linii',
  noAssist: 'bez asysty',
  shortRibbon: 'krótka wstęga',
  night: 'noc',
  outdoor: 'plener',
};

export class LevelsScene extends Phaser.Scene {
  private sel = 1;
  private grid!: Phaser.GameObjects.Graphics;
  private cells: Phaser.GameObjects.BitmapText[] = [];
  private stars: Phaser.GameObjects.BitmapText[] = [];
  private info: Phaser.GameObjects.BitmapText[] = [];

  constructor() {
    super('Levels');
  }

  create(): void {
    this.cameras.main.setBackgroundColor(col(C.navy));
    const s = getSave();
    this.sel = currentLevel(s);
    this.cells = [];
    this.stars = [];
    const total = Object.values(s.levels).reduce((a, l) => a + l.stars, 0);
    txt(this, 6, 5, '← KAMPANIA SYNCHRO', C.gold);
    txt(this, WIDTH - 6, 5, `★ ${total}/${LEVELS.length * 3}`, C.gold, 'right');
    this.grid = this.add.graphics().setScrollFactor(0);
    for (const l of LEVELS) {
      const [x, y] = this.cellPos(l.id);
      this.cells.push(txt(this, x + CELL_W / 2, y + 2, String(l.id), C.white, 'center').setDepth(2));
      this.stars.push(txt(this, x + CELL_W / 2, y + 10, '', C.gold, 'center').setDepth(2));
    }
    panel(this, 4, GY + 5 * CELL_H + 4, WIDTH - 8, HEIGHT - (GY + 5 * CELL_H + 4) - 4, C.black, C.slate);
    const top = GY + 5 * CELL_H + 8;
    this.info = [0, 1, 2, 3, 4].map((i) => txt(this, 10, top + i * 9, '', C.white).setDepth(2));
    this.refresh();
    music.play('menu');
  }

  private cellPos(id: number): [number, number] {
    const i = id - 1;
    return [GX + (i % COLS) * CELL_W, GY + Math.floor(i / COLS) * CELL_H];
  }

  private refresh(): void {
    const s = getSave();
    const g = this.grid;
    g.clear();
    for (const l of LEVELS) {
      const [x, y] = this.cellPos(l.id);
      const open = isUnlocked(l.id, s);
      const st = s.levels[String(l.id)]?.stars ?? 0;
      const final = isFinal(l);
      g.fillStyle(col(!open ? C.black : final ? C.darkRed : st ? C.darkGreen : C.blue));
      g.fillRect(x + 1, y + 1, CELL_W - 2, CELL_H - 2);
      if (l.id === this.sel) {
        g.lineStyle(1, col(C.gold));
        g.strokeRect(x + 0.5, y + 0.5, CELL_W - 1, CELL_H - 1);
      }
      const t = this.cells[l.id - 1]!;
      t.setText(open ? String(l.id) : final ? 'F' : '·');
      t.setTint(col(!open ? C.slate : final ? C.gold : C.white));
      this.stars[l.id - 1]!.setText(open ? '★'.repeat(st) + '·'.repeat(3 - st) : '');
    }
    const l = LEVELS[this.sel - 1]!;
    const open = isUnlocked(l.id, s);
    const best = s.levels[String(l.id)]?.best ?? 0;
    const p = partnerById(l.partner);
    const mods = [...(l.ribbon ? [] : ['bez wstęgi']), ...l.modifiers.map((m) => MOD_TEXT[m])];
    const lines: [string, number][] = [
      [`${l.id}. ${l.name.toUpperCase()}${isFinal(l) ? ` (FINAŁ, ${l.dives.length} SERIE)` : ''}`, isFinal(l) ? C.gold : C.lime],
      [`${l.dives.join(' ')}  z: ${p.name}`, C.white],
      [`Próg ${l.scoreMin}  sync ${l.syncMin.toFixed(1)}  ★★ ${l.stars[0]}  ★★★ ${l.stars[1]}`.slice(0, 38), C.lightGrey],
      [mods.length ? `Utrudnienia: ${mods.join(', ')}` : best ? `Najlepszy wynik: ${best.toFixed(2)}` : l.unlock ? `Nagroda: ${unlockText(l.unlock)}` : '', C.paleYellow],
      [open ? 'AKCJA start   ESC menu' : 'Zablokowany: zalicz poprzedni poziom', open ? C.sky : C.salmon],
    ];
    lines.forEach(([t, c], i) => this.info[i]!.setText(t.slice(0, 38)).setTint(col(c)));
  }

  private move(d: number): void {
    const n = Math.min(LEVELS.length, Math.max(1, this.sel + d));
    if (n !== this.sel) {
      this.sel = n;
      audio.play('menu');
      this.refresh();
    }
  }

  private start(): void {
    if (!isUnlocked(this.sel)) {
      audio.play('back');
      return;
    }
    audio.play('select');
    startLevel(this, this.sel);
  }

  override update(): void {
    const inp = input();
    inp.poll();
    const m = inp.menuPressed();
    if (m) audio.unlock();
    if (m & IN.LEFT) this.move(-1);
    else if (m & IN.RIGHT) this.move(1);
    else if (m & IN.UP) this.move(-COLS);
    else if (m & IN.DOWN) this.move(COLS);
    else if (m & IN.ACTION) this.start();
    else if (m & BACK) {
      audio.play('back');
      this.scene.start('Menu');
    }
    const click = inp.takeClick();
    if (click) {
      audio.unlock();
      const cx = Math.floor((click.x - GX) / CELL_W);
      const cy = Math.floor((click.y - GY) / CELL_H);
      if (cx >= 0 && cx < COLS && cy >= 0 && cy < 5) {
        const id = cy * COLS + cx + 1;
        if (id === this.sel) this.start();
        else {
          this.sel = id;
          audio.play('menu');
          this.refresh();
        }
      } else if (click.y < GY) this.scene.start('Menu');
      else if (click.y > GY + 5 * CELL_H) this.start();
    }
  }
}
