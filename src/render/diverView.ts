// Draws a diver from its simulation state: one sprite per segment, rotated
// inside the 320x180 buffer (low-resolution rotation gives the jagged 8-bit
// edges), mirrored and squashed in width for twists.

import Phaser from 'phaser';
import type { Joints } from '../physics/body';
import { segmentsWorld, type SegWorld } from '../physics/ragdoll';
import type { RenderState } from '../physics/diver';
import { PPM } from '../config';
import { C, col } from './palette';
import { ORIGINS, ensureDiverTexture, type DiverLook, type FrameName } from './sprites';
import type { ColorIndex } from './palette';

/** A depth plane: scale and offset for things further back (parallax). */
export interface Plane {
  s: number;
  ox: number;
  oy: number;
}

export const FRONT: Plane = { s: 1, ox: 0, oy: 0 };

export function toScreen(plane: Plane, x: number, y: number): [number, number] {
  return [x * PPM * plane.s + plane.ox, -y * PPM * plane.s + plane.oy];
}

type Part = 'farLeg' | 'farShin' | 'farFoot' | 'farArm' | 'farFore' | 'torso' | 'head' | 'thigh' | 'shin' | 'foot' | 'upperArm' | 'forearm';
const ORDER: Part[] = ['farArm', 'farFore', 'farLeg', 'farShin', 'farFoot', 'thigh', 'shin', 'foot', 'torso', 'head', 'upperArm', 'forearm'];

export function lerpState(a: RenderState, b: RenderState, t: number): RenderState {
  const lj = (k: keyof Joints) => a.j[k] + (b.j[k] - a.j[k]) * t;
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    theta: a.theta + (b.theta - a.theta) * t,
    psi: a.psi + (b.psi - a.psi) * t,
    facing: b.facing,
    j: { s: lj('s'), e: lj('e'), h: lj('h'), k: lj('k'), a: lj('a') },
  };
}

const OUTLINE: [number, number][] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

export class DiverView {
  readonly parts: Record<Part, Phaser.GameObjects.Image>;
  /** black copies around every part: a 1px outline so the diver reads against the crowd */
  private readonly outline: Phaser.GameObjects.Image[] = [];
  private readonly key: string;
  plane: Plane;
  /** y of the water surface (m) for the underwater silhouette */
  waterY = 0;
  visible = true;
  silhouetteColor: ColorIndex = C.black;
  private readonly depth: number;
  /** depth used for parts under the water surface (drawn over the water) */
  underDepth: number;

  constructor(scene: Phaser.Scene, look: DiverLook, depth: number, plane: Plane = FRONT, opts: { atlasKey?: string; outline?: boolean; underDepth?: number } = {}) {
    this.key = opts.atlasKey ?? ensureDiverTexture(scene, look);
    this.plane = plane;
    this.depth = depth;
    this.underDepth = opts.underDepth ?? depth + 30;
    const frameOf: Record<Part, FrameName> = {
      farArm: 'upperArmFar',
      farFore: 'forearmFar',
      farLeg: 'thighFar',
      farShin: 'shinFar',
      farFoot: 'footFar',
      thigh: 'thigh',
      shin: 'shin',
      foot: 'foot',
      torso: 'torso',
      head: 'head',
      upperArm: 'upperArm',
      forearm: 'forearm',
    };
    const parts = {} as Record<Part, Phaser.GameObjects.Image>;
    ORDER.forEach((p, i) => {
      const f = frameOf[p];
      const o = ORIGINS[f];
      if (opts.outline !== false) {
        for (let k = 0; k < OUTLINE.length; k++) {
          const ol = scene.add.image(0, 0, this.key, f).setOrigin(o[0], o[1]).setScrollFactor(plane.s).setDepth(depth - 0.5);
          ol.setTint(col(C.black)).setTintMode(Phaser.TintModes.FILL);
          this.outline.push(ol);
        }
      }
      const img = scene.add.image(0, 0, this.key, f);
      img.setOrigin(o[0], o[1]);
      img.setDepth(depth + i * 0.01);
      img.setScrollFactor(plane.s);
      parts[p] = img;
    });
    this.parts = parts;
  }

