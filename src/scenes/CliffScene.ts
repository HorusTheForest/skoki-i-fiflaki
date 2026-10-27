// Klif (prototype): the canyon fall. Runs CliffSim at a fixed 120 Hz with an
// accumulator, draws the canyon rows that are on screen each frame, the diver
// with the tower game's sprites, and the HUD on its own unzoomed camera.

import Phaser from 'phaser';
import { HEIGHT, PPM, WIDTH } from '../config';
import { input } from '../core/input';
import { getSave } from '../core/save';
import { audio } from '../audio/engine';
import { music } from '../audio/music';
import { DiverView, FRONT, lerpState, toScreen } from '../render/diverView';
import { FONT } from '../render/font';
import { C, col, light, mix, shade, type ColorIndex } from '../render/palette';
import { vGradient } from '../render/fx';
import { panel, shadowTxt, txt } from '../ui/text';
import { DT, IN, type RenderState } from '../physics/diver';
import { WaterSurface } from '../physics/water';
import { CliffSim, LIVES, type CliffEvent } from '../cliff/sim';
import { BIRD_R, birdX, walls } from '../cliff/gen';

const BEST_KEY = 'skoki-klif-best';
const HELP = '←/→ STERUJ · ↓ NURKUJ (×2 PKT) · AKCJA: HAMUJ · DO WODY: ↓ I PROSTO';
const WATER_X0 = -30;
const WATER_X1 = 30;

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

type Stage = 'intro' | 'live' | 'over';

export class CliffScene extends Phaser.Scene {
  private sim!: CliffSim;
  private view!: DiverView;
  private prev!: RenderState;
  private curr!: RenderState;
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
  private sky!: Phaser.GameObjects.Graphics;
  private rock!: Phaser.GameObjects.Graphics;
  private front!: Phaser.GameObjects.Graphics;
  private waterG!: Phaser.GameObjects.Graphics;
  private hud!: Phaser.GameObjects.Graphics;
  private scoreTxt!: ReturnType<typeof shadowTxt>;
  private potTxt!: ReturnType<typeof shadowTxt>;
  private levelTxt!: ReturnType<typeof shadowTxt>;
  private popTxt!: ReturnType<typeof shadowTxt>;
  private bigShadow!: Phaser.GameObjects.BitmapText;
  private bigText!: Phaser.GameObjects.BitmapText;
  private popTimer = 0;
  private bigTimer = 0;
  private gateState = new Map<number, boolean>();
  private panelObjs: Phaser.GameObjects.GameObject[] = [];

  constructor() {
    super('Cliff');
  }

