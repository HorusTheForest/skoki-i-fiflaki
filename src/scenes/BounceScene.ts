// Odbicie (prototype): trampoline next to the pool. Runs BounceSim at a fixed
// 120 Hz with an accumulator, draws the diver with the tower game's sprites
// and the hall from Arena, and keeps the HUD on its own unzoomed camera.

import Phaser from 'phaser';
import { HEIGHT, WIDTH } from '../config';
import { input } from '../core/input';
import { getSave } from '../core/save';
import { audio } from '../audio/engine';
import { music } from '../audio/music';
import { Arena, type ArenaKind } from '../render/arena';
import { DiverView, FRONT, lerpState, toScreen } from '../render/diverView';
import { FONT } from '../render/font';
import { C, col, type ColorIndex } from '../render/palette';
import { panel, shadowTxt, txt } from '../ui/text';
import { DT, IN, type RenderState } from '../physics/diver';
import { BED_Y, BounceSim, CLEAN_DEG, GOOD_DEG, MAX_H, PERFECT_DEG, STAND_Y, TRAMP_X, type BounceEvent, type Grade } from '../bounce/sim';
import { trickName } from '../bounce/score';

const BEST_KEY = 'skoki-odbicie-best';
const TRAMP_HALF = 1.6;

const GRADE_TEXT: Record<Grade, [string, ColorIndex]> = {
  PERFECT: ['PERFECT!', C.gold],
  GOOD: ['DOBRZE', C.lime],
  SLOPPY: ['NIECZYSTO', C.orange],
  BAIL: ['UPADEK!', C.red],
};

const HELP = [
  '←/→ PRZY ODBICIU: OBRÓT · AKCJA: KUCZKA (+↓ ŁAMANA) · ↑: ŚRUBA',
  'AKCJA TUŻ PRZED LĄDOWANIEM: WBICIE · ↓ PRZY ODBICIU: SKOK DO BASENU',
];

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

type Stage = 'intro' | 'live' | 'over';

export class BounceScene extends Phaser.Scene {
  private sim!: BounceSim;
  private arena!: Arena;
  private view!: DiverView;
  private prev!: RenderState;
  private curr!: RenderState;
  private acc = 0;
  private hitstop = 0;
  private stage: Stage = 'intro';
  private seen = 0;
  private best = 0;
  private camX = TRAMP_X - 4;
  private camY = 4;
  private uiCam!: Phaser.Cameras.Scene2D.Camera;
  private world!: Phaser.GameObjects.Graphics;
  private hud!: Phaser.GameObjects.Graphics;
  private timeTxt!: ReturnType<typeof shadowTxt>;
  private scoreTxt!: ReturnType<typeof shadowTxt>;
  private bestTxt!: ReturnType<typeof shadowTxt>;
  private comboTxt!: ReturnType<typeof shadowTxt>;
  private trickTxt!: ReturnType<typeof shadowTxt>;
  private bigShadow!: Phaser.GameObjects.BitmapText;
  private bigText!: Phaser.GameObjects.BitmapText;
  private trickTimer = 0;
  private bigTimer = 0;
  private overObjs: Phaser.GameObjects.GameObject[] = [];
  private introObjs: Phaser.GameObjects.GameObject[] = [];

  constructor() {
    super('Bounce');
  }

  create(): void {
    this.sim = new BounceSim();
    this.stage = 'intro';
    this.acc = 0;
    this.hitstop = 0;
    this.seen = 0;
    this.best = loadBest();
    this.overObjs = [];
    this.introObjs = [];
    document.body.style.background = '#000000';
    const cam = this.cameras.main;
    cam.setViewport(0, 0, WIDTH, HEIGHT);
    cam.setBackgroundColor(col(C.black));
    cam.setRoundPixels(true);
    const save = getSave();
    this.arena = new Arena(this, (save.arena as ArenaKind) ?? 'day', { activeHeight: 10 });
    this.arena.setBoard('', '', '');
    this.drawTrampolineStatic();
    this.world = this.add.graphics().setDepth(48);
    this.view = new DiverView(this, { outfit: save.outfit, hair: C.darkBrown, skin: 0 }, 50, FRONT, { underDepth: 75 });
    this.prev = this.sim.snapshot();
    this.curr = this.sim.snapshot();

    this.hud = this.add.graphics().setDepth(200).setScrollFactor(0);
    this.timeTxt = shadowTxt(this, 12, 10, '', C.white);
    this.scoreTxt = shadowTxt(this, WIDTH / 2, 10, '', C.white, 'center');
    this.bestTxt = shadowTxt(this, WIDTH - 12, 10, '', C.lightGrey, 'right');
    this.comboTxt = shadowTxt(this, WIDTH / 2, 26, '', C.gold, 'center');
    this.trickTxt = shadowTxt(this, WIDTH / 2, 70, '', C.white, 'center');
    for (const t of [this.timeTxt, this.scoreTxt, this.bestTxt, this.comboTxt, this.trickTxt]) t.setDepth(210);
    this.bigShadow = this.add.bitmapText(WIDTH / 2 + 2, 92, FONT, '', 24).setOrigin(0.5, 0).setScrollFactor(0).setDepth(210).setTint(col(C.black));
    this.bigText = this.add.bitmapText(WIDTH / 2, 90, FONT, '', 24).setOrigin(0.5, 0).setScrollFactor(0).setDepth(211);
    txt(this, 17, 36 + Math.round(HEIGHT * 0.45), 'WYS.', C.paleBlue, 'center').setDepth(210);
    HELP.forEach((h, i) => shadowTxt(this, WIDTH / 2, HEIGHT - 26 + i * 11, h, C.paleBlue, 'center').setDepth(210));
    this.showIntro();

    this.uiCam = this.cameras.add(0, 0, WIDTH, HEIGHT);
    this.uiCam.setRoundPixels(true);
    this.syncCameras();
    this.placeCamera(0, true);
    input().clearLatches();
    audio.arena(true);
    audio.hush();
    music.play('arena');
    music.duck(0.5, 0.1);
  }

