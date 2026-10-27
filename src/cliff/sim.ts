// Klif (prototype): falling through a canyon, steering around ledges and
// birds and through gates. Arcade physics, not the tower's rotation model:
// the body shape sets the fall speed and how hard ←/→ can steer.
// Deterministic fixed 120 Hz step; a run goes from level to level until the
// diver is knocked out.

import { POSES, type Joints } from '../physics/body';
import { DT, IN, pdStep, type RenderState } from '../physics/diver';
import { BIRD_R, birdX, makeLevel, walls, type Level } from './gen';

export type Pose = 'normal' | 'dive' | 'spread';
export type EntryGrade = 'RIP' | 'CLEAN' | 'FLAT';

/** falling speed each shape settles at (m/s) */
export const FALL_SPEED: Record<Pose, number> = { normal: 9, dive: 15, spread: 4.5 };
/** how hard ←/→ push sideways (m/s²) */
export const STEER: Record<Pose, number> = { normal: 16, dive: 7, spread: 24 };
const FALL_RATE = 1.8;
const SIDE_DRAG = 2.5;
const MAX_VX = 8;
/** body radius for collisions */
export const BODY_R = 0.4;
/** passing this close to an obstacle is a near miss */
export const NEAR = 0.8;
export const LIVES = 3;
const STUN = 0.45;
const INVULN = 1.2;
const WATER_TIME = 1.6;
/** the hands touch the water when the centre of mass is this high */
const ENTRY_Y = 1.0;
export const RIP_VX = 1.2;
export const CLEAN_VX = 2.5;
export const GATE_POINTS = 100;
export const NEAR_POINTS = 50;

export type CliffEvent =
  | { t: number; type: 'gate'; combo: number; points: number }
  | { t: number; type: 'gateMiss' }
  | { t: number; type: 'near'; points: number }
  | { t: number; type: 'hit'; lives: number; lost: number }
  | { t: number; type: 'entry'; grade: EntryGrade; banked: number; x: number; speed: number }
  | { t: number; type: 'level'; n: number }
  | { t: number; type: 'over'; score: number; level: number };

const BODY: Record<Pose | 'stun', Joints> = {
  normal: { s: 2.3, e: 0.2, h: 0.15, k: 0.25, a: 0.3 },
  dive: POSES.openHead,
  spread: { s: 1.5, e: 0.05, h: 0.35, k: 0.9, a: 0.6 },
  stun: { s: 1.0, e: 1.2, h: 1.2, k: 1.4, a: 0.4 },
};

export class CliffSim {
  level: Level;
  tick = 0;
  /** time inside the current level, drives the birds */
  levelT = 0;
  phase: 'fall' | 'water' | 'over' = 'fall';
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  pose: Pose = 'normal';
  theta = Math.PI;
  j: Joints = { ...BODY.normal };
  jv: Joints = { s: 0, e: 0, h: 0, k: 0, a: 0 };
  lives = LIVES;
  combo = 0;
  /** points collected in this fall, banked by the entry */
  pot = 0;
  score = 0;
  events: CliffEvent[] = [];
  stun = 0;
  invuln = 0;
  private phaseTime = 0;
  private gateIdx = 0;
  private passed = new Set<object>();

  constructor(levelN = 1) {
    this.level = makeLevel(levelN);
    this.startLevel();
  }

  get t(): number {
    return this.tick * DT;
  }

  /** 0 at the top of the cliff, 1 at the water */
  get progress(): number {
    return Math.min(1, Math.max(0, 1 - this.y / this.level.depth));
  }

  snapshot(): RenderState {
    return { x: this.x, y: this.y, theta: this.theta, j: { ...this.j }, psi: 0, facing: 1 };
  }

  private startLevel(): void {
    const l = this.level;
    const [L, R] = walls(l, l.depth);
    this.x = (L + R) / 2;
    this.y = l.depth;
    this.vx = 0;
    this.vy = -2;
    this.levelT = 0;
    this.pot = 0;
    this.combo = 0;
    this.gateIdx = 0;
    this.passed.clear();
    this.phase = 'fall';
    this.phaseTime = 0;
    this.stun = 0;
    this.invuln = 0;
  }

  step(input: number): void {
    this.phaseTime += DT;
    if (this.phase === 'fall') this.stepFall(input);
    else if (this.phase === 'water') this.stepWater();
    this.tick++;
  }

  private stepFall(input: number): void {
    this.levelT += DT;
    const free = this.stun <= 0;
    this.stun = Math.max(0, this.stun - DT);
    this.invuln = Math.max(0, this.invuln - DT);
    this.pose = !free ? 'normal' : input & IN.ACTION ? 'spread' : input & IN.DOWN ? 'dive' : 'normal';
    const steer = free ? (input & IN.RIGHT ? 1 : 0) - (input & IN.LEFT ? 1 : 0) : 0;

    // fall speed eases towards the speed of the shape
    this.vy += (-FALL_SPEED[this.pose] - this.vy) * Math.min(1, FALL_RATE * DT);
    this.vx += steer * STEER[this.pose] * DT;
    this.vx -= this.vx * Math.min(1, SIDE_DRAG * DT);
    this.vx = Math.max(-MAX_VX, Math.min(MAX_VX, this.vx));
    const prevY = this.y;
    this.x += this.vx * DT;
    this.y += this.vy * DT;
    this.pot += (prevY - this.y) * (this.pose === 'dive' ? 2 : 1);

    // body: head down, leaning into the turn; tumbling while stunned
    if (free) this.theta += (Math.PI - this.vx * 0.07 - this.theta) * Math.min(1, 10 * DT);
    else this.theta += 14 * DT;
    pdStep(this.j, this.jv, free ? BODY[this.pose] : BODY.stun);

    this.collide(prevY);
    if (this.phase === 'fall' && this.y <= ENTRY_Y) this.enterWater();
  }

