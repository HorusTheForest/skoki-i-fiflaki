import Phaser from 'phaser';
import { HEIGHT, WIDTH } from './config';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { DiveScene } from './scenes/DiveScene';
import { ResultsScene } from './scenes/ResultsScene';
import { LevelsScene } from './scenes/LevelsScene';
import { SettingsScene } from './scenes/SettingsScene';
import { LockerScene } from './scenes/LockerScene';
import { initInput } from './core/input';
import { load } from './core/save';
import { audio } from './audio/engine';

load();

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: WIDTH,
  height: HEIGHT,
  pixelArt: true,
  roundPixels: true,
  antialias: false,
  backgroundColor: '#000000',
  scale: {
    mode: Phaser.Scale.NONE,
    zoom: Phaser.Scale.MAX_ZOOM,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  input: { keyboard: false, mouse: true, touch: true, gamepad: false },
  audio: { noAudio: true },
  fps: { target: 60 },
  scene: [BootScene, MenuScene, DiveScene, ResultsScene, LevelsScene, SettingsScene, LockerScene],
});

// integer scaling only: recompute the largest whole zoom on resize
const fit = () => {
  const z = Math.max(1, Math.floor(Math.min(window.innerWidth / WIDTH, window.innerHeight / HEIGHT)));
  if (game.scale.zoom !== z) game.scale.setZoom(z);
};
window.addEventListener('resize', fit);
game.events.once(Phaser.Core.Events.READY, () => {
  fit();
  const inp = initInput(game.canvas);
  inp.toGame = (cx, cy) => {
    const r = game.canvas.getBoundingClientRect();
    return [((cx - r.left) / r.width) * WIDTH, ((cy - r.top) / r.height) * HEIGHT];
  };
  const unlock = () => audio.unlock();
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
});

declare global {
  interface Window {
    __game?: Phaser.Game;
  }
}
window.__game = game;