  create(): void {
    this.sim = new CliffSim();
    this.stage = 'intro';
    this.acc = 0;
    this.hitstop = 0;
    this.seen = 0;
    this.clock = 0;
    this.best = loadBest();
    this.gateState = new Map();
    this.panelObjs = [];
    document.body.style.background = '#000000';
    const cam = this.cameras.main;
    cam.setViewport(0, 0, WIDTH, HEIGHT);
    cam.setBackgroundColor(col(C.sky));
    cam.setRoundPixels(true);

    // sky: fixed to the screen behind everything
    const sky = this.add.graphics().setScrollFactor(0).setDepth(0);
    this.sky = sky;
    vGradient(sky, 0, 0, WIDTH, HEIGHT, col(C.sky), light(C.paleYellow, 0.3), 12);
    this.rock = this.add.graphics().setDepth(20);
    this.waterG = this.add.graphics().setDepth(60);
    this.front = this.add.graphics().setDepth(45);
    this.water = new WaterSurface(WATER_X0, WATER_X1, 1 / PPM, 5);
    this.view = new DiverView(this, { outfit: getSave().outfit, hair: C.darkBrown, skin: 0 }, 50, FRONT, { underDepth: 65 });
    this.prev = this.sim.snapshot();
    this.curr = this.sim.snapshot();

    this.hud = this.add.graphics().setDepth(200).setScrollFactor(0);
    this.scoreTxt = shadowTxt(this, WIDTH / 2, 10, '', C.white, 'center');
    this.potTxt = shadowTxt(this, WIDTH / 2, 24, '', C.gold, 'center');
    this.levelTxt = shadowTxt(this, WIDTH - 12, 10, '', C.white, 'right');
    this.popTxt = shadowTxt(this, WIDTH / 2, 64, '', C.white, 'center');
    for (const t of [this.scoreTxt, this.potTxt, this.levelTxt, this.popTxt]) t.setDepth(210);
    this.bigShadow = this.add.bitmapText(WIDTH / 2 + 2, 82, FONT, '', 24).setOrigin(0.5, 0).setScrollFactor(0).setDepth(210).setTint(col(C.black));
    this.bigText = this.add.bitmapText(WIDTH / 2, 80, FONT, '', 24).setOrigin(0.5, 0).setScrollFactor(0).setDepth(211);
    shadowTxt(this, WIDTH / 2, HEIGHT - 14, HELP, C.white, 'center').setDepth(210);
    this.showPanel(['KLIF · PROTOTYP', 'Leć przez bramki, omijaj skały i ptaki.', 'Punkty zabierasz czystym wejściem do wody.', 'AKCJA: SKOK'], [C.gold, C.white, C.white, C.paleYellow]);

    this.uiCam = this.cameras.add(0, 0, WIDTH, HEIGHT);
    this.uiCam.setRoundPixels(true);
    this.syncCameras();
    this.placeCamera(0, true);
    input().clearLatches();
    audio.arena(false);
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
      // the sky is fixed to the screen but drawn behind the world
      if (o === this.sky) {
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
    const w = 330;
    const h = 22 + lines.length * 15;
    const x = Math.round(WIDTH / 2 - w / 2);
    const y = Math.round(HEIGHT / 2 + 10);
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
      for (const o of this.panelObjs) o.destroy();
      this.panelObjs = [];
      this.stage = 'live';
      inp.clearLatches();
      audio.play('jump');
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
          this.curr = this.sim.snapshot();
          this.handleEvents();
          this.acc -= DT;
        }
      }
    }
    this.water.step(dt);
    const alpha = this.stage === 'live' ? Math.min(1, this.acc / DT) : 1;
    const st = lerpState(this.prev, this.curr, alpha);
    this.placeCamera(dt, false);
    this.view.waterY = this.water.heightAt(st.x);
    this.view.update(st);
    this.drawCanyon();
    this.drawObjects();
    this.drawWater();
    this.updateHud(dt);
  }

  private handleEvents(): void {
    const s = this.sim;
    for (; this.seen < s.events.length; this.seen++) this.onEvent(s.events[this.seen]!);
  }

  private onEvent(e: CliffEvent): void {
    switch (e.type) {
      case 'gate':
        this.gateState.set(this.gateIndexAbove(), true);
        this.pop(`BRAMKA ×${e.combo} +${fmt(e.points)}`, C.lime);
        audio.play('good', 0.5, 1 + Math.min(1, e.combo * 0.08));
        break;
      case 'gateMiss':
        this.gateState.set(this.gateIndexAbove(), false);
        this.pop('BRAMKA OMINIĘTA', C.lightGrey);
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
        this.cameras.main.shake(200, 0.012);
        this.hitstop = 0.06;
        break;
      case 'entry': {
        const size = e.grade === 'RIP' ? 0.05 : e.grade === 'CLEAN' ? 0.35 : 1;
        this.water.splash(e.x, size, e.speed);
        if (e.grade === 'RIP') {
          this.big('RIP! ×2', C.gold);
          audio.play('rip');
          this.hitstop = 0.1;
        } else if (e.grade === 'CLEAN') {
          this.big('CZYSTO', C.lime);
          audio.play('splash');
        } else {
          this.big('PŁASKACZ!', C.red);
          audio.play('bigSplash');
          this.cameras.main.shake(260, 0.015);
        }
        this.pop(`ZABRANE +${fmt(e.banked)}`, C.paleYellow);
        break;
      }
      case 'level':
        this.gateState.clear();
        this.prev = this.curr;
        this.big(`KLIF ${e.n}`, C.white);
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
          ['KONIEC', `WYNIK ${fmt(e.score)} · KLIF ${e.level}`, record ? 'NOWY REKORD!' : `REKORD ${fmt(this.best)}`, 'AKCJA: JESZCZE RAZ · ESC: MENU'],
          [C.gold, C.white, record ? C.lime : C.lightGrey, C.paleYellow],
        );
        break;
      }
    }
  }

  /** index of the gate the diver just crossed */
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
    this.levelTxt.set(`KLIF ${s.level.n}`);
    this.popTimer = Math.max(0, this.popTimer - dt);
    this.bigTimer = Math.max(0, this.bigTimer - dt);
    this.popTxt.setVisible(this.popTimer > 0);
    this.bigText.setVisible(this.bigTimer > 0);
    this.bigShadow.setVisible(this.bigTimer > 0);
    const g = this.hud;
    g.clear();
    // lives
    for (let i = 0; i < LIVES; i++) {
      g.fillStyle(col(C.black));
      g.fillRect(11 + i * 14, 9, 11, 10);
      g.fillStyle(col(i < s.lives ? C.red : C.grey));
      g.fillRect(12 + i * 14, 10, 9, 8);
      g.fillStyle(col(i < s.lives ? C.salmon : C.lightGrey));
      g.fillRect(13 + i * 14, 11, 3, 2);
    }
    // depth: how far to the water
    const top = 30;
    const h = HEIGHT - 70;
    g.fillStyle(col(C.black));
    g.fillRect(13, top - 1, 8, h + 2);
    g.fillStyle(col(C.darkBrown));
    g.fillRect(14, top, 6, h);
    g.fillStyle(col(C.cyan));
    g.fillRect(14, top + h - 4, 6, 4);
    g.fillStyle(col(C.white));
    g.fillRect(12, top + Math.round(s.progress * (h - 4)), 10, 2);
    // speed streaks while diving
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

  private view0(): { y0: number; y1: number; x0: number; x1: number } {
    const cam = this.cameras.main;
    const v = cam.worldView;
    return { x0: v.x / PPM, x1: (v.x + v.width) / PPM, y1: -v.y / PPM, y0: -(v.y + v.height) / PPM };
  }

  private drawCanyon(): void {
    const g = this.rock;
    g.clear();
    const l = this.sim.level;
    const { y0, y1, x0, x1 } = this.view0();
    const left = Math.floor(x0 * PPM) - 2;
    const right = Math.ceil(x1 * PPM) + 2;
    const rowH = 2;
    const top = Math.floor(-y1 * PPM / rowH) * rowH;
    const bottom = Math.ceil(-y0 * PPM);
    for (let py = top; py <= bottom; py += rowH) {
      const y = -py / PPM;
      if (y < -0.5) break;
      if (y > l.depth + 0.5) continue;
      const [L, R] = walls(l, y);
      // rock strata: bands every few metres, lighter on the lit edge
      const band = Math.floor(y / 2.5) % 3;
      const base: ColorIndex = band === 0 ? C.brown : band === 1 ? C.orange : C.darkBrown;
      const lx = Math.round(L * PPM);
      const rx = Math.round(R * PPM);
      g.fillStyle(band === 1 ? mix(col(C.orange), col(C.brown), 0.45) : col(base));
      g.fillRect(left, py, lx - left, rowH);
      g.fillRect(rx, py, right - rx, rowH);
      g.fillStyle(light(C.orange, 0.35));
      g.fillRect(lx - 3, py, 3, rowH);
      g.fillStyle(shade(C.darkBrown, 0.3));
      g.fillRect(rx, py, 3, rowH);
    }
    // the top of the cliff: a flat lip with the start
    const [tl, tr] = walls(l, l.depth);
    const [, ty] = toScreen(FRONT, 0, l.depth);
    g.fillStyle(col(C.darkGreen));
    g.fillRect(left, Math.round(ty) - 4, Math.round(tl * PPM) - left, 4);
    g.fillRect(Math.round(tr * PPM), Math.round(ty) - 4, right - Math.round(tr * PPM), 4);
    // ledges
    for (const e of l.ledges) {
      if (e.y1 < y0 - 1 || e.y0 > y1 + 1) continue;
      const [ax, ay] = toScreen(FRONT, e.x0, e.y1);
      const [bx, by] = toScreen(FRONT, e.x1, e.y0);
      g.fillStyle(col(C.darkBrown));
      g.fillRect(Math.round(ax), Math.round(ay), Math.round(bx - ax), Math.round(by - ay));
      g.fillStyle(col(C.brown));
      g.fillRect(Math.round(ax), Math.round(ay), Math.round(bx - ax), 3);
      g.fillStyle(col(C.green));
      g.fillRect(Math.round(ax), Math.round(ay) - 1, Math.round(bx - ax), 1);
    }
  }

  private drawObjects(): void {
    const g = this.front;
    g.clear();
    const l = this.sim.level;
    const { y0, y1 } = this.view0();
    l.gates.forEach((gt, i) => {
      if (gt.y < y0 - 1 || gt.y > y1 + 1) return;
      const state = this.gateState.get(i);
      const c = state === true ? C.lime : state === false ? C.grey : C.gold;
      const [ax, ay] = toScreen(FRONT, gt.x - gt.gap / 2, gt.y);
      const [bx] = toScreen(FRONT, gt.x + gt.gap / 2, gt.y);
      const y = Math.round(ay);
      g.fillStyle(col(C.black));
      g.fillRect(Math.round(ax) - 3, y - 7, 6, 14);
      g.fillRect(Math.round(bx) - 3, y - 7, 6, 14);
      g.fillStyle(col(c));
      g.fillRect(Math.round(ax) - 2, y - 6, 4, 12);
      g.fillRect(Math.round(bx) - 2, y - 6, 4, 12);
      g.fillStyle(col(c), 0.6);
      for (let x = Math.round(ax) + 4; x < Math.round(bx) - 3; x += 4) g.fillRect(x, y, 2, 1);
    });
    for (const b of l.birds) {
      if (b.y < y0 - 1 || b.y > y1 + 1) continue;
      const [x, y] = toScreen(FRONT, birdX(b, this.sim.levelT), b.y);
      const flap = Math.floor(this.clock * 8) % 2 === 0 ? -4 : 2;
      const r = Math.round(BIRD_R * PPM);
      const cx = Math.round(x);
      const cy = Math.round(y);
      g.fillStyle(col(C.charcoal));
      g.fillRect(cx - 3, cy - 2, 6, 4);
      g.fillRect(cx - r, cy + flap, r - 2, 2);
      g.fillRect(cx + 2, cy + flap, r - 2, 2);
      g.fillStyle(col(C.orange));
      g.fillRect(cx + 3, cy - 1, 2, 1);
    }
  }

  private drawWater(): void {
    const g = this.waterG;
    g.clear();
    const { y0 } = this.view0();
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
    vGradient(g, WATER_X0 * PPM, 12, (WATER_X1 - WATER_X0) * PPM, 5 * PPM, col(C.cyan), col(C.deepWater), 8);
    for (const p of w.drops) {
      g.fillStyle(col(p.tone === 0 ? C.white : C.foam));
      g.fillRect(Math.round(p.x * PPM), Math.round(-p.y * PPM), 2, 2);
    }
  }

  private placeCamera(dt: number, snap: boolean): void {
    const cam = this.cameras.main;
    const zu = Math.max(1, Math.round(HEIGHT / 360));
    const viewH = HEIGHT / zu / PPM;
    const st = this.curr;
    // the diver sits in the upper third: the canyon ahead is what matters
    const tx = st.x * 0.5;
    const ty = Math.max(viewH / 2 - 2.5, st.y - viewH * 0.22);
    if (snap) {
      this.camX = tx;
      this.camY = ty;
    } else {
      const k = 1 - Math.exp(-dt * 8);
      this.camX += (tx - this.camX) * k;
      this.camY += (ty - this.camY) * (this.sim.phase === 'fall' ? 1 : k);
    }
    cam.setZoom(zu);
    const [px, py] = toScreen(FRONT, this.camX, this.camY);
    cam.centerOn(Math.round(px), Math.round(py));
  }
}