  setVisible(v: boolean): void {
    this.visible = v;
    for (const p of ORDER) this.parts[p].setVisible(v);
    for (const o of this.outline) o.setVisible(v);
  }

  destroy(): void {
    for (const p of ORDER) this.parts[p].destroy();
    for (const o of this.outline) o.destroy();
  }

  update(st: RenderState, silhouette = false): void {
    if (!this.visible) return;
    const { segs, sg, squash } = segmentsWorld(st);
    this.draw(segs, sg, squash, st.psi, silhouette);
  }

  /** draw from world segment frames (kinematic pose or ragdoll) */
  draw(segs: SegWorld[], sg: 1 | -1, squash: number, psi: number, silhouette = false): void {
    if (!this.visible) return;
    const pl = this.plane;
    const P = this.parts;
    let oi = 0;
    const place = (img: Phaser.GameObjects.Image, s: SegWorld, limb: boolean, order: number, backShift = 0) => {
      // far limbs sit a little behind the near ones, along the body's front axis
      const bx = backShift ? -Math.cos(s.dir) * backShift * sg : 0;
      const by = backShift ? Math.sin(s.dir) * backShift * sg : 0;
      const [px, py] = toScreen(pl, s.px + bx, s.py + by);
      const x = Math.round(px);
      const y = Math.round(py);
      const rot = limb ? s.dir - Math.PI : s.dir;
      img.setPosition(x, y);
      img.setRotation(rot);
      img.setScale(squash * pl.s, pl.s);
      img.setFlipX(sg < 0);
      const half = s.name === 'head' ? 0 : s.len / 2;
      const under = s.py + Math.cos(s.dir) * half < this.waterY;
      img.setDepth((under ? this.underDepth : this.depth) + order * 0.01);
      if (silhouette || under) {
        img.setTint(col(under && !silhouette ? C.paleBlue : this.silhouetteColor)).setTintMode(Phaser.TintModes.FILL);
      } else {
        img.clearTint();
        img.setTintMode(Phaser.TintModes.MULTIPLY);
      }
      for (let k = 0; k < OUTLINE.length && oi < this.outline.length; k++, oi++) {
        const ol = this.outline[oi]!;
        ol.setFrame(img.frame.name);
        ol.setPosition(x + OUTLINE[k]![0], y + OUTLINE[k]![1]);
        ol.setRotation(rot);
        ol.setScale(squash * pl.s, pl.s);
        ol.setFlipX(sg < 0);
        ol.setDepth((under ? this.underDepth : this.depth) - 0.5);
        ol.setTint(col(under ? C.deepWater : C.black));
        ol.setVisible(!silhouette);
      }
    };
    const by = (n: string) => segs.find((x) => x.name === n)!;
    const twistView = Math.abs(Math.cos(psi)) < 0.38;
    const sideFront = Math.sin(psi) > 0;
    P.torso.setFrame(twistView ? (sideFront ? 'torsoFront' : 'torsoBack') : 'torso');
    P.head.setFrame(twistView ? (sideFront ? 'headFront' : 'headBack') : 'head');
    const b = 0.05;
    // same order as ORDER so the outline copies line up with their parts
    place(P.farArm, by('upperArm'), true, 0, b);
    place(P.farFore, by('forearm'), true, 1, b);
    place(P.farLeg, by('thigh'), true, 2, b);
    place(P.farShin, by('shin'), true, 3, b);
    place(P.farFoot, by('foot'), true, 4, b);
    place(P.thigh, by('thigh'), true, 5);
    place(P.shin, by('shin'), true, 6);
    place(P.foot, by('foot'), true, 7);
    place(P.torso, by('torso'), false, 8);
    place(P.head, by('head'), false, 9);
    place(P.upperArm, by('upperArm'), true, 10);
    place(P.forearm, by('forearm'), true, 11);
  }
}
