// Nieskończona wieża (prototype): the synchro pair falls down an endless
// tower in the diving hall. Runs FallSim at a fixed 120 Hz with an
// accumulator. The stands and the tower are drawn as repeating patterns from
// the camera position, so the hall has no top; the pool waits at the bottom.

import Phaser from 'phaser';
import { HEIGHT, PPM, WIDTH } from '../config';
import { input } from '../core/input';
import { audio } from '../audio/engine';
import { music } from '../audio/music';
import { DiverView, FRONT, lerpState, toScreen } from '../render/diverView';
import { FONT } from '../render/font';
import { C, col, light, mix, shade, type ColorIndex } from '../render/palette';
import { vGradient } from '../render/fx';
import { ensureCrowdTexture } from '../render/sprites';
import { panel, shadowTxt, txt } from '../ui/text';
import { DT, IN, type RenderState } from '../physics/diver';
import { WaterSurface } from '../physics/water';
import { FallSim, LIVES, type FallEvent } from '../fall/sim';
import { DRONE_R, droneX, PLATFORM_LEN, type GateFor } from '../fall/gen';

const BEST_KEY = 'skoki-wieza-best';
const HELP = '←/→ STERUJ · ↑ ZMIEŃ SKOCZKA · ↓ NURKUJ · AKCJA: HAMUJ · NA DOLE: ↓ I PROSTO';
/** tower column behind the lane, and the pool around it */
const TOWER_X0 = -4;
const POOL_PAD = 6;
const STAND_PLANE = 0.55;
const TIER_H = 18;
const DIVER_COL: [ColorIndex, ColorIndex] = [C.red, C.sky];
const DIVER_NAME = ['CZERWONY', 'NIEBIESKI'];

function gateColor(who: GateFor): ColorIndex {
  return who === -1 ? C.gold : DIVER_COL[who];
}

