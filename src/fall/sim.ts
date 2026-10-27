// Nieskończona wieża (prototype): a synchro pair falls from the platform down
// an endless tower. The player steers one diver at a time and switches with
// ↑; the other one keeps its line. Both share the fall speed, set by the
// body shape (↓ dive, ACTION spread). Gates are for either diver or only for
// the red or the blue one. Arcade physics, deterministic fixed 120 Hz step;
// a run goes from tower to tower until the pair is out of lives.

import { POSES, type Joints } from '../physics/body';
import { DT, IN, pdStep, type RenderState } from '../physics/diver';
import { DRONE_R, droneX, makeLevel, walls, type GateFor, type Level } from './gen';

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
/** centre of mass above the platform when standing */
const STAND_COM = 0.98;
const JUMP_VY = 3.2;
const JUMP_VX = 0.8;
export const START_X: [number, number] = [1.5, 3.3];
export const RIP_VX = 1.2;
export const CLEAN_VX = 2.5;
export const GATE_POINTS = 100;
export const NEAR_POINTS = 50;

export type FallEvent =
  | { t: number; type: 'jump' }
  | { t: number; type: 'switch'; active: 0 | 1 }
  | { t: number; type: 'gate'; who: GateFor; diver: 0 | 1; combo: number; points: number }
  | { t: number; type: 'gateMiss'; who: GateFor }
  | { t: number; type: 'near'; diver: 0 | 1; points: number }
  | { t: number; type: 'hit'; diver: 0 | 1; lives: number; lost: number }
  | { t: number; type: 'entry'; grade: EntryGrade; banked: number; xs: [number, number]; speed: number }
  | { t: number; type: 'level'; n: number }
  | { t: number; type: 'over'; score: number; level: number };

const BODY: Record<Pose | 'stun' | 'stand', Joints> = {
  stand: POSES.stand,
  normal: { s: 2.3, e: 0.2, h: 0.15, k: 0.25, a: 0.3 },
  dive: POSES.openHead,
  spread: { s: 1.5, e: 0.05, h: 0.35, k: 0.9, a: 0.6 },
  stun: { s: 1.0, e: 1.2, h: 1.2, k: 1.4, a: 0.4 },
};

export class Diver {
  x: number;
  vx = 0;
  theta = 0;
  j: Joints = { ...BODY.stand };
  jv: Joints = { s: 0, e: 0, h: 0, k: 0, a: 0 };
  stun = 0;
  invuln = 0;
  constructor(x: number) {
    this.x = x;
  }
}

export class FallSim {
  level: Level;
  tick = 0;
  /** time since the jump, drives the drones */
  levelT = 0;
  phase: 'stand' | 'fall' | 'water' | 'over' = 'stand';
  readonly divers: [Diver, Diver] = [new Diver(START_X[0]), new Diver(START_X[1])];
  active: 0 | 1 = 0;
  y = 0;
  vy = 0;
  pose: Pose = 'normal';
  lives = LIVES;
  combo = 0;
  /** points collected in this fall, banked by the entry */
  pot = 0;
  score = 0;
  events: FallEvent[] = [];
  private prevInput = 0;
  private phaseTime = 0;
  private gateIdx = 0;
  private passed = new Set<object>();
  private readonly keys = new Map<object, [object, object]>();

  constructor(levelN = 1) {
    this.level = makeLevel(levelN);
    this.startLevel();
  }

  get t(): number {
    return this.tick * DT;
  }

  /** 0 on the platform, 1 at the water */
  get progress(): number {
    return Math.min(1, Math.max(0, 1 - (this.y - ENTRY_Y) / (this.level.depth + STAND_COM - ENTRY_Y)));
  }

  snapshot(i: 0 | 1): RenderState {
    const d = this.divers[i];
    return { x: d.x, y: this.y, theta: d.theta, j: { ...d.j }, psi: 0, facing: 1 };
  }

  private startLevel(): void {
    this.divers.forEach((d, i) => {
      d.x = START_X[i]!;
      d.vx = 0;
      d.theta = 0;
      d.j = { ...BODY.stand };
      d.jv = { s: 0, e: 0, h: 0, k: 0, a: 0 };
      d.stun = 0;
      d.invuln = 0;
    });
    this.y = this.level.depth + STAND_COM;
    this.vy = 0;
    this.levelT = 0;
    this.pot = 0;
    this.combo = 0;
    this.gateIdx = 0;
    this.passed.clear();
    this.keys.clear();
    this.phase = 'stand';
    this.phaseTime = 0;
  }

