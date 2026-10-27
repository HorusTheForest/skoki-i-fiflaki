import Phaser from 'phaser';
import { HEIGHT, WIDTH, setViewSize, viewFor } from './config';
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

const first = viewFor(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
setViewSize(first.w, first.h);

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: WIDTH,
  height: HEIGHT,
  pixelArt: true,
  roundPixels: true,
  antialias: false,
  // lets screen capture tools read the canvas
  preserveDrawingBuffer: true,
  // menus colour the page behind their centred panel
  transparent: true,
  scale: {
    mode: Phaser.Scale.NONE,
    zoom: first.k / (window.devicePixelRatio || 1),
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  input: { keyboard: false, mouse: true, touch: true, gamepad: false },
  audio: { noAudio: true },
  fps: { target: 60 },
  scene: [BootScene, MenuScene, DiveScene, ResultsScene, LevelsScene, SettingsScene, LockerScene],
});

// The buffer follows the window (see viewFor): a whole number of *device*
// pixels per game pixel, so pixels stay square and sharp also with Windows
// display scaling (125%, 150%...), where a whole CSS zoom would not be.
let resizeTimer = 0;
const fit = () => {
  const dpr = window.devicePixelRatio || 1;
  const v = viewFor(window.innerWidth, window.innerHeight, dpr);
  const sizeChanged = v.w !== WIDTH || v.h !== HEIGHT;
  if (sizeChanged) {
    setViewSize(v.w, v.h);
    game.scale.resize(v.w, v.h);
  }
  if (game.scale.zoom !== v.k / dpr) game.scale.setZoom(v.k / dpr);
  if (!sizeChanged) return;
  // lay the screens out again for the new size
  for (const sc of game.scene.getScenes(true)) {
    const re = (sc as Phaser.Scene & { relayout?: () => void }).relayout;
    if (re) re.call(sc);
    else if (sc.scene.key !== 'Boot') sc.scene.restart(sc.sys.settings.data);
  }
};
const onResize = () => {
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(fit, 150);
};
window.addEventListener('resize', onResize);
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