  relayout(): void {
    this.scene.restart();
  }

  /** screen-space objects render only on the UI camera, the world only on the main one */
  private syncCameras(): void {
    if (!this.uiCam) return;
    const main = this.cameras.main;
    for (const o of this.children.list) {
      const sf = (o as unknown as { scrollFactorX?: number }).scrollFactorX;
      if (sf === 0) main.ignore(o);
      else this.uiCam.ignore(o);
    }
  }

  private showIntro(): void {
    const w = 300;
    const x = Math.round(WIDTH / 2 - w / 2);
    const y = Math.round(HEIGHT / 2 - 110);
    this.introObjs.push(panel(this, x, y, w, 64).setDepth(220));
    this.introObjs.push(txt(this, WIDTH / 2, y + 12, 'ODBICIE · PROTOTYP', C.gold, 'center').setDepth(221));
    this.introObjs.push(txt(this, WIDTH / 2, y + 28, 'Kombo zabierasz skokiem do basenu', C.white, 'center').setDepth(221));
    this.introObjs.push(txt(this, WIDTH / 2, y + 44, 'AKCJA: START', C.paleYellow, 'center').setDepth(221));
  }

  private showOver(score: number, lost: number): void {
    const record = score > this.best;
    if (record) {
      this.best = score;
      saveBest(score);
    }
    const w = 300;
    const x = Math.round(WIDTH / 2 - w / 2);
    const y = Math.round(HEIGHT / 2 - 50);
    this.overObjs.push(panel(this, x, y, w, 92).setDepth(220));
    this.overObjs.push(txt(this, WIDTH / 2, y + 12, 'KONIEC CZASU', C.gold, 'center').setDepth(221));
    this.overObjs.push(txt(this, WIDTH / 2, y + 30, `WYNIK ${fmt(score)}`, C.white, 'center').setDepth(221));
    this.overObjs.push(
      txt(this, WIDTH / 2, y + 44, record ? 'NOWY REKORD!' : `REKORD ${fmt(this.best)}`, record ? C.lime : C.lightGrey, 'center').setDepth(221),
    );
    if (lost > 0) this.overObjs.push(txt(this, WIDTH / 2, y + 58, `PRZEPADŁO ${fmt(lost)} (NIEZABRANE KOMBO)`, C.salmon, 'center').setDepth(221));
    this.overObjs.push(txt(this, WIDTH / 2, y + 74, 'AKCJA: JESZCZE RAZ · ESC: MENU', C.paleYellow, 'center').setDepth(221));
    this.syncCameras();
    if (record) music.fanfare();
  }

