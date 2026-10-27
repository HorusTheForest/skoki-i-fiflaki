import Phaser from 'phaser';
import { GAME_SUBTITLE, GAME_TITLE, HEIGHT, SHOW_RINGS, WIDTH } from '../config';
import { C, col } from '../render/palette';
import { ensureRingsTexture } from '../render/sprites';
import { Menu, type MenuItem } from '../ui/menu';
import { txt } from '../ui/text';
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
    this.cameras.main.setBackgroundColor(col(C.navy));
    this.waves = this.add.graphics();
    if (SHOW_RINGS) {
      ensureRingsTexture(this, 'rings-title', 9, C.white);
      this.add.image(WIDTH / 2, 26, 'rings-title');
    }
    txt(this, WIDTH / 2 + 1, 53, GAME_TITLE, C.black, 'center');
    txt(this, WIDTH / 2, 52, GAME_TITLE, C.gold, 'center');
    txt(this, WIDTH / 2, 64, GAME_SUBTITLE, C.sky, 'center');
    const save = getSave();
    const arena = (save.arena as ArenaKind) ?? 'day';
    const free = (mode: 'freestyle' | 'training', synchro: boolean): DiveConfig => ({
      mode,
      code: synchro ? '105C' : '103C',
      height: synchro ? 10 : this.height,
      synchro,
      partner: 'ola',
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
      { label: 'USTAWIENIA', onSelect: () => this.scene.start('Settings'), hint: 'Głośność, klawisze, asysty, tryb Pro' },
    ];
    this.menu = new Menu(this, items, 92, 84, 150, 12, HEIGHT - 10);
    txt(this, WIDTH - 2, HEIGHT - 20, 'v0.1', C.slate, 'right');
    this.input.once('pointerdown', () => audio.unlock());
    music.play('menu');
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
    for (let x = 0; x < WIDTH; x++) {
      const y = Math.round(HEIGHT - 26 + Math.sin(x * 0.08 + this.t * 2) * 2 + Math.sin(x * 0.03 - this.t) * 2);
      g.fillStyle(col(C.teal));
      g.fillRect(x, y, 1, HEIGHT - y);
      g.fillStyle(col(C.cyan));
      g.fillRect(x, y, 1, 1);
    }
  }
}
