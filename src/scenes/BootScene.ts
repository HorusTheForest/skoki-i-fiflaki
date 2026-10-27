import Phaser from 'phaser';
import { createBitmapFont, preloadFont } from '../render/font';
import { ensureBasics } from '../render/sprites';
import { ASEPRITE_ATLAS } from '../config';
import { replayFromHash } from '../core/replay';
import type { DiveConfig } from './DiveScene';
import type { ArenaKind } from '../render/arena';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
    preloadFont(this);
    if (ASEPRITE_ATLAS) this.load.aseprite('diver-atlas', `${ASEPRITE_ATLAS}.png`, `${ASEPRITE_ATLAS}.json`);
  }

  create(): void {
    createBitmapFont(this);
    ensureBasics(this);
    document.getElementById('boot')?.remove();
    const r = replayFromHash(location.hash);
    if (r) {
      const cfg: DiveConfig = {
        mode: 'replay',
        tv: true,
        code: r.code,
        height: r.height,
        synchro: !!r.partner,
        zoneWidth: r.zone,
        ribbon: false,
        seed: r.seed,
        arena: (r.arena as ArenaKind) ?? 'day',
        replay: r,
      };
      if (r.partner) cfg.partner = r.partner;
      this.scene.start('Dive', cfg);
    } else {
      this.scene.start('Menu');
    }
  }
}