  step(input: number): void {
    const pressed = input & ~this.prevInput;
    this.prevInput = input;
    this.phaseTime += DT;
    if (this.phase === 'stand') this.stepStand(pressed);
    else if (this.phase === 'fall') this.stepFall(input, pressed);
    else if (this.phase === 'water') this.stepWater();
    this.tick++;
  }

  private stepStand(pressed: number): void {
    for (const d of this.divers) {
      pdStep(d.j, d.jv, BODY.stand);
    }
    if (!(pressed & IN.ACTION)) return;
    this.phase = 'fall';
    this.phaseTime = 0;
    this.vy = JUMP_VY;
    for (const d of this.divers) d.vx = JUMP_VX;
    this.events.push({ t: this.t, type: 'jump' });
  }

  private stepFall(input: number, pressed: number): void {
    this.levelT += DT;
    if (pressed & IN.UP) {
      this.active = this.active === 0 ? 1 : 0;
      this.events.push({ t: this.t, type: 'switch', active: this.active });
    }
    // the shape is the pair's (synchro); only the steering is per diver.
    // Right after the jump the pair rotates head down before it can dive.
    const ready = this.phaseTime > 0.5;
    this.pose = !ready ? 'normal' : input & IN.ACTION ? 'spread' : input & IN.DOWN ? 'dive' : 'normal';
    this.vy += (-FALL_SPEED[this.pose] - this.vy) * Math.min(1, (ready ? FALL_RATE : 0.4) * DT) - (ready ? 0 : 6.5 * DT);
    const prevY = this.y;
    this.y += this.vy * DT;
    this.pot += Math.max(0, prevY - this.y) * (this.pose === 'dive' ? 2 : 1);
    const steer = (input & IN.RIGHT ? 1 : 0) - (input & IN.LEFT ? 1 : 0);
    this.divers.forEach((d, i) => {
      const free = d.stun <= 0;
      d.stun = Math.max(0, d.stun - DT);
      d.invuln = Math.max(0, d.invuln - DT);
      if (free && i === this.active && ready) d.vx += steer * STEER[this.pose] * DT;
      d.vx -= d.vx * Math.min(1, SIDE_DRAG * DT);
      d.vx = Math.max(-MAX_VX, Math.min(MAX_VX, d.vx));
      d.x += d.vx * DT;
      // head down, leaning into the turn; tumbling while stunned
      const want = Math.PI - d.vx * 0.07;
      if (free) d.theta += (want - d.theta) * Math.min(1, (ready ? 10 : 6) * DT);
      else d.theta += 14 * DT;
      pdStep(d.j, d.jv, free ? BODY[this.pose] : BODY.stun);
    });
    this.collide(prevY);
    if (this.phase === 'fall' && this.y <= ENTRY_Y) this.enterWater();
  }