function loadBest(): number {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

function saveBest(v: number): void {
  try {
    localStorage.setItem(BEST_KEY, String(v));
  } catch {
    // the record is a convenience
  }
}

function fmt(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** one tier of the stands (crowd and step) as a tile, two frames for cheering */
function ensureStandTiles(scene: Phaser.Scene): void {
  if (scene.textures.exists('stand-tier-a')) return;
  ensureCrowdTexture(scene, 'crowd-wieza', 7, false);
  const src = scene.textures.get('crowd-wieza').getSourceImage() as HTMLCanvasElement;
  for (const [f, sy] of [['a', 0], ['b', 16]] as const) {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = TIER_H;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = `#${col(C.grey).toString(16).padStart(6, '0')}`;
    ctx.fillRect(0, 0, 128, TIER_H);
    ctx.drawImage(src, 0, sy, 128, 16, 0, 0, 128, 16);
    ctx.fillStyle = `#${light(C.lightGrey, 0.3).toString(16).padStart(6, '0')}`;
    ctx.fillRect(0, 16, 128, 1);
    ctx.fillStyle = `#${shade(C.grey, 0.3).toString(16).padStart(6, '0')}`;
    ctx.fillRect(0, 17, 128, 1);
    scene.textures.addCanvas(`stand-tier-${f}`, c);
  }
}

type Stage = 'intro' | 'live' | 'over';

export class FallScene extends Phaser.Scene {
  private sim!: FallSim;
  private views!: [DiverView, DiverView];
  private prev!: [RenderState, RenderState];
  private curr!: [RenderState, RenderState];
  private water!: WaterSurface;
  private acc = 0;
  private hitstop = 0;
  private stage: Stage = 'intro';
  private seen = 0;
  private best = 0;
  private camX = 0;
  private camY = 0;
  private clock = 0;
  private uiCam!: Phaser.Cameras.Scene2D.Camera;
  /** screen-fixed layers drawn by the main camera behind the world */
  private backdrop: Phaser.GameObjects.GameObject[] = [];
  private stands!: Phaser.GameObjects.TileSprite;
  private standOverlay!: Phaser.GameObjects.Graphics;
  private towerG!: Phaser.GameObjects.Graphics;
  private platformG!: Phaser.GameObjects.Graphics;
  private front!: Phaser.GameObjects.Graphics;
  private waterG!: Phaser.GameObjects.Graphics;
  private hud!: Phaser.GameObjects.Graphics;
  private heightLabels: Phaser.GameObjects.BitmapText[] = [];
  private scoreTxt!: ReturnType<typeof shadowTxt>;
  private potTxt!: ReturnType<typeof shadowTxt>;
  private levelTxt!: ReturnType<typeof shadowTxt>;
  private activeTxt!: ReturnType<typeof shadowTxt>;
  private popTxt!: ReturnType<typeof shadowTxt>;
  private bigShadow!: Phaser.GameObjects.BitmapText;
  private bigText!: Phaser.GameObjects.BitmapText;
  private popTimer = 0;
  private bigTimer = 0;
  private cheer = 0;
  private gateState = new Map<number, boolean>();
  private panelObjs: Phaser.GameObjects.GameObject[] = [];

  constructor() {
    super('Fall');
  }

  create(): void {
    this.sim = new FallSim();
    this.stage = 'intro';
    this.acc = 0;
    this.hitstop = 0;
    this.seen = 0;
    this.clock = 0;
    this.cheer = 0;
    this.best = loadBest();
    this.gateState = new Map();
    this.panelObjs = [];
    this.backdrop = [];
    this.heightLabels = [];
    document.body.style.background = '#000000';
    const cam = this.cameras.main;
    cam.setViewport(0, 0, WIDTH, HEIGHT);
    cam.setBackgroundColor(col(C.paleBlue));
    cam.setRoundPixels(true);

    // stands without a top: one tier tile repeated, scrolled with parallax
    ensureStandTiles(this);
    this.stands = this.add.tileSprite(0, 0, WIDTH, HEIGHT, 'stand-tier-a').setOrigin(0, 0).setScrollFactor(0).setDepth(1);
    this.standOverlay = this.add.graphics().setScrollFactor(0).setDepth(2);
    this.backdrop.push(this.stands, this.standOverlay);
    this.towerG = this.add.graphics().setDepth(30);
    this.platformG = this.add.graphics().setDepth(35);
    this.front = this.add.graphics().setDepth(45);
    this.waterG = this.add.graphics().setDepth(60);
    for (let i = 0; i < 4; i++) this.heightLabels.push(this.add.bitmapText(0, 0, FONT, '', 8).setDepth(31).setTint(col(C.slate)));
    const w = this.sim.level.width;
    this.water = new WaterSurface(TOWER_X0 - POOL_PAD, w + POOL_PAD, 1 / PPM, 5);
    this.views = [
      new DiverView(this, { outfit: 0, hair: C.darkBrown, skin: 0 }, 50, FRONT, { underDepth: 65 }),
      new DiverView(this, { outfit: 1, hair: C.brown, skin: 1 }, 49, FRONT, { underDepth: 64 }),
    ];
    this.prev = [this.sim.snapshot(0), this.sim.snapshot(1)];
    this.curr = [this.sim.snapshot(0), this.sim.snapshot(1)];

    this.hud = this.add.graphics().setDepth(200).setScrollFactor(0);
    this.scoreTxt = shadowTxt(this, WIDTH / 2, 10, '', C.white, 'center');
    this.potTxt = shadowTxt(this, WIDTH / 2, 24, '', C.gold, 'center');
    this.levelTxt = shadowTxt(this, WIDTH - 12, 10, '', C.white, 'right');
    this.activeTxt = shadowTxt(this, WIDTH - 12, 24, '', C.white, 'right');
    this.popTxt = shadowTxt(this, WIDTH / 2, 64, '', C.white, 'center');
    for (const t of [this.scoreTxt, this.potTxt, this.levelTxt, this.activeTxt, this.popTxt]) t.setDepth(210);
    this.bigShadow = this.add.bitmapText(WIDTH / 2 + 2, 82, FONT, '', 24).setOrigin(0.5, 0).setScrollFactor(0).setDepth(210).setTint(col(C.black));
    this.bigText = this.add.bitmapText(WIDTH / 2, 80, FONT, '', 24).setOrigin(0.5, 0).setScrollFactor(0).setDepth(211);
    shadowTxt(this, WIDTH / 2, HEIGHT - 14, HELP, C.white, 'center').setDepth(210);
    this.showPanel(
      ['NIESKOŃCZONA WIEŻA · PROTOTYP', 'Złote bramki zalicza każdy skoczek,', 'czerwone i niebieskie tylko ten w tym kolorze.', '↑ przełącza skoczka. Na dole obaj muszą wejść prosto.', 'AKCJA: SKOK'],
      [C.gold, C.white, C.white, C.white, C.paleYellow],
    );

    this.uiCam = this.cameras.add(0, 0, WIDTH, HEIGHT);
    this.uiCam.setRoundPixels(true);
    this.syncCameras();
    this.placeCamera(0, true);
    input().clearLatches();
    audio.arena(true);
    audio.hush();
    music.play('arena');
    music.duck(0.6, 0.1);
  }

  relayout(): void {
    this.scene.restart();
  }

  /** screen-space objects render only on the UI camera, the world only on the main one */
  private syncCameras(): void {
    if (!this.uiCam) return;
    const main = this.cameras.main;
    for (const o of this.children.list) {
      if (this.backdrop.includes(o)) {
        this.uiCam.ignore(o);
        continue;
      }
      const sf = (o as unknown as { scrollFactorX?: number }).scrollFactorX;
      if (sf === 0) main.ignore(o);
      else this.uiCam.ignore(o);
    }
  }

  private showPanel(lines: string[], colors: ColorIndex[]): void {
    for (const o of this.panelObjs) o.destroy();
    this.panelObjs = [];
    if (lines.length === 0) return;
    const w = 400;
    const h = 22 + lines.length * 15;
    const x = Math.round(WIDTH / 2 - w / 2);
    const y = Math.round(HEIGHT / 2 + 20);
    this.panelObjs.push(panel(this, x, y, w, h).setDepth(220));
    lines.forEach((s, i) => this.panelObjs.push(txt(this, WIDTH / 2, y + 12 + i * 15, s, colors[i] ?? C.white, 'center').setDepth(221)));
    this.syncCameras();
  }

  override update(_t: number, deltaMs: number): void {
    const inp = input();
    inp.poll();
    const dt = Math.min(deltaMs, 50) / 1000;
    this.clock += dt;
    const menu = inp.menuPressed();
    if (menu) audio.unlock();
    if (menu & 32) {
      audio.play('back');
      this.scene.start('Menu');
      return;
    }
    if (this.stage === 'intro' && menu & IN.ACTION) {
      // the press that closes the panel is also the jump
      this.showPanel([], []);
      this.stage = 'live';
      inp.clearLatches();
      this.sim.step(IN.ACTION);
      this.handleEvents();
    } else if (this.stage === 'over' && menu & IN.ACTION) {
      audio.play('select');
      this.scene.restart();
      return;
    }
    if (this.stage === 'live') {
      if (this.hitstop > 0) this.hitstop -= dt;
      else {
        this.acc += dt;
        let guard = 0;
        while (this.acc >= DT && guard++ < 12 && this.stage === 'live') {
          this.prev = this.curr;
          this.sim.step(inp.simMask());
          this.curr = [this.sim.snapshot(0), this.sim.snapshot(1)];
          this.handleEvents();
          this.acc -= DT;
        }
      }
    }
    this.water.step(dt);
    this.cheer = Math.max(0, this.cheer - dt * 0.5);
    const alpha = this.stage === 'live' ? Math.min(1, this.acc / DT) : 1;
    this.placeCamera(dt, false);
    for (const i of [0, 1] as const) {
      const st = lerpState(this.prev[i], this.curr[i], alpha);
      this.views[i].waterY = this.water.heightAt(st.x);
      this.views[i].update(st);
    }
    this.drawBackdrop();
    this.drawTower();
    this.drawObjects(alpha);
    this.drawWater();
    this.updateHud(dt);
  }

  private handleEvents(): void {
    const s = this.sim;
    for (; this.seen < s.events.length; this.seen++) this.onEvent(s.events[this.seen]!);
  }

  private onEvent(e: FallEvent): void {
    switch (e.type) {
      case 'jump':
        audio.play('jump');
        break;
      case 'switch':
        audio.play('menu', 0.6, e.active === 0 ? 1 : 1.25);
        break;
      case 'gate':
        this.gateState.set(this.gateIndexAbove(), true);
        this.pop(`BRAMKA ×${e.combo} +${fmt(e.points)}`, e.who === -1 ? C.lime : DIVER_COL[e.who]);
        audio.play('good', 0.5, 1 + Math.min(1, e.combo * 0.08));
        this.cheer = Math.min(1, this.cheer + 0.2);
        break;
      case 'gateMiss':
        this.gateState.set(this.gateIndexAbove(), false);
        this.pop(e.who === -1 ? 'BRAMKA OMINIĘTA' : `BRAMKA DLA: ${DIVER_NAME[e.who]}`, C.lightGrey);
        audio.play('miss', 0.3);
        break;
      case 'near':
        this.pop(`BLISKO! +${fmt(e.points)}`, C.gold);
        audio.play('twist', 0.6, 1.3);
        break;
      case 'hit':
        this.big('AU!', C.red);
        if (e.lost > 0) this.pop(`−${fmt(e.lost)}`, C.salmon);
        audio.play('crash');
        audio.roar(0.3, true);
        this.cameras.main.shake(200, 0.012);
        this.hitstop = 0.06;
        break;
      case 'entry': {
        const size = e.grade === 'RIP' ? 0.05 : e.grade === 'CLEAN' ? 0.35 : 1;
        for (const x of e.xs) this.water.splash(x, size, e.speed);
        if (e.grade === 'RIP') {
          this.big('SYNCHRO RIP! ×2', C.gold);
          audio.play('rip');
          music.fanfare();
          audio.roar(1);
          this.hitstop = 0.1;
        } else if (e.grade === 'CLEAN') {
          this.big('CZYSTO', C.lime);
          audio.play('splash');
          audio.roar(0.6);
        } else {
          this.big('PŁASKACZ!', C.red);
          audio.play('bigSplash');
          audio.roar(0.4, true);
          this.cameras.main.shake(260, 0.015);
        }
        this.cheer = 1;
        this.pop(`ZABRANE +${fmt(e.banked)}`, C.paleYellow);
        break;
      }
      case 'level':
        this.gateState.clear();
        this.prev = this.curr;
        this.big(`WIEŻA ${e.n}`, C.white);
        this.pop('AKCJA: SKOK', C.paleYellow);
        this.popTimer = 3;
        audio.play('star');
        break;
      case 'over': {
        this.stage = 'over';
        audio.play('whistle');
        const record = e.score > this.best;
        if (record) {
          this.best = e.score;
          saveBest(e.score);
          music.fanfare();
        }
        this.showPanel(
          ['KONIEC', `WYNIK ${fmt(e.score)} · WIEŻA ${e.level}`, record ? 'NOWY REKORD!' : `REKORD ${fmt(this.best)}`, 'AKCJA: JESZCZE RAZ · ESC: MENU'],
          [C.gold, C.white, record ? C.lime : C.lightGrey, C.paleYellow],
        );
        break;
      }
    }
  }

  /** index of the gate the pair just crossed */
  private gateIndexAbove(): number {
    const g = this.sim.level.gates;
    let i = 0;
    while (i < g.length && g[i]!.y >= this.sim.y) i++;
    return i - 1;
  }

  private pop(s: string, c: ColorIndex): void {
    this.popTxt.set(s);
    this.popTxt.main.setTint(col(c));
    this.popTimer = 1.0;
  }

  private big(s: string, c: ColorIndex): void {
    this.bigText.setText(s).setTint(col(c));
    this.bigShadow.setText(s);
    this.bigTimer = 0.8;
  }

  private updateHud(dt: number): void {
    const s = this.sim;
    this.scoreTxt.set(`WYNIK ${fmt(s.score)}   REKORD ${fmt(Math.max(this.best, s.score))}`);
    this.potTxt.set(s.phase === 'fall' ? `W TYM SKOKU ${fmt(s.pot)}${s.combo > 1 ? `  · SERIA BRAMEK ×${s.combo}` : ''}` : '');
    this.levelTxt.set(`WIEŻA ${s.level.n}`);
    this.activeTxt.set(`STERUJESZ: ${DIVER_NAME[s.active]}`);
    this.activeTxt.main.setTint(col(DIVER_COL[s.active]));
    this.popTimer = Math.max(0, this.popTimer - dt);
    this.bigTimer = Math.max(0, this.bigTimer - dt);
    this.popTxt.setVisible(this.popTimer > 0);
    this.bigText.setVisible(this.bigTimer > 0);
    this.bigShadow.setVisible(this.bigTimer > 0);
    const g = this.hud;
    g.clear();
    for (let i = 0; i < LIVES; i++) {
      g.fillStyle(col(C.black));
      g.fillRect(11 + i * 14, 9, 11, 10);
      g.fillStyle(col(i < s.lives ? C.red : C.grey));
      g.fillRect(12 + i * 14, 10, 9, 8);
      g.fillStyle(col(i < s.lives ? C.salmon : C.lightGrey));
      g.fillRect(13 + i * 14, 11, 3, 2);
    }
    // how far to the water
    const top = 30;
    const h = HEIGHT - 70;
    g.fillStyle(col(C.black));
    g.fillRect(13, top - 1, 8, h + 2);
    g.fillStyle(col(C.slate));
    g.fillRect(14, top, 6, h);
    g.fillStyle(col(C.cyan));
    g.fillRect(14, top + h - 4, 6, 4);
    g.fillStyle(col(C.white));
    g.fillRect(12, top + Math.round(s.progress * (h - 4)), 10, 2);
    if (s.phase === 'fall' && s.pose === 'dive') {
      g.fillStyle(col(C.white), 0.35);
      for (let i = 0; i < 14; i++) {
        const x = (i * 97 + Math.floor(this.clock * 7) * 31) % WIDTH;
        const y = (i * 53 + Math.floor(this.clock * 900)) % HEIGHT;
        g.fillRect(x, HEIGHT - y, 1, 18);
      }
    }
  }

  // ------------------------------------------------------------------ world

  private view(): { y0: number; y1: number; x0: number; x1: number } {
    const v = this.cameras.main.worldView;
    return { x0: v.x / PPM, x1: (v.x + v.width) / PPM, y1: -v.y / PPM, y0: -(v.y + v.height) / PPM };
  }

  /** the stands, scrolled slower than the world: they never end */
  private drawBackdrop(): void {
    const cam = this.cameras.main;
    const frame = this.cheer > 0.3 ? Math.floor(this.clock * 6) % 2 : Math.floor(this.clock * 1.6) % 2;
    this.stands.setTexture(frame ? 'stand-tier-b' : 'stand-tier-a');
    this.stands.tilePositionY = Math.round(cam.scrollY * STAND_PLANE);
    this.stands.tilePositionX = Math.round(cam.scrollX * STAND_PLANE);
    const g = this.standOverlay;
    g.clear();
    // aisles: stairs through the stands every few metres
    const ox = Math.round(cam.scrollX * STAND_PLANE);
    const oy = Math.round(cam.scrollY * STAND_PLANE);
    for (let x = -((ox % 220) + 220) % 220; x < WIDTH; x += 220) {
      g.fillStyle(col(C.lightGrey));
      g.fillRect(x, 0, 14, HEIGHT);
      g.fillStyle(col(C.grey));
      for (let y = -(((oy % 6) + 6) % 6); y < HEIGHT; y += 6) g.fillRect(x, y, 14, 1);
    }
    // a thin haze keeps the divers readable over the crowd
    g.fillStyle(col(C.paleBlue), 0.3);
    g.fillRect(0, 0, WIDTH, HEIGHT);
    // the pool hall floor near the bottom
    const [, floorY] = toScreen(FRONT, 0, 0);
    const fy = Math.round(floorY - cam.scrollY);
    if (fy < HEIGHT) {
      g.fillStyle(col(C.lightGrey));
      g.fillRect(0, Math.max(0, fy - 40), WIDTH, HEIGHT);
    }
  }

  private drawTower(): void {
    const g = this.towerG;
    g.clear();
    const { y0, y1 } = this.view();
    // the lane itself is darker than the stands, so the pair and the course read at a glance
    const ly0 = Math.round(-y1 * PPM);
    const ly1 = Math.round(-Math.max(0, y0) * PPM);
    if (ly1 > ly0) {
      g.fillStyle(col(C.navy), 0.6);
      g.fillRect(0, ly0, Math.round(this.sim.level.width * PPM), ly1 - ly0);
    }
    const top = Math.min(y1, this.sim.level.depth + 6);
    const x0 = Math.round(TOWER_X0 * PPM);
    const x1 = 0;
    const py0 = Math.round(-top * PPM);
    const py1 = Math.round(-Math.max(0, y0) * PPM);
    if (py1 > py0) {
      const bands = 8;
      for (let i = 0; i < bands; i++) {
        g.fillStyle(mix(shade(C.lightGrey, 0.25), col(C.white), i / (bands - 1)));
        g.fillRect(x0 + Math.round(((x1 - x0) * i) / bands), py0, Math.ceil((x1 - x0) / bands), py1 - py0);
      }
      g.fillStyle(col(C.grey));
      g.fillRect(x1 - 4, py0, 4, py1 - py0);
      // panel joints every metre, small platforms every five
      g.fillStyle(shade(C.lightGrey, 0.15));
      for (let y = Math.ceil(Math.max(0, y0)); y <= top; y++) g.fillRect(x0, Math.round(-y * PPM), x1 - x0 - 4, 2);
    }
    let li = 0;
    for (let h = Math.ceil(Math.max(0, y0) / 5) * 5; h <= top && h < this.sim.level.depth - 2; h += 5) {
      if (h === 0) continue;
      const y = Math.round(-h * PPM);
      g.fillStyle(col(C.grey));
      g.fillRect(x0 + 8, y, x1 - x0 - 8, 8);
      g.fillStyle(col(C.gold));
      g.fillRect(x1 - 6, y, 6, 8);
      const lbl = this.heightLabels[li++];
      if (lbl) lbl.setText(`${h} M`).setPosition(x0 + 10, y + 10).setVisible(true);
    }
    for (; li < this.heightLabels.length; li++) this.heightLabels[li]!.setVisible(false);

    // start platform: behind the divers, they jump off it towards the camera
    const p = this.platformG;
    p.clear();
    const d = this.sim.level.depth;
    if (d > y0 - 1 && d < y1 + 2) {
      const [ax, ay] = toScreen(FRONT, TOWER_X0, d);
      const [bx] = toScreen(FRONT, PLATFORM_LEN, d);
      const th = Math.round(0.35 * PPM);
      p.fillStyle(col(C.lightGrey));
      p.fillRect(Math.round(ax), Math.round(ay), Math.round(bx - ax), th);
      p.fillStyle(col(C.white));
      p.fillRect(Math.round(ax), Math.round(ay), Math.round(bx - ax), 2);
      p.fillStyle(col(C.gold));
      p.fillRect(Math.round(bx) - 4, Math.round(ay), 4, th);
      p.fillStyle(col(C.grey));
      p.fillRect(Math.round(ax) + 6, Math.round(ay) - 28, 2, 28);
      p.fillRect(Math.round(ax) + 6, Math.round(ay) - 28, 26, 2);
    }
  }

  private drawObjects(alpha: number): void {
    const g = this.front;
    g.clear();
    const s = this.sim;
    const l = s.level;
    const { y0, y1 } = this.view();
    // glass in front of the stands: the right edge of the lane
    const [gx] = toScreen(FRONT, l.width, 0);
    const gtop = Math.round(-Math.min(y1, l.depth + 6) * PPM);
    const gbot = Math.round(-Math.max(0, y0) * PPM);
    if (gbot > gtop) {
      g.fillStyle(col(C.white), 0.35);
      g.fillRect(Math.round(gx), gtop, 4, gbot - gtop);
      g.fillStyle(col(C.slate));
      for (let y = Math.ceil(Math.max(0, y0) / 3) * 3; y <= Math.min(y1, l.depth + 6); y += 3) g.fillRect(Math.round(gx), Math.round(-y * PPM), 6, 2);
    }
    for (const e of l.ledges) {
      if (e.y1 < y0 - 1 || e.y0 > y1 + 1) continue;
      const [ax, ay] = toScreen(FRONT, e.x0, e.y1);
      const [bx, by] = toScreen(FRONT, e.x1, e.y0);
      const X = Math.round(ax);
      const Y = Math.round(ay);
      const W = Math.round(bx - ax);
      const H = Math.round(by - ay);
      if (e.side < 0) {
        // a tower platform with a gold edge
        g.fillStyle(col(C.lightGrey));
        g.fillRect(X, Y, W, H);
        g.fillStyle(col(C.white));
        g.fillRect(X, Y, W, 2);
        g.fillStyle(col(C.grey));
        g.fillRect(X, Y + H - 3, W, 3);
        g.fillStyle(col(C.gold));
        g.fillRect(X + W - 5, Y, 5, H);
      } else {
        // a lighting truss: yellow lattice
        g.fillStyle(col(C.orange));
        g.fillRect(X, Y, W, 2);
        g.fillRect(X, Y + H - 2, W, 2);
        for (let x = X; x < X + W; x += 8) {
          for (let k = 0; k < H; k += 2) g.fillRect(x + Math.round((k / H) * 8), Y + k, 2, 2);
        }
        g.fillStyle(col(C.paleYellow));
        for (let x = X + 6; x < X + W - 6; x += 24) g.fillRect(x, Y + H, 6, 3);
      }
    }
    l.gates.forEach((gt, i) => {
      if (gt.y < y0 - 1 || gt.y > y1 + 1) return;
      const state = this.gateState.get(i);
      const c = state === true ? C.lime : state === false ? C.grey : gateColor(gt.who);
      const [ax, ay] = toScreen(FRONT, gt.x - gt.gap / 2, gt.y);
      const [bx] = toScreen(FRONT, gt.x + gt.gap / 2, gt.y);
      const y = Math.round(ay);
      const l0 = Math.round(ax);
      const l1 = Math.round(bx);
      g.fillStyle(col(c), 0.22);
      g.fillRect(l0, y - 5, l1 - l0, 10);
      g.fillStyle(col(C.black));
      g.fillRect(l0 - 4, y - 11, 8, 22);
      g.fillRect(l1 - 4, y - 11, 8, 22);
      g.fillStyle(col(c));
      g.fillRect(l0 - 3, y - 10, 6, 20);
      g.fillRect(l1 - 3, y - 10, 6, 20);
      for (let x = l0 + 5; x < l1 - 5; x += 6) g.fillRect(x, y - 1, 3, 2);
    });
    for (const b of l.drones) {
      if (b.y < y0 - 1 || b.y > y1 + 1) continue;
      const [x, y] = toScreen(FRONT, droneX(b, s.levelT), b.y);
      const cx = Math.round(x);
      const cy = Math.round(y);
      const r = Math.round(DRONE_R * PPM);
      const spin = Math.floor(this.clock * 20) % 2;
      g.fillStyle(col(C.charcoal));
      g.fillRect(cx - 4, cy - 2, 8, 5);
      g.fillRect(cx - r, cy - 3, 2 * r, 1);
      g.fillStyle(col(C.lightGrey));
      g.fillRect(cx - r - (spin ? 2 : 0), cy - 5, 6, 1);
      g.fillRect(cx + r - 4 - (spin ? 0 : 2), cy - 5, 6, 1);
      g.fillStyle(col(Math.floor(this.clock * 3) % 2 ? C.red : C.darkRed));
      g.fillRect(cx - 1, cy + 3, 2, 2);
    }
    // marker over the steered diver's feet
    if (s.phase === 'fall' || s.phase === 'stand') {
      const st = lerpState(this.prev[s.active], this.curr[s.active], alpha);
      const up = s.phase === 'stand' ? 1.5 : 1.45;
      const [mx, my] = toScreen(FRONT, st.x, st.y + (s.phase === 'stand' ? up : 1.2));
      const X = Math.round(mx);
      const Y = Math.round(my) - 8;
      const c = DIVER_COL[s.active];
      g.fillStyle(col(C.black));
      g.fillRect(X - 5, Y - 1, 11, 3);
      g.fillRect(X - 4, Y + 2, 9, 2);
      g.fillRect(X - 2, Y + 4, 5, 3);
      g.fillStyle(col(c));
      g.fillRect(X - 4, Y, 9, 1);
      g.fillRect(X - 3, Y + 1, 7, 2);
      g.fillRect(X - 1, Y + 3, 3, 2);
    }
  }

  private drawWater(): void {
    const g = this.waterG;
    g.clear();
    const { y0 } = this.view();
    if (y0 > 2) return;
    const w = this.water;
    for (let i = 0; i < w.cols; i++) {
      const x = Math.round((w.x0 + i * w.dx) * PPM);
      const top = Math.round(-w.h[i]! * PPM);
      g.fillStyle(col(C.cyan));
      g.fillRect(x, top, 1, 6 * PPM);
      g.fillStyle(col(C.foam));
      g.fillRect(x, top, 1, 2);
    }
    vGradient(g, w.x0 * PPM, 12, (w.cols * w.dx) * PPM, 5 * PPM, col(C.cyan), col(C.deepWater), 8);
    // lane ropes
    for (let x = w.x0 + 0.5; x < w.x0 + w.cols * w.dx; x += 0.25) {
      const k = Math.round((x - w.x0) * 4);
      g.fillStyle(col(k % 6 < 3 ? C.red : C.white));
      g.fillRect(Math.round(x * PPM), Math.round(-w.heightAt(x) * PPM) + 6, 5, 3);
    }
    for (const p of w.drops) {
      g.fillStyle(col(p.tone === 0 ? C.white : C.foam));
      g.fillRect(Math.round(p.x * PPM), Math.round(-p.y * PPM), 2, 2);
    }
  }

  private placeCamera(dt: number, snap: boolean): void {
    const cam = this.cameras.main;
    const zu = Math.max(1, Math.round(HEIGHT / 360));
    const viewH = HEIGHT / zu / PPM;
    const s = this.sim;
    // the lane stays centred; the pair sits in the upper third so the course ahead shows
    const tx = s.level.width / 2 - 1;
    const ty = s.phase === 'stand' ? s.y - 2 : Math.max(viewH / 2 - 2.5, s.y - viewH * 0.22);
    if (snap || s.phase === 'stand') {
      this.camX = tx;
      this.camY = snap ? ty : this.camY + (ty - this.camY) * (1 - Math.exp(-dt * 6));
    } else {
      this.camX += (tx - this.camX) * (1 - Math.exp(-dt * 4));
      this.camY = s.phase === 'fall' ? Math.min(this.camY, ty) : this.camY + (ty - this.camY) * (1 - Math.exp(-dt * 8));
    }
    cam.setZoom(zu);
    const [px, py] = toScreen(FRONT, this.camX, this.camY);
    cam.centerOn(Math.round(px), Math.round(py));
  }
}
