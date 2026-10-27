// The diving hall: background wall, stands with a 2-frame crowd, flags, LED
// scoreboard, the tower with its 1/3/5/7.5/10 m platforms and the pool with
// spring-mesh water. Three variants: day hall, night hall, outdoor pool.

import Phaser from 'phaser';
import { HEIGHT, PPM, SHOW_RINGS, WIDTH } from '../config';
import { WaterSurface } from '../physics/water';
import { TOWER } from '../physics/diver';
import { C, col, light, mix, shade, type ColorIndex } from './palette';
import { vGradient } from './fx';
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
/** depth (px) where the static water gradient starts under the surface layer */
const WATER_BAND = 20;
/** camera scroll for which back layers line up with the world (centred on the pool) */
const layerOffset = (f: number): [number, number] => {
  const refX = 4 * PPM - WIDTH / 2;
  const refY = -HEIGHT / 2;
  return [-refX * (1 - f), -refY * (1 - f)];
};

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

  private drawBackground(): void {
    const t = this.theme;
    const [ox, oy] = layerOffset(BG_PLANE);
    const g = this.scene.add.graphics().setDepth(0).setScrollFactor(BG_PLANE).setPosition(ox, oy);
    const W = 3600;
    const x0 = -1400;
    if (this.kind === 'outdoor') {
      vGradient(g, x0, -900, W, 860, col(C.blue), col(C.paleBlue), 16);
      g.fillStyle(col(C.paleBlue));
      g.fillRect(x0, -40, W, 400);
      // sun with a soft halo
      g.fillStyle(light(C.paleYellow, 0.5));
      g.fillCircle(480, -300, 30);
      g.fillStyle(col(C.paleYellow));
      g.fillCircle(480, -300, 22);
      // clouds: puffs with a shaded underside
      for (const [cx, cy] of [
        [40, -260],
        [300, -200],
        [660, -320],
        [-300, -240],
        [960, -220],
      ] as const) {
        g.fillStyle(col(C.white));
        g.fillCircle(cx, cy, 14);
        g.fillCircle(cx + 18, cy - 8, 18);
        g.fillCircle(cx + 40, cy, 14);
        g.fillRect(cx, cy, 40, 14);
        g.fillStyle(col(C.paleBlue));
        g.fillRect(cx - 4, cy + 10, 50, 4);
      }
      // hills, two layers with a lit rim
      for (const [base, amp, f, c] of [
        [-60, 20, 0.01, C.green],
        [-44, 12, 0.017, C.darkGreen],
      ] as const) {
        for (let x = x0; x < x0 + W; x += 2) {
          const h = amp + Math.round(amp * 0.6 * Math.sin(x * f) + amp * 0.35 * Math.sin(x * f * 2.6 + 1));
          g.fillStyle(col(c));
          g.fillRect(x, base - h, 2, h + 80);
          g.fillStyle(light(c, 0.25));
          g.fillRect(x, base - h, 2, 2);
        }
      }
    } else {
      vGradient(g, x0, -900, W, 1000, t.night ? col(C.black) : shade(t.wall, 0.25), col(t.wall), 14);
      // windows / light panels
      for (let x = x0; x < x0 + W; x += 80) {
        for (let y = -380; y < -120; y += 68) {
          g.fillStyle(t.night ? col(C.charcoal) : col(C.white));
          g.fillRect(x + 12, y, 52, 44);
          vGradient(g, x + 16, y + 4, 44, 36, t.night ? col(C.navy) : col(C.sky), t.night ? col(C.black) : col(C.paleBlue), 4);
          if (!t.night) {
            // diagonal glint
            g.fillStyle(light(C.paleBlue, 0.5));
            for (let k = 0; k < 10; k++) g.fillRect(x + 20 + k * 2, y + 30 - k * 2, 2, 2);
          } else if ((x / 80 + y / 68) % 3 === 0) {
            g.fillStyle(col(C.gold));
            g.fillRect(x + 34, y + 18, 4, 4);
          }
        }
      }
      // roof trusses
      g.fillStyle(col(t.wallDark));
      g.fillRect(x0, -452, W, 6);
      for (let x = x0; x < x0 + W; x += 32) {
        for (let k = 0; k < 16; k++) g.fillRect(x + k * 2, -440 + (k < 8 ? k : 15 - k) * 3, 2, 2);
      }
      g.fillRect(x0, -416, W, 4);
      if (t.night) {
        g.fillStyle(col(C.paleYellow));
        for (let x = x0 + 20; x < x0 + W; x += 120) g.fillRect(x, -426, 12, 6);
      }
    }
    if (SHOW_RINGS) {
      ensureRingsTexture(this.scene, 'rings-small', 10, this.theme.night ? C.white : C.black);
      this.scene.add.image(WIDTH / 2 + ox, -420 + oy, 'rings-small').setScrollFactor(BG_PLANE).setDepth(1);
    }
  }

  private drawStands(): void {
    const t = this.theme;
    const [ox, oy] = layerOffset(STAND_PLANE);
    const g = this.scene.add.graphics().setDepth(5).setScrollFactor(STAND_PLANE);
    const left = -900 + ox;
    const right = 2200 + ox;
    // tiers
    const rows = 6;
    const base = -28 + oy;
    ensureCrowdTexture(this.scene, `crowd-${this.kind}-a`, 3, t.night);
    ensureCrowdTexture(this.scene, `crowd-${this.kind}-b`, 17, t.night);
    for (let r = 0; r < rows; r++) {
      const y = base - r * 18;
      const c = r % 2 ? t.stands : t.concreteDark;
      g.fillStyle(col(c));
      g.fillRect(left + r * 8, y, right - left, 18);
      g.fillStyle(light(c, 0.2));
      g.fillRect(left + r * 8, y, right - left, 2);
      g.fillStyle(shade(c, 0.3));
      g.fillRect(left + r * 8, y + 16, right - left, 2);
      const crowd = this.scene.add
        .tileSprite(left + r * 8, y - 14, right - left - r * 16, 16, `crowd-${this.kind}-${r % 2 ? 'a' : 'b'}`, 'a')
        .setOrigin(0, 0)
        .setScrollFactor(STAND_PLANE)
        .setDepth(6);
      crowd.tilePositionX = r * 26;
      this.crowds.push(crowd);
    }
    // railing and flags
    const flagY = base - rows * 18 - 36;
    g.fillStyle(col(t.concreteDark));
    g.fillRect(left, flagY + 20, right - left, 4);
    for (let i = 0; i < 76; i++) {
      const c = COUNTRIES[i % COUNTRIES.length]!;
      const x = left + 20 + i * 40;
      g.fillStyle(col(C.grey));
      g.fillRect(x, flagY - 4, 2, 24);
      g.fillStyle(col(C.lightGrey));
      g.fillRect(x, flagY - 6, 2, 2);
      this.scene.add.image(x + 2, flagY - 4, 'flags', c.code).setOrigin(0, 0).setScrollFactor(STAND_PLANE).setDepth(6);
    }
    // LED scoreboard
    const bx = WIDTH / 2 - 128 + 160 + ox;
    const by = flagY - 104;
    g.fillStyle(col(C.charcoal));
    g.fillRect(bx - 8, by - 8, 272, 96);
    g.fillStyle(light(C.charcoal, 0.2));
    g.fillRect(bx - 8, by - 8, 272, 2);
    g.fillStyle(col(C.black));
    g.fillRect(bx - 4, by - 4, 264, 88);
    for (let i = 0; i < 3; i++) {
      const txt = this.scene.add
        .bitmapText(bx + 4, by + 2 + i * 26, FONT, '', 16)
        .setScrollFactor(STAND_PLANE)
        .setDepth(7)
        .setTint(col(i === 0 ? C.gold : i === 1 ? C.orange : C.red));
      this.board.push(txt);
    }
    // LED dot grid overlay
    const grid = this.scene.add.graphics().setDepth(8).setScrollFactor(STAND_PLANE);
    grid.fillStyle(col(C.black));
    for (let y = by - 2; y < by + 82; y += 2) grid.fillRect(bx - 2, y, 260, 1);
    for (let x = bx - 2; x < bx + 258; x += 2) grid.fillRect(x, by - 2, 1, 84);
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
    g.fillRect(Math.round(x0), Math.round(y0), Math.round(x1 - x0), 2);
  }

  private drawTower(active: number): void {
    const t = this.theme;
    const g = this.scene.add.graphics().setDepth(30);
    const m = PPM;
    const colX0 = Math.round((-TOWER.depth - 2.2) * m);
    const colX1 = Math.round(-TOWER.overhang * m);
    const top = Math.round(-10.6 * m);
    // column: lit from the right, darker to the left, with panel joints
    const cw = colX1 - colX0;
    const bands = 8;
    for (let i = 0; i < bands; i++) {
      g.fillStyle(mix(shade(t.concrete, 0.25), col(t.concreteLight), i / (bands - 1)));
      g.fillRect(colX0 + Math.round((i * cw) / bands), top, Math.ceil(cw / bands), -top);
    }
    g.fillStyle(col(t.concreteDark));
    g.fillRect(colX1 - 6, top, 6, -top);
    g.fillStyle(shade(t.concrete, 0.15));
    for (let y = 1; y < 10; y += 1) g.fillRect(colX0, -y * m, cw - 6, 2);
    // ladder
    g.fillStyle(col(t.concreteDark));
    g.fillRect(colX0 + 12, -10 * m, 2, 10 * m);
    g.fillRect(colX0 + 26, -10 * m, 2, 10 * m);
    for (let y = 0; y < 10 * m; y += 8) g.fillRect(colX0 + 12, -y, 16, 2);
    // platforms
    for (const h of PLATFORMS) {
      const isActive = h === active;
      const y = Math.round(-h * m);
      const x0 = colX1 - Math.round((isActive ? TOWER.depth - TOWER.overhang : 0.6) * m);
      const x1 = isActive ? 0 : Math.round((h === 10 ? 0 : -0.3 * (10 - h)) * m);
      const thick = Math.round(TOWER.slab * m);
      const face = isActive ? t.concrete : t.concreteDark;
      g.fillStyle(col(face));
      g.fillRect(x0, y, x1 - x0, thick);
      g.fillStyle(shade(face, 0.2));
      g.fillRect(x0, y + Math.round(thick / 2), x1 - x0, thick - Math.round(thick / 2));
      g.fillStyle(col(t.concreteLight));
      g.fillRect(x0, y, x1 - x0, 2);
      g.fillStyle(col(C.slate));
      g.fillRect(x0, y + thick - 2, x1 - x0, 2);
      // edge marker (yellow stripe like real platforms)
      g.fillStyle(col(C.gold));
      g.fillRect(x1 - 4, y, 4, thick);
      g.fillStyle(light(C.gold, 0.4));
      g.fillRect(x1 - 4, y, 4, 2);
      // railing at the back
      g.fillStyle(col(C.grey));
      g.fillRect(x0, y - 28, 2, 28);
      g.fillRect(x0, y - 28, 24, 2);
      g.fillRect(x0, y - 14, 24, 2);
      // height label
      const lbl = this.scene.add.bitmapText(colX0 + 34, y + 4, FONT, h === 7.5 ? '7½' : String(h), 8);
      lbl.setTint(col(t.night ? C.lightGrey : C.slate)).setDepth(31);
    }
  }

  private drawPoolStatic(): void {
    const t = this.theme;
    const g = this.scene.add.graphics().setDepth(70);
    const m = PPM;
    // deck on both sides of the pool, with a tiled edge
    g.fillStyle(col(t.deck));
    g.fillRect(-40 * m, 0, (POOL.x0 + 40) * m, 8 * m);
    g.fillRect(POOL.x1 * m, 0, 30 * m, 8 * m);
    g.fillStyle(shade(t.deck, 0.15));
    for (let x = -40 * m; x < POOL.x0 * m; x += 16) g.fillRect(x, 4, 1, 8 * m);
    for (let x = POOL.x1 * m; x < (POOL.x1 + 30) * m; x += 16) g.fillRect(x, 4, 1, 8 * m);
    g.fillStyle(col(C.white));
    for (let x = -40 * m; x < POOL.x0 * m; x += 16) g.fillRect(x, 0, 8, 2);
    for (let x = POOL.x1 * m; x < (POOL.x1 + 30) * m; x += 16) g.fillRect(x, 0, 8, 2);
    // pool bottom with lane markings
    g.fillStyle(col(t.concreteDark));
    g.fillRect(POOL.x0 * m, POOL.depth * m, (POOL.x1 - POOL.x0) * m, 3 * m);
    g.fillStyle(col(C.deepBlue));
    g.fillRect(POOL.x0 * m, POOL.depth * m, (POOL.x1 - POOL.x0) * m, 4);
    for (let x = POOL.x0; x < POOL.x1; x += 2.5) g.fillRect(x * m, POOL.depth * m - 12, 4, 12);
    // static deep water under the moving surface layer
    const wg = this.scene.add.graphics().setDepth(59);
    vGradient(wg, POOL.x0 * m, WATER_BAND, (POOL.x1 - POOL.x0) * m, POOL.depth * m - WATER_BAND, col(t.water), col(C.deepWater), 10);
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
      // a little darker than the front pool: it is further away
      g.fillStyle(mix(col(t.water), col(C.deepWater), 0.18));
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
    // moving surface layer down to the static gradient below it
    for (let i = 0; i < w.cols; i++) {
      const x = Math.round((w.x0 + i * w.dx) * m);
      const top = Math.round(-w.h[i]! * m);
      g.fillStyle(col(t.water));
      g.fillRect(x, top, 1, WATER_BAND + (i % 2) - top);
      const slope = (w.h[Math.min(w.cols - 1, i + 1)]! - w.h[Math.max(0, i - 1)]!) * m;
      const sh = Math.sin(this.time * 2.3 + i * 0.19) + Math.sin(i * 0.85 + this.time * 0.9);
      g.fillStyle(slope < -0.4 || sh > 1.55 ? col(t.foam) : col(t.waterLight));
      g.fillRect(x, top, 1, 2);
      if (sh > 1.25) {
        g.fillStyle(mix(col(t.water), col(t.waterLight), 0.6));
        g.fillRect(x, top + 6 + ((i * 7) % 5), 1, 1);
      }
      // caustics
      if (Math.sin(i * 0.45 + this.time * 3) + Math.sin(i * 0.11 - this.time * 1.3) > 1.75) {
        g.fillStyle(light(t.water, 0.2));
        g.fillRect(x, WATER_BAND + 12 + ((i * 5) % 18), 1, 2);
      }
    }
    // lane rope floats
    for (let x = POOL.x0 + 0.5; x < POOL.x1; x += 0.25) {
      const k = Math.round((x - POOL.x0) * 4);
      const c = k % 6 < 3 ? C.red : C.white;
      const y = Math.round(-w.heightAt(x) * m) + 6;
      g.fillStyle(col(c));
      g.fillRect(Math.round(x * m), y, 5, 3);
      g.fillStyle(light(c, 0.5));
      g.fillRect(Math.round(x * m) + 1, y, 3, 1);
    }
    // splash drops and bubbles
    for (const p of w.drops) {
      g.fillStyle(p.tone === 0 ? col(C.white) : p.tone === 1 ? col(t.waterLight) : col(t.water));
      g.fillRect(Math.round(p.x * m), Math.round(-p.y * m), 2, 2);
    }
    for (const p of w.bubbles) {
      g.fillStyle(col(p.tone === 0 ? C.foam : C.white));
      g.fillRect(Math.round(p.x * m), Math.round(-p.y * m), 2, 2);
    }
    if (this.backWater && this.backWaterG && this.backPlane) {
      // back surface: from the back line down past the front surface. The
      // back layer scrolls slower, so the front line moves in its coordinates.
      const front = (this.backPlane.s - 1) * this.scene.cameras.main.scrollY;
      this.drawWaterBody(this.backWaterG, this.backWater, this.backPlane, front + WATER_BAND + 8, 3.1);
      for (const p of this.backWater.drops) {
        this.backWaterG.fillStyle(col(p.tone === 0 ? C.white : t.waterLight));
        const [sx, sy] = toScreen(this.backPlane, p.x, p.y);
        this.backWaterG.fillRect(Math.round(sx), Math.round(sy), 2, 2);
      }
    }
  }
}
