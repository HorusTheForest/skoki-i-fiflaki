// The diving hall: background wall, stands with a 2-frame crowd, flags, LED
// scoreboard, the tower with its 1/3/5/7.5/10 m platforms and the pool with
// spring-mesh water. Three variants: day hall, night hall, outdoor pool.

import Phaser from 'phaser';
import { PPM, SHOW_RINGS } from '../config';
import { WaterSurface } from '../physics/water';
import { TOWER } from '../physics/diver';
import { C, col, type ColorIndex } from './palette';
import { FONT } from './font';
import { ensureCrowdTexture, ensureRingsTexture } from './sprites';
import { COUNTRIES } from '../levels/countries';
import { toScreen, type Plane } from './diverView';

export type ArenaKind = 'day' | 'night' | 'outdoor';
export const ARENAS: { id: ArenaKind; name: string }[] = [
  { id: 'day', name: 'Hala dzienna' },
  { id: 'night', name: 'Hala nocna' },
  { id: 'outdoor', name: 'Basen plenerowy' },
];

export const POOL = { x0: -4, x1: 24, depth: 5 } as const;
export const PLATFORMS = [1, 3, 5, 7.5, 10] as const;

interface Theme {
  wall: ColorIndex;
  wallDark: ColorIndex;
  accent: ColorIndex;
  concrete: ColorIndex;
  concreteDark: ColorIndex;
  concreteLight: ColorIndex;
  water: ColorIndex;
  waterDeep: ColorIndex;
  waterLight: ColorIndex;
  foam: ColorIndex;
  deck: ColorIndex;
  stands: ColorIndex;
  night: boolean;
}

const THEMES: Record<ArenaKind, Theme> = {
  day: {
    wall: C.paleBlue,
    wallDark: C.lightGrey,
    accent: C.sky,
    concrete: C.lightGrey,
    concreteDark: C.grey,
    concreteLight: C.white,
    water: C.cyan,
    waterDeep: C.teal,
    waterLight: C.foam,
    foam: C.white,
    deck: C.lightGrey,
    stands: C.grey,
    night: false,
  },
  night: {
    wall: C.navy,
    wallDark: C.black,
    accent: C.violet,
    concrete: C.slate,
    concreteDark: C.charcoal,
    concreteLight: C.grey,
    water: C.teal,
    waterDeep: C.deepWater,
    waterLight: C.cyan,
    foam: C.foam,
    deck: C.slate,
    stands: C.charcoal,
    night: true,
  },
  outdoor: {
    wall: C.sky,
    wallDark: C.paleBlue,
    accent: C.white,
    concrete: C.paleYellow,
    concreteDark: C.orange,
    concreteLight: C.white,
    water: C.cyan,
    waterDeep: C.blue,
    waterLight: C.foam,
    foam: C.white,
    deck: C.paleYellow,
    stands: C.brown,
    night: false,
  },
};

const BG_PLANE = 0.35;
const STAND_PLANE = 0.55;
/** camera scroll for which back layers line up with the world (centred on the pool) */
const REF_SCROLL_X = 4 * PPM - 160;
const REF_SCROLL_Y = -90;
const layerOffset = (f: number): [number, number] => [-REF_SCROLL_X * (1 - f), -REF_SCROLL_Y * (1 - f)];

export class Arena {
  readonly kind: ArenaKind;
  readonly theme: Theme;
  readonly water: WaterSurface;
  readonly backWater: WaterSurface | null;
  private readonly scene: Phaser.Scene;
  private readonly waterG: Phaser.GameObjects.Graphics;
  private readonly backWaterG: Phaser.GameObjects.Graphics | null;
  private readonly crowds: Phaser.GameObjects.TileSprite[] = [];
  private readonly board: Phaser.GameObjects.BitmapText[] = [];
  private crowdFrame = 0;
  private crowdTimer = 0;
  private excitement = 0;
  private time = 0;
  readonly backPlane: Plane | null;

