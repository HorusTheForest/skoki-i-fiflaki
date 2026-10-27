import Phaser from 'phaser';
import { GAME_SUBTITLE, GAME_TITLE, HEIGHT, SHOW_RINGS, UI_H, WIDTH } from '../config';
import { C, col, cssCol, light, mix, shade } from '../render/palette';
import { vGradient } from '../render/fx';
import { ensureRingsTexture } from '../render/sprites';
import { Menu, type MenuItem } from '../ui/menu';
import { title, txt } from '../ui/text';
import { getSave } from '../core/save';
import { PLATFORMS, type ArenaKind } from '../render/arena';
import type { DiveConfig } from './DiveScene';
import { audio } from '../audio/engine';
import { music } from '../audio/music';

export class MenuScene extends Phaser.Scene {
  private menu!: Menu;
  private height = 10;
  private waves!: Phaser.GameObjects.Graphics;
  private t = 0;

  constructor() {
    super('Menu');
  }

  create(): void {
    audio.arena(false);
    // the title screen fills the whole window: evening sky over the pool
    this.cameras.main.setBackgroundColor(col(C.navy));
    document.body.style.background = cssCol(C.navy);
    const sky = this.add.graphics();
    vGradient(sky, 0, 0, WIDTH, HEIGHT - 40, col(C.navy), mix(col(C.violet), col(C.salmon), 0.55), 14);
    this.waves = this.add.graphics();
    const cx = Math.round(WIDTH / 2);
    const top = Math.floor((HEIGHT - UI_H) / 2);
    if (SHOW_RINGS) {
      ensureRingsTexture(this, 'rings-title', 22, C.white);
      this.add.image(cx, top + 48, 'rings-title');
    }
    title(this, cx, top + 92, GAME_TITLE, 24, col(C.paleYellow), col(C.orange));
    title(this, cx, top + 122, GAME_SUBTITLE, 16, light(C.sky, 0.4), shade(C.sky, 0.1));
    const save = getSave();
    const arena = (save.arena as ArenaKind) ?? 'day';
    const free = (mode: 'freestyle' | 'training', synchro: boolean): DiveConfig => ({
      mode,
      code: synchro ? '105C' : '103C',
      height: synchro ? 10 : this.height,
      synchro,
      partner: save.partner,
      zoneWidth: 0.14,
      ribbon: true,
      seed: Math.floor(Math.random() * 1e9),
      arena,
      choose: true,
    });
    const items: MenuItem[] = [
      { label: 'KAMPANIA SYNCHRO', onSelect: () => this.scene.start('Levels'), hint: '50 poziomów z partnerem AI' },
      {
        label: () => `FREESTYLE  ${this.height === 7.5 ? '7½' : this.height} M`,
        onSelect: () => this.scene.start('Dive', free('freestyle', false)),
        onLeft: () => this.cycleHeight(-1),
        onRight: () => this.cycleHeight(1),
        hint: '←→ wysokość platformy, rekordy i duch',
      },
      { label: 'SYNCHRO TRENING', onSelect: () => this.scene.start('Dive', free('freestyle', true)), hint: 'Dowolny skok z partnerem' },
      { label: 'TRENING', onSelect: () => this.scene.start('Dive', free('training', false)), hint: 'Slow-mo i dane: ω, I, kąt wejścia' },
      { label: 'SZATNIA', onSelect: () => this.scene.start('Locker'), hint: 'Strój, partner i arena' },
      { label: 'USTAWIENIA', onSelect: () => this.scene.start('Settings'), hint: 'Głośność, klawisze, asysty, tryb Pro' },
    ];
    this.menu = new Menu(this, items, cx - 110, top + 156, 220, 18, HEIGHT - 14);
    txt(this, WIDTH - 4, HEIGHT - 26, 'v0.2', C.lightGrey, 'right');
    this.input.once('pointerdown', () => audio.unlock());
    music.play('menu');
    music.duck(1, 0.3);
  }

  private cycleHeight(d: number): void {
    const i = PLATFORMS.indexOf(this.height as (typeof PLATFORMS)[number]);
    this.height = PLATFORMS[(i + d + PLATFORMS.length) % PLATFORMS.length]!;
  }

  override update(_t: number, dms: number): void {
    this.t += dms / 1000;
    this.menu.update();
    const g = this.waves;
    g.clear();
    // three layers of waves, lighter towards the front
    const layers: [number, number, number][] = [
      [HEIGHT - 52, col(C.deepWater), 0.6],
      [HEIGHT - 40, col(C.teal), 1],
      [HEIGHT - 28, col(C.cyan), 1.4],
    ];
    for (const [base, c, sp] of layers) {
      for (let x = 0; x < WIDTH; x += 2) {
        const y = Math.round(base + Math.sin(x * 0.04 + this.t * 2 * sp) * 3 + Math.sin(x * 0.013 - this.t * sp) * 3);
        g.fillStyle(c);
        g.fillRect(x, y, 2, HEIGHT - y);
        g.fillStyle(mix(c, 0xffffff, 0.35));
        g.fillRect(x, y, 2, 1);
      }
    }
  }
}