  private collide(prevY: number): void {
    const l = this.level;
    const r = BODY_R;
    const [L, R] = walls(l);
    // still beside the start platform: it is not an obstacle
    const belowPlatform = this.y < l.depth - 1;
    this.divers.forEach((d, i) => {
      const k = i as 0 | 1;
      if (d.x - r < L && belowPlatform) this.hit(k, 1, L + r + 0.05);
      else if (d.x + r > R) this.hit(k, -1, R - r - 0.05);
      for (const g of l.ledges) {
        const key = this.key(g, k);
        if (this.y - r > g.y1 || this.y + r < g.y0) {
          if (prevY >= g.y0 && this.y < g.y0 && !this.passed.has(key)) {
            this.passed.add(key);
            const clear = g.side < 0 ? d.x - r - g.x1 : g.x0 - (d.x + r);
            if (clear < NEAR && clear >= 0) this.near(k);
          }
          continue;
        }
        if (d.x + r > g.x0 && d.x - r < g.x1 && !this.passed.has(key)) {
          this.passed.add(key);
          // out past the free end of the ledge
          this.hit(k, -g.side as 1 | -1, g.side < 0 ? g.x1 + r + 0.05 : g.x0 - r - 0.05);
        }
      }
      for (const b of l.drones) {
        const key = this.key(b, k);
        if (this.passed.has(key)) continue;
        const bx = droneX(b, this.levelT);
        const dx = d.x - bx;
        if (Math.hypot(dx, this.y - b.y) < r + DRONE_R) {
          this.passed.add(key);
          this.hit(k, dx >= 0 ? 1 : -1, d.x);
        } else if (prevY >= b.y && this.y < b.y) {
          this.passed.add(key);
          if (Math.abs(dx) - r - DRONE_R < NEAR) this.near(k);
        }
      }
    });

    while (this.gateIdx < l.gates.length && l.gates[this.gateIdx]!.y >= this.y) {
      const g = l.gates[this.gateIdx++]!;
      const inside = (i: 0 | 1) => Math.abs(this.divers[i].x - g.x) <= g.gap / 2;
      const by: 0 | 1 | null = g.who === -1 ? (inside(0) ? 0 : inside(1) ? 1 : null) : inside(g.who) ? g.who : null;
      if (by !== null) {
        this.combo++;
        const points = GATE_POINTS * this.combo;
        this.pot += points;
        this.events.push({ t: this.t, type: 'gate', who: g.who, diver: by, combo: this.combo, points });
      } else {
        this.combo = 0;
        this.events.push({ t: this.t, type: 'gateMiss', who: g.who });
      }
    }
  }

  /** one key per obstacle and diver, so each diver meets each obstacle once */
  private key(o: object, i: 0 | 1): object {
    let k = this.keys.get(o);
    if (!k) {
      k = [{}, {}];
      this.keys.set(o, k);
    }
    return k[i];
  }

  private near(i: 0 | 1): void {
    const points = NEAR_POINTS * Math.max(1, this.combo);
    this.pot += points;
    this.events.push({ t: this.t, type: 'near', diver: i, points });
  }

  /** `away`: direction to bounce, `x`: where the body ends up */
  private hit(i: 0 | 1, away: 1 | -1, x: number): void {
    const d = this.divers[i];
    d.x = x;
    if (d.invuln > 0) {
      d.vx = Math.abs(d.vx) * away;
      return;
    }
    this.lives--;
    const lost = Math.round(this.pot / 2);
    this.pot -= lost;
    this.combo = 0;
    d.vx = 4 * away;
    this.vy *= 0.6;
    d.stun = STUN;
    d.invuln = INVULN;
    this.events.push({ t: this.t, type: 'hit', diver: i, lives: this.lives, lost });
    if (this.lives <= 0) this.end();
  }

  private grade(d: Diver): EntryGrade {
    const a = Math.abs(d.vx);
    if (this.pose === 'spread' || a > CLEAN_VX || d.stun > 0) return 'FLAT';
    return this.pose === 'dive' && a <= RIP_VX ? 'RIP' : 'CLEAN';
  }

  private enterWater(): void {
    // synchro: the pair is only as good as its worse entry
    const gs = this.divers.map((d) => this.grade(d));
    const grade: EntryGrade = gs.includes('FLAT') ? 'FLAT' : gs.includes('CLEAN') ? 'CLEAN' : 'RIP';
    const mult = grade === 'RIP' ? 2 : grade === 'CLEAN' ? 1 : 0.5;
    const banked = Math.round(this.pot * mult);
    this.score += banked;
    this.pot = 0;
    const xs: [number, number] = [this.divers[0].x, this.divers[1].x];
    this.events.push({ t: this.t, type: 'entry', grade, banked, xs, speed: -this.vy });
    if (grade === 'FLAT') {
      this.lives--;
      this.events.push({ t: this.t, type: 'hit', diver: gs[0] === 'FLAT' ? 0 : 1, lives: this.lives, lost: 0 });
    }
    this.phase = 'water';
    this.phaseTime = 0;
  }

  private stepWater(): void {
    this.vy -= this.vy * Math.min(1, 3 * DT);
    this.y += this.vy * DT;
    for (const d of this.divers) {
      d.vx -= d.vx * Math.min(1, 4 * DT);
      d.x += d.vx * DT;
      pdStep(d.j, d.jv, BODY.dive);
    }
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