  constructor(scene: Phaser.Scene, kind: ArenaKind, opts: { backPlane?: Plane; activeHeight: number }) {
    this.scene = scene;
    this.kind = kind;
    this.theme = THEMES[kind];
    this.backPlane = opts.backPlane ?? null;
    this.water = new WaterSurface(POOL.x0, POOL.x1, 1 / PPM, 7);
    this.backWater = this.backPlane ? new WaterSurface(POOL.x0, POOL.x1, 1 / (PPM * this.backPlane.s), 11) : null;
    this.drawBackground();
    this.drawStands();
    if (this.backPlane) this.drawBackPlatform(this.backPlane, opts.activeHeight);
    this.drawTower(opts.activeHeight);
    this.backWaterG = this.backPlane ? scene.add.graphics().setDepth(45).setScrollFactor(this.backPlane.s) : null;
    this.waterG = scene.add.graphics().setDepth(60);
    this.drawPoolStatic();
  }

  // -- static layers -------------------------------------------------------

  private bgRect(g: Phaser.GameObjects.Graphics, plane: number, c: ColorIndex, x: number, y: number, w: number, h: number) {
    void plane;
    g.fillStyle(col(c));
    g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }

  private drawBackground(): void {
    const t = this.theme;
    const [ox, oy] = layerOffset(BG_PLANE);
    const g = this.scene.add.graphics().setDepth(0).setScrollFactor(BG_PLANE).setPosition(ox, oy);
    const W = 1000;
    const x0 = -400;
    if (this.kind === 'outdoor') {
      const bands: [ColorIndex, number][] = [
        [C.blue, -200],
        [C.sky, -120],
        [C.paleBlue, -40],
      ];
      for (const [c, y] of bands) this.bgRect(g, BG_PLANE, c, x0, y, W, 400);
      // sun and clouds
      g.fillStyle(col(C.paleYellow));
      g.fillCircle(240, -150, 10);
      g.fillStyle(col(C.white));
      for (const [cx, cy] of [
        [20, -130],
        [150, -100],
        [330, -160],
      ] as const) {
        g.fillRect(cx, cy, 30, 6);
        g.fillRect(cx + 6, cy - 4, 16, 4);
      }
      // hills
      g.fillStyle(col(C.green));
      for (let x = x0; x < x0 + W; x += 4) {
        const h = 18 + Math.round(10 * Math.sin(x * 0.02) + 6 * Math.sin(x * 0.051));
        g.fillRect(x, -30 - h, 4, h + 40);
      }
      g.fillStyle(col(C.darkGreen));
      for (let x = x0; x < x0 + W; x += 4) {
        const h = 8 + Math.round(6 * Math.sin(x * 0.033 + 1));
        g.fillRect(x, -22 - h, 4, h + 40);
      }
    } else {
      this.bgRect(g, BG_PLANE, t.wall, x0, -300, W, 400);
      // windows / light panels
      for (let x = x0; x < x0 + W; x += 40) {
        for (let y = -190; y < -60; y += 34) {
          this.bgRect(g, BG_PLANE, t.night ? C.charcoal : C.white, x + 6, y, 26, 22);
          this.bgRect(g, BG_PLANE, t.night ? C.navy : C.sky, x + 8, y + 2, 22, 18);
          if (t.night && (x / 40 + y / 34) % 3 === 0) this.bgRect(g, BG_PLANE, C.gold, x + 17, y + 9, 2, 2);
        }
      }
      // roof trusses
      g.fillStyle(col(t.wallDark));
      for (let x = x0; x < x0 + W; x += 8) g.fillRect(x, -220 + ((x / 8) % 2) * 4, 8, 3);
      g.fillRect(x0, -224, W, 3);
      if (t.night) {
        g.fillStyle(col(C.paleYellow));
        for (let x = x0 + 10; x < x0 + W; x += 60) g.fillRect(x, -214, 6, 3);
      }
    }
    if (SHOW_RINGS) {
      ensureRingsTexture(this.scene, 'rings-small', 5, this.theme.night ? C.white : C.black);
      this.scene.add.image(160 + ox, -200 + oy, 'rings-small').setScrollFactor(BG_PLANE).setDepth(1);
    }
  }