  private collide(prevY: number): void {
    const l = this.level;
    const r = BODY_R;
    const [L, R] = walls(l, this.y);
    if (this.x - r < L) this.hit(1, L + r + 0.05);
    else if (this.x + r > R) this.hit(-1, R - r - 0.05);

    for (const g of l.ledges) {
      if (this.y - r > g.y1 || this.y + r < g.y0) {
        // fully passed: near miss check once
        if (prevY >= g.y0 && this.y < g.y0 && !this.passed.has(g)) {
          this.passed.add(g);
          const clear = g.side < 0 ? this.x - r - g.x1 : g.x0 - (this.x + r);
          if (clear < NEAR && clear >= 0) this.near();
        }
        continue;
      }
      if (this.x + r > g.x0 && this.x - r < g.x1 && !this.passed.has(g)) {
        this.passed.add(g);
        // out past the free end of the ledge
        this.hit(-g.side as 1 | -1, g.side < 0 ? g.x1 + r + 0.05 : g.x0 - r - 0.05);
      }
    }

    for (const b of l.birds) {
      if (this.passed.has(b)) continue;
      const bx = birdX(b, this.levelT);
      const dx = this.x - bx;
      const dy = this.y - b.y;
      if (Math.hypot(dx, dy) < r + BIRD_R) {
        this.passed.add(b);
        this.hit(dx >= 0 ? 1 : -1, this.x);
      } else if (prevY >= b.y && this.y < b.y) {
        this.passed.add(b);
        if (Math.abs(dx) - r - BIRD_R < NEAR) this.near();
      }
    }

    while (this.gateIdx < l.gates.length && l.gates[this.gateIdx]!.y >= this.y) {
      const g = l.gates[this.gateIdx++]!;
      if (Math.abs(this.x - g.x) <= g.gap / 2) {
        this.combo++;
        const points = GATE_POINTS * this.combo;
        this.pot += points;
        this.events.push({ t: this.t, type: 'gate', combo: this.combo, points });
      } else {
        this.combo = 0;
        this.events.push({ t: this.t, type: 'gateMiss' });
      }
    }
  }

  private near(): void {
    const points = NEAR_POINTS * Math.max(1, this.combo);
    this.pot += points;
    this.events.push({ t: this.t, type: 'near', points });
  }

  /** `away`: direction to bounce, `x`: where the body ends up */
  private hit(away: 1 | -1, x: number): void {
    this.x = x;
    if (this.invuln > 0) {
      this.vx = Math.abs(this.vx) * away;
      return;
    }
    this.lives--;
    const lost = Math.round(this.pot / 2);
    this.pot -= lost;
    this.combo = 0;
    this.vx = 4 * away;
    this.vy *= 0.4;
    this.stun = STUN;
    this.invuln = INVULN;
    this.events.push({ t: this.t, type: 'hit', lives: this.lives, lost });
    if (this.lives <= 0) this.end();
  }

  private enterWater(): void {
    const a = Math.abs(this.vx);
    const grade: EntryGrade =
      this.pose === 'spread' || a > CLEAN_VX || this.stun > 0 ? 'FLAT' : this.pose === 'dive' && a <= RIP_VX ? 'RIP' : 'CLEAN';
    const mult = grade === 'RIP' ? 2 : grade === 'CLEAN' ? 1 : 0.5;
    const banked = Math.round(this.pot * mult);
    this.score += banked;
    this.pot = 0;
    this.events.push({ t: this.t, type: 'entry', grade, banked, x: this.x, speed: Math.hypot(this.vx, this.vy) });
    if (grade === 'FLAT') {
      this.lives--;
      this.events.push({ t: this.t, type: 'hit', lives: this.lives, lost: 0 });
    }
    this.phase = 'water';
    this.phaseTime = 0;
  }

  private stepWater(): void {
    this.vx -= this.vx * Math.min(1, 4 * DT);
    this.vy -= this.vy * Math.min(1, 3 * DT);
    this.x += this.vx * DT;
    this.y += this.vy * DT;
    pdStep(this.j, this.jv, BODY.dive);
    if (this.phaseTime < WATER_TIME) return;
    if (this.lives <= 0) {
      this.end();
      return;
    }
    this.level = makeLevel(this.level.n + 1);
    this.startLevel();
    this.events.push({ t: this.t, type: 'level', n: this.level.n });
  }

  private end(): void {
    this.phase = 'over';
    this.events.push({ t: this.t, type: 'over', score: this.score, level: this.level.n });
  }
}