  override update(_t: number, deltaMs: number): void {
    const inp = input();
    inp.poll();
    const dt = Math.min(deltaMs, 50) / 1000;
    const menu = inp.menuPressed();
    if (menu) audio.unlock();
    if (menu & 32) {
      audio.play('back');
      this.scene.start('Menu');
      return;
    }
    if (this.stage === 'intro' && menu & IN.ACTION) {
      for (const o of this.introObjs) o.destroy();
      this.introObjs = [];
      this.stage = 'live';
      inp.clearLatches();
      audio.play('select');
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
    this.arena.update(dt * (this.hitstop > 0 ? 0.15 : 1), true);
    const alpha = this.stage === 'live' ? Math.min(1, this.acc / DT) : 1;
    this.view.waterY = this.arena.water.heightAt(this.curr.x);
    this.view.update(lerpState(this.prev, this.curr, alpha));
    this.drawWorld(alpha);
    this.updateHud(dt);
    this.placeCamera(dt, false);
  }

  private handleEvents(): void {
    const s = this.sim;
    for (; this.seen < s.events.length; this.seen++) this.onEvent(s.events[this.seen]!);
  }

  private onEvent(e: BounceEvent): void {
    switch (e.type) {
      case 'launch':
        audio.play('jump', 0.7, 0.8 + e.height * 0.06);
        break;
      case 'tuck':
      case 'pike':
        audio.play('tuck', 0.6);
        break;
      case 'open':
        audio.play('open', 0.6);
        break;
      case 'twist':
        audio.play('twist', 0.5);
        break;
      case 'land': {
        const [label, c] = GRADE_TEXT[e.grade];
        const trick = e.points > 0 ? `${trickName(e.trick)} +${fmt(e.points)}` : '';
        this.flashTrick(trick, C.white);
        this.flashBig(label, c);
        if (e.grade === 'PERFECT') {
          // pitch climbs with the size of the combo
          audio.play('perfect', 0.6, 1 + Math.min(0.8, this.sim.combo.seen.size * 0.1));
          this.hitstop = 0.05;
          this.arena.cheer(0.4 + this.sim.combo.seen.size * 0.1);
        } else audio.play(e.grade === 'GOOD' ? 'good' : 'miss', 0.5);
        break;
      }
      case 'bail':
        this.flashBig('UPADEK!', C.red);
        this.flashTrick(e.lost > 0 ? `KOMBO PRZEPADŁO −${fmt(e.lost)}` : e.reason.toUpperCase(), C.salmon);
        audio.play('crash');
        audio.roar(0.4, true);
        this.cameras.main.shake(220, 0.01);
        break;
      case 'entry': {
        const w = this.arena.water;
        const big = e.grade === 'FLAT' || e.grade === 'SPLASH';
        w.splash(e.x, e.grade === 'RIP' ? 0.05 : e.grade === 'CLEAN' ? 0.3 : big ? 0.9 : 0.5, e.speed);
        if (e.grade === 'FLAT') {
          this.flashBig('PŁASKACZ!', C.red);
          this.flashTrick(e.lost > 0 ? `KOMBO PRZEPADŁO −${fmt(e.lost)}` : 'BEZ PUNKTÓW', C.salmon);
          audio.play('bigSplash');
          audio.roar(0.5, true);
          this.cameras.main.shake(260, 0.015);
        } else {
          const label = e.grade === 'RIP' ? 'RIP! ×2' : e.grade === 'CLEAN' ? 'CZYSTO' : 'ROZPRYSK ×½';
          this.flashBig(label, e.grade === 'RIP' ? C.gold : e.grade === 'CLEAN' ? C.lime : C.orange);
          this.flashTrick(`${trickName(e.trick)} · ZABRANE +${fmt(e.banked)}`, C.paleYellow);
          audio.play(e.grade === 'RIP' ? 'rip' : 'splash');
          if (e.grade === 'RIP') this.hitstop = 0.1;
          audio.roar(e.banked > 3000 ? 1 : 0.6);
          this.arena.cheer(1);
        }
        break;
      }
      case 'respawn':
        this.prev = this.curr;
        break;
      case 'over':
        this.stage = 'over';
        audio.play('whistle');
        this.showOver(e.score, e.lost);
        break;
      case 'stick':
        break;
    }
  }

  private flashBig(s: string, c: ColorIndex): void {
    this.bigText.setText(s).setTint(col(c));
    this.bigShadow.setText(s);
    this.bigTimer = 0.8;
  }

  private flashTrick(s: string, c: ColorIndex): void {
    this.trickTxt.set(s);
    this.trickTxt.main.setTint(col(c));
    this.trickTimer = 1.4;
  }

  private updateHud(dt: number): void {
    const s = this.sim;
    this.timeTxt.set(`CZAS ${Math.ceil(s.timeLeft)}`);
    this.timeTxt.main.setTint(col(s.timeLeft < 10 ? C.red : C.white));
    this.scoreTxt.set(`WYNIK ${fmt(s.score)}`);
    this.bestTxt.set(`REKORD ${fmt(Math.max(this.best, s.score))}`);
    this.comboTxt.set(s.combo.empty ? '' : `KOMBO ${fmt(s.combo.sum)} ×${s.combo.mult.toFixed(1)}`);
    this.trickTimer = Math.max(0, this.trickTimer - dt);
    this.bigTimer = Math.max(0, this.bigTimer - dt);
    this.trickTxt.setVisible(this.trickTimer > 0);
    this.bigText.setVisible(this.bigTimer > 0);
    this.bigShadow.setVisible(this.bigTimer > 0);
    // height meter: how high the next bounce goes
    const g = this.hud;
    g.clear();
    const x = 14;
    const top = 32;
    const h = Math.round(HEIGHT * 0.45);
    g.fillStyle(col(C.black));
    g.fillRect(x - 1, top - 1, 8, h + 2);
    g.fillStyle(col(C.navy));
    g.fillRect(x, top, 6, h);
    const f = Math.min(1, s.height / MAX_H);
    g.fillStyle(col(f > 0.75 ? C.gold : C.cyan));
    g.fillRect(x, top + h - Math.round(h * f), 6, Math.round(h * f));
  }

  // ------------------------------------------------------------------ world

  private drawTrampolineStatic(): void {
    const g = this.add.graphics().setDepth(47);
    const [x0, yb] = toScreen(FRONT, TRAMP_X - TRAMP_HALF, BED_Y);
    const [x1, yg] = toScreen(FRONT, TRAMP_X + TRAMP_HALF, 0);
    const L = Math.round(x0);
    const R = Math.round(x1);
    const B = Math.round(yb);
    const G = Math.round(yg);
    // legs
    g.fillStyle(col(C.slate));
    for (const lx of [L + 4, R - 7]) g.fillRect(lx, B, 3, G - B);
    g.fillRect(L + 4, G - 6, R - L - 8, 2);
    // frame with padding
    g.fillStyle(col(C.blue));
    g.fillRect(L - 4, B - 2, 10, 5);
    g.fillRect(R - 6, B - 2, 10, 5);
    g.fillStyle(col(C.sky));
    g.fillRect(L - 4, B - 2, 10, 1);
    g.fillRect(R - 6, B - 2, 10, 1);
  }

  private drawWorld(alpha: number): void {
    const g = this.world;
    g.clear();
    const s = this.sim;
    // bed: sags under the diver while in contact
    const [x0, yb] = toScreen(FRONT, TRAMP_X - TRAMP_HALF + 0.2, BED_Y);
    const [x1] = toScreen(FRONT, TRAMP_X + TRAMP_HALF - 0.2, BED_Y);
    const st = lerpState(this.prev, this.curr, alpha);
    const near = Math.abs(st.x - TRAMP_X) < TRAMP_HALF;
    const sag = near && (s.phase === 'bed' || (s.phase === 'stun' && st.y < STAND_Y)) ? Math.max(0, (STAND_Y - st.y) * 32) : 0;
    const [cx] = toScreen(FRONT, st.x, 0);
    for (let x = Math.round(x0); x <= Math.round(x1); x++) {
      const u = 1 - Math.min(1, Math.abs(x - cx) / ((x1 - x0) / 2));
      const y = Math.round(yb + sag * u);
      g.fillStyle(col(C.black));
      g.fillRect(x, y, 1, 2);
      // springs to the frame every 6 px
      if ((x - Math.round(x0)) % 6 === 0) {
        g.fillStyle(col(C.lightGrey));
        g.fillRect(x, Math.min(y, Math.round(yb)), 1, Math.abs(y - Math.round(yb)) + 1);
      }
    }
    // landing line: where the body will point at contact if it opens now
    if (s.phase === 'air' && s.L !== 0) {
      const err = s.predictError();
      const a = Math.abs(err);
      const c = a <= PERFECT_DEG ? C.lime : a <= (s.bank ? CLEAN_DEG + 8 : GOOD_DEG) ? C.gold : C.red;
      const [px, py] = toScreen(FRONT, st.x, st.y);
      const r = 30;
      const ang = (err * Math.PI) / 180;
      g.lineStyle(1, col(C.white), 0.35);
      g.lineBetween(Math.round(px), Math.round(py - r), Math.round(px), Math.round(py + r));
      g.lineStyle(2, col(c), 0.9);
      g.lineBetween(Math.round(px - Math.sin(ang) * r), Math.round(py + Math.cos(ang) * r), Math.round(px + Math.sin(ang) * r), Math.round(py - Math.cos(ang) * r));
    }
  }

  private placeCamera(dt: number, snap: boolean): void {
    const cam = this.cameras.main;
    const zu = Math.max(1, Math.round(HEIGHT / 360));
    const st = this.curr;
    const viewH = HEIGHT / zu / 32;
    // keep the trampoline on screen, follow the diver up and into the pool
    const tx = this.sim.bank || this.sim.phase === 'water' ? st.x - 2 : TRAMP_X - 4;
    const ty = Math.max(viewH / 2 - 1.5, st.y - 1);
    if (snap) {
      this.camX = tx;
      this.camY = ty;
    } else {
      const k = 1 - Math.exp(-dt * 6);
      this.camX += (tx - this.camX) * k;
      this.camY += (ty - this.camY) * k;
    }
    cam.setZoom(zu);
    const [px, py] = toScreen(FRONT, this.camX, this.camY);
    cam.centerOn(Math.round(px), Math.round(py));
  }
}

function fmt(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