  private drawStands(): void {
    const t = this.theme;
    const [ox, oy] = layerOffset(STAND_PLANE);
    const g = this.scene.add.graphics().setDepth(5).setScrollFactor(STAND_PLANE);
    const left = 40 + ox;
    const right = 600 + ox;
    // tiers
    const rows = 6;
    const base = -14 + oy;
    ensureCrowdTexture(this.scene, `crowd-${this.kind}-a`, 3, t.night);
    ensureCrowdTexture(this.scene, `crowd-${this.kind}-b`, 17, t.night);
    for (let r = 0; r < rows; r++) {
      const y = base - r * 9;
      g.fillStyle(col(r % 2 ? t.stands : t.concreteDark));
      g.fillRect(left + r * 4, y, right - left, 9);
      const crowd = this.scene.add
        .tileSprite(left + r * 4, y - 7, right - left - r * 8, 8, `crowd-${this.kind}-${r % 2 ? 'a' : 'b'}`, 'a')
        .setOrigin(0, 0)
        .setScrollFactor(STAND_PLANE)
        .setDepth(6);
      crowd.tilePositionX = r * 13;
      this.crowds.push(crowd);
    }
    // railing and flags
    const flagY = base - rows * 9 - 18;
    g.fillStyle(col(t.concreteDark));
    g.fillRect(left, flagY + 10, right - left, 2);
    for (let i = 0; i < 26; i++) {
      const c = COUNTRIES[i % COUNTRIES.length]!;
      const x = left + 10 + i * 20;
      g.fillStyle(col(C.grey));
      g.fillRect(x, flagY - 2, 1, 12);
      this.scene.add.image(x + 1, flagY - 2, 'flags', c.code).setOrigin(0, 0).setScrollFactor(STAND_PLANE).setDepth(6);
    }
    // LED scoreboard
    const bx = 200 + ox;
    const by = flagY - 48;
    g.fillStyle(col(C.charcoal));
    g.fillRect(bx - 4, by - 4, 128, 44);
    g.fillStyle(col(C.black));
    g.fillRect(bx - 2, by - 2, 124, 40);
    for (let i = 0; i < 3; i++) {
      const txt = this.scene.add
        .bitmapText(bx + 2, by + 2 + i * 12, FONT, '', 8)
        .setScrollFactor(STAND_PLANE)
        .setDepth(7)
        .setTint(col(i === 0 ? C.gold : i === 1 ? C.orange : C.red));
      this.board.push(txt);
    }
    // LED dot grid overlay (every other pixel row dark)
    const grid = this.scene.add.graphics().setDepth(8).setScrollFactor(STAND_PLANE);
    grid.fillStyle(col(C.black));
    for (let y = by - 1; y < by + 38; y += 2) grid.fillRect(bx - 1, y, 122, 1);
    this.setBoard('', '', '');
  }

  setBoard(a: string, b: string, c: string): void {
    const lines = [a, b, c];
    this.board.forEach((t, i) => t.setText((lines[i] ?? '').slice(0, 15).toUpperCase()));
  }

  /** the partner's (deeper) part of the platform */
  private drawBackPlatform(p: Plane, h: number): void {
    const g = this.scene.add.graphics().setDepth(20).setScrollFactor(p.s);
    const t = this.theme;
    const [x0, y0] = toScreen(p, -TOWER.depth, h);
    const [x1] = toScreen(p, 0, h);
    g.fillStyle(col(t.concreteDark));
    g.fillRect(Math.round(x0), Math.round(y0), Math.round(x1 - x0), Math.round(TOWER.slab * PPM * p.s));
    g.fillStyle(col(t.concreteLight));
    g.fillRect(Math.round(x0), Math.round(y0), Math.round(x1 - x0), 1);
  }

  private drawTower(active: number): void {
    const t = this.theme;
    const g = this.scene.add.graphics().setDepth(30);
    const m = PPM;
    const colX0 = -TOWER.depth - 2.2;
    const colX1 = -TOWER.overhang;
    // column with shading
    g.fillStyle(col(t.concrete));
    g.fillRect(colX0 * m, -10.6 * m, (colX1 - colX0) * m, 10.6 * m);
    g.fillStyle(col(t.concreteDark));
    g.fillRect(colX1 * m - 3, -10.6 * m, 3, 10.6 * m);
    for (let y = 1; y < 10; y += 1) g.fillRect(colX0 * m, -y * m, (colX1 - colX0) * m - 3, 1);
    // ladder
    g.fillStyle(col(t.concreteDark));
    g.fillRect(colX0 * m + 6, -10 * m, 1, 10 * m);
    g.fillRect(colX0 * m + 12, -10 * m, 1, 10 * m);
    for (let y = 0; y < 10 * m; y += 4) g.fillRect(colX0 * m + 6, -y, 7, 1);
    // platforms
    for (const h of PLATFORMS) {
      const isActive = h === active;
      const y = -h * m;
      const x0 = colX1 * m - (isActive ? TOWER.depth - TOWER.overhang : 0.6) * m;
      const x1 = isActive ? 0 : (h === 10 ? 0 : -0.3 * (10 - h)) * m;
      const thick = Math.round(TOWER.slab * m);
      g.fillStyle(col(isActive ? t.concrete : t.concreteDark));
      g.fillRect(Math.round(x0), Math.round(y), Math.round(x1 - x0), thick);
      g.fillStyle(col(t.concreteLight));
      g.fillRect(Math.round(x0), Math.round(y), Math.round(x1 - x0), 1);
      g.fillStyle(col(C.slate));
      g.fillRect(Math.round(x0), Math.round(y) + thick - 1, Math.round(x1 - x0), 1);
      // edge marker (yellow stripe like real platforms)
      g.fillStyle(col(C.gold));
      g.fillRect(Math.round(x1) - 2, Math.round(y), 2, thick);
      // railing at the back
      g.fillStyle(col(C.grey));
      g.fillRect(Math.round(x0), Math.round(y) - 14, 1, 14);
      g.fillRect(Math.round(x0), Math.round(y) - 14, 12, 1);
      g.fillRect(Math.round(x0), Math.round(y) - 7, 12, 1);
      // height label
      const lbl = this.scene.add.bitmapText(Math.round(colX0 * m) + 16, Math.round(y) + 2, FONT, h === 7.5 ? '7½' : String(h), 8);
      lbl.setTint(col(t.night ? C.lightGrey : C.slate)).setDepth(31);
    }
  }

  private drawPoolStatic(): void {
    const t = this.theme;
    const g = this.scene.add.graphics().setDepth(70);
    const m = PPM;
    // deck on both sides of the pool
    g.fillStyle(col(t.deck));
    g.fillRect(-40 * m, 0, (POOL.x0 + 40) * m, 8 * m);
    g.fillRect(POOL.x1 * m, 0, 30 * m, 8 * m);
    g.fillStyle(col(C.white));
    for (let x = -40 * m; x < POOL.x0 * m; x += 8) g.fillRect(x, 0, 4, 1);
    for (let x = POOL.x1 * m; x < (POOL.x1 + 30) * m; x += 8) g.fillRect(x, 0, 4, 1);
    // pool bottom
    g.fillStyle(col(t.concreteDark));
    g.fillRect(POOL.x0 * m, POOL.depth * m, (POOL.x1 - POOL.x0) * m, 3 * m);
    g.fillStyle(col(C.deepBlue));
    g.fillRect(POOL.x0 * m, POOL.depth * m, (POOL.x1 - POOL.x0) * m, 2);
    for (let x = POOL.x0; x < POOL.x1; x += 2.5) g.fillRect(x * m, POOL.depth * m - 6, 2, 6);
  }

  // -- dynamic -------------------------------------------------------------

  cheer(level: number): void {
    this.excitement = Math.max(this.excitement, level);
  }

  update(dt: number, flashOk: boolean): void {
    this.time += dt;
    this.water.step(dt);
    this.backWater?.step(dt);
    // crowd: two frames, faster when excited
    this.excitement = Math.max(0, this.excitement - dt * 0.4);
    this.crowdTimer += dt;
    const period = this.excitement > 0.3 ? 0.18 : 0.6;
    if (this.crowdTimer >= period) {
      this.crowdTimer = 0;
      this.crowdFrame ^= 1;
      for (const c of this.crowds) c.setFrame(this.crowdFrame ? 'b' : 'a');
    }
    void flashOk;
    this.drawWater();
  }

  private drawWaterBody(
    g: Phaser.GameObjects.Graphics,
    w: WaterSurface,
    plane: Plane,
    bottomPx: number,
    shimmerSeed: number,
  ): void {
    const t = this.theme;
    g.clear();
    const m = PPM * plane.s;
    const step = w.dx * m;
    for (let i = 0; i < w.cols; i++) {
      const x = Math.round((w.x0 + i * w.dx) * m + plane.ox);
      const top = Math.round(-w.h[i]! * m + plane.oy);
      const h = Math.max(1, Math.round(bottomPx - top));
      g.fillStyle(col(t.water));
      g.fillRect(x, top, Math.ceil(step), h);
      // crest highlights and reflections
      const slope = (w.h[Math.min(w.cols - 1, i + 1)]! - w.h[Math.max(0, i - 1)]!) * m;
      const sh = Math.sin(this.time * 2.3 + i * 0.37 + shimmerSeed) + Math.sin(i * 1.7 + this.time * 0.9);
      g.fillStyle(col(slope < -0.4 || sh > 1.55 ? t.foam : t.waterLight));
      g.fillRect(x, top, Math.ceil(step), 1);
      if (sh > 1.2) {
        g.fillStyle(col(t.waterLight));
        g.fillRect(x, top + 2 + ((i * 7) % 3), Math.ceil(step), 1);
      }
    }
  }

  private drawWater(): void {
    const t = this.theme;
    const g = this.waterG;
    const m = PPM;
    const w = this.water;
    g.clear();
    // water body: light top band, dithered transitions, deep bottom
    const deepTop = 10;
    const darkTop = 44;
    const bottom = POOL.depth * m;
    for (let i = 0; i < w.cols; i++) {
      const x = Math.round((w.x0 + i * w.dx) * m);
      const top = Math.round(-w.h[i]! * m);
      const odd = i % 2;
      g.fillStyle(col(t.water));
      g.fillRect(x, top, 1, deepTop + odd * 2 - top);
      g.fillStyle(col(t.waterDeep));
      g.fillRect(x, deepTop + odd * 2, 1, darkTop + odd * 2 - deepTop - odd * 2);
      g.fillStyle(col(C.deepWater));
      g.fillRect(x, darkTop + odd * 2, 1, bottom - darkTop - odd * 2);
      const slope = (w.h[Math.min(w.cols - 1, i + 1)]! - w.h[Math.max(0, i - 1)]!) * m;
      const sh = Math.sin(this.time * 2.3 + i * 0.37) + Math.sin(i * 1.7 + this.time * 0.9);
      g.fillStyle(col(slope < -0.4 || sh > 1.55 ? t.foam : t.waterLight));
      g.fillRect(x, top, 1, 1);
      if (sh > 1.25) g.fillRect(x, top + 3 + ((i * 7) % 3), 1, 1);
      // caustics on the deep water
      if (Math.sin(i * 0.9 + this.time * 3) + Math.sin(i * 0.23 - this.time * 1.3) > 1.7) {
        g.fillStyle(col(t.water));
        g.fillRect(x, deepTop + 6 + ((i * 5) % 9), 1, 1);
      }
    }
    // lane rope floats
    for (let x = POOL.x0 + 0.5; x < POOL.x1; x += 0.25) {
      const k = Math.round((x - POOL.x0) * 4);
      g.fillStyle(col(k % 6 < 3 ? C.red : C.white));
      g.fillRect(Math.round(x * m), Math.round(-w.heightAt(x) * m) + 4, 2, 1);
    }
    // splash drops and bubbles
    for (const p of w.drops) {
      g.fillStyle(col(p.tone === 0 ? C.white : p.tone === 1 ? t.waterLight : t.water));
      g.fillRect(Math.round(p.x * m), Math.round(-p.y * m), 1, 1);
    }
    for (const p of w.bubbles) {
      g.fillStyle(col(p.tone === 0 ? C.foam : C.white));
      g.fillRect(Math.round(p.x * m), Math.round(-p.y * m), 1, 1);
    }
    if (this.backWater && this.backWaterG && this.backPlane) {
      // back surface: from the back line down to the front surface
      this.drawWaterBody(this.backWaterG, this.backWater, this.backPlane, 0, 3.1);
      for (const p of this.backWater.drops) {
        this.backWaterG.fillStyle(col(p.tone === 0 ? C.white : t.waterLight));
        const [sx, sy] = toScreen(this.backPlane, p.x, p.y);
        this.backWaterG.fillRect(Math.round(sx), Math.round(sy), 1, 1);
      }
    }
  }
}
