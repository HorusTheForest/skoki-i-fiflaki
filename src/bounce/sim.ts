// Odbicie (prototype): a run of trampoline bounces next to the pool.
//
// Same rules as the tower dive (src/physics/diver.ts): fixed 120 Hz step,
// angular momentum L is set when the feet leave the bed and stays constant in
// the air, the rotation rate is L / I(pose). New here: L is chosen on every
// bed contact (←/→ held at take-off), the landing grade sets the height of
// the next bounce, and ↓ at take-off sends the diver into the pool, which
// banks the combo. Deterministic: the same inputs give the same run.

import { axisDir, bodyFrame, inertiaOfFrame, POSES, type BodyFrame, type Joints } from '../physics/body';
import { DT, GRAVITY, IN, pdStep, timeToHeight, type RenderState } from '../physics/diver';
import { Combo, isTrick, type Trick, type TrickPos } from './score';

/** trampoline centre and bed height (m); the pool ends at x = 24 */
export const TRAMP_X = 27.5;
export const BED_Y = 1.0;
/** centre of mass height when standing on the bed */
export const STAND_Y = BED_Y + 0.98;
/** apex above STAND_Y (m): start, ceiling */
export const BASE_H = 2.5;
export const MAX_H = 8;
/** height change after a landing */
export const GAIN: Record<Exclude<Grade, 'BAIL'>, number> = { PERFECT: 1.12, GOOD: 1, SLOPPY: 0.85 };
/** angular momentum given on a spinning take-off (open body arms up: I = 1) */
export const L_SPIN = 2.2;
export const BED_TIME = 0.16;
const BED_DIP = 0.35;
/** horizontal speed of the dive into the pool */
export const BANK_VX = -2.6;
/** ACTION this long before touching the bed or the water is a stick / rip */
export const STICK_WINDOW = 0.15;
export const RIP_PERFECT = 0.12;
export const RIP_GOOD = 0.2;
/** within this time to contact an ACTION press is a stick, not a tuck */
export const ARM_TIME = 0.3;
export const PERFECT_DEG = 12;
export const GOOD_DEG = 22;
export const BAIL_DEG = 45;
export const CLEAN_DEG = 12;
export const FLAT_DEG = 35;
export const RUN_TIME = 90;
/** a perfect landing of a trick adds this to the clock */
export const TIME_BONUS = 0.5;
const STUN_TIME = 1.0;
const WATER_TIME = 1.5;
const TRIM_ARMS = 1.6;
const HALF_TWIST_TIME = 0.15;
const TWIST_W = Math.PI / HALF_TWIST_TIME;
const BED_POSE: Joints = { s: 0.35, e: 0.25, h: 0.55, k: 0.9, a: 1.3 };
const DEG = 180 / Math.PI;
const TAU = Math.PI * 2;

export type Grade = 'PERFECT' | 'GOOD' | 'SLOPPY' | 'BAIL';
export type EntryGrade = 'RIP' | 'CLEAN' | 'SPLASH' | 'FLAT';
export type Phase = 'air' | 'bed' | 'stun' | 'water' | 'over';
type Pose = 'open' | 'tuck' | 'pike';

export type BounceEvent =
  | { t: number; type: 'launch'; spin: number; bank: boolean; height: number }
  | { t: number; type: 'tuck' | 'pike' | 'open' | 'twist' | 'stick' }
  | { t: number; type: 'land'; grade: Grade; trick: Trick; points: number; errDeg: number }
  | { t: number; type: 'bail'; lost: number; reason: string }
  | { t: number; type: 'entry'; grade: EntryGrade; trick: Trick; banked: number; lost: number; errDeg: number; x: number; speed: number }
  | { t: number; type: 'respawn' }
  | { t: number; type: 'over'; score: number; lost: number };

/** wrap an angle to (-PI, PI] */
const wrap = (a: number) => a - TAU * Math.round(a / TAU);

export class BounceSim {
  tick = 0;
  phase: Phase = 'air';
  x = TRAMP_X;
  y = STAND_Y + BASE_H;
  vx = 0;
  vy = 0;
  theta = 0;
  L = 0;
  j: Joints = { ...POSES.openFeet };
  jv: Joints = { s: 0, e: 0, h: 0, k: 0, a: 0 };
  frame: BodyFrame = bodyFrame(this.j);
  pose: Pose = 'open';
  psi = 0;
  queuedHalfTwists = 0;
  /** the diver looks at the pool (towards -x) */
  readonly facing: 1 | -1 = -1;
  /** apex of the next bounce above STAND_Y */
  height = BASE_H;
  bank = false;
  timeLeft = RUN_TIME;
  score = 0;
  readonly combo = new Combo();
  events: BounceEvent[] = [];
  /** ACTION near contact is a stick / rip now */
  armed = false;

  private prevInput = 0;
  private phaseTime = 0;
  private flightTime = 0;
  private launchAxis = 0;
  private launchHalfTwists = 0;
  private launchDir: 1 | -1 = 1;
  private stickT = Number.NaN;
  private tuckTime = 0;
  private pikeTime = 0;
  private stunDir = 1;

  get t(): number {
    return this.tick * DT;
  }

  get inertia(): number {
    return inertiaOfFrame(this.frame);
  }

  get omega(): number {
    return this.phase === 'air' ? this.L / this.inertia : 0;
  }

  /** body long axis (ankle to head), unwrapped */
  get axisAngle(): number {
    const sg = Math.cos(this.psi) >= 0 ? this.facing : -this.facing;
    return this.theta + sg * axisDir(this.frame);
  }

  get facingNow(): 1 | -1 {
    return (Math.cos(this.psi) >= 0 ? this.facing : -this.facing) as 1 | -1;
  }

  get halfTwistsDone(): number {
    return Math.floor(this.psi / Math.PI + 1e-6);
  }

  snapshot(): RenderState {
    return { x: this.x, y: this.y, theta: this.theta, j: { ...this.j }, psi: this.psi, facing: this.facing };
  }

  toWorld(p: readonly [number, number]): [number, number] {
    const xs = this.facing * Math.cos(this.psi);
    const lx = (p[0] - this.frame.com[0]) * xs;
    const ly = p[1] - this.frame.com[1];
    const c = Math.cos(this.theta);
    const s = Math.sin(this.theta);
    return [this.x + lx * c + ly * s, this.y - lx * s + ly * c];
  }

  lowestPoint(): number {
    const f = this.frame;
    let m = Infinity;
    for (const p of [f.headTop, f.hand, f.toe, f.ankle, f.knee, f.hip]) m = Math.min(m, this.toWorld(p)[1]);
    return m;
  }

  /** time until the feet touch the bed, or the body touches the water */
  timeToContact(): number {
    if (this.phase !== 'air') return 0;
    if (!this.bank) return timeToHeight(this.y, this.vy, STAND_Y);
    return timeToHeight(this.y, this.vy, this.y - this.lowestPoint());
  }

  /** target of the landing: upright on the bed, nearest vertical in the pool */
  private targetStep(): number {
    return this.bank ? Math.PI : TAU;
  }

  /**
   * Landing line: angle error (deg) at contact if the diver opened now. Runs
   * the joint controllers and the rotation forward, like the tower's entry line.
   */
  predictError(): number {
    const n = Math.round(this.timeToContact() / DT);
    const target = this.openPose();
    const j = { ...this.j };
    const jv = { ...this.jv };
    let theta = this.theta;
    let f = this.frame;
    for (let i = 0; i < n; i++) {
      pdStep(j, jv, target);
      f = bodyFrame(j);
      const w = this.L / inertiaOfFrame(f);
      theta += w * DT;
      if (Math.abs(jv.h) + Math.abs(jv.k) + Math.abs(jv.s) < 1e-3 && Math.abs(j.h - target.h) < 1e-3) {
        // settled: the rate stays constant until contact
        theta += w * DT * (n - 1 - i);
        break;
      }
    }
    const sg = Math.cos(this.psi) >= 0 ? this.facing : -this.facing;
    const a = theta + sg * axisDir(f);
    const step = this.targetStep();
    return (a - step * Math.round(a / step)) * DEG;
  }

  private openPose(): Joints {
    if (!this.bank) return POSES.openFeet;
    // into the pool: arms over the head when the entry will be head first
    const a = this.axisAngle + (this.L / inertiaOfFrame(this.frame)) * this.timeToContact();
    const halves = Math.round(a / Math.PI);
    return Math.abs(halves) % 2 === 1 ? POSES.openHead : POSES.openFeet;
  }

  private emit(e: BounceEvent): void {
    this.events.push(e);
  }

  step(input: number): void {
    const pressed = input & ~this.prevInput;
    this.prevInput = input;
    this.phaseTime += DT;
    if (this.phase !== 'over') this.timeLeft = Math.max(0, this.timeLeft - DT);
    switch (this.phase) {
      case 'air':
        this.stepAir(input, pressed);
        break;
      case 'bed':
        this.stepBed(input);
        break;
      case 'stun':
        this.stepStun();
        break;
      case 'water':
        this.stepWater();
        break;
      case 'over':
        break;
    }
    this.tick++;
  }

  private setPhase(p: Phase): void {
    this.phase = p;
    this.phaseTime = 0;
  }

  private stepJoints(target: Joints): void {
    pdStep(this.j, this.jv, target);
    this.frame = bodyFrame(this.j);
  }

  private stepBed(input: number): void {
    const u = Math.min(1, this.phaseTime / BED_TIME);
    this.y = STAND_Y - BED_DIP * Math.sin(Math.PI * u);
    this.vy = 0;
    // the bed straightens the body up
    const err = wrap(this.axisAngle);
    this.theta -= err * Math.min(1, 14 * DT);
    this.stepJoints(u < 0.5 ? BED_POSE : POSES.openFeet);
    if (u >= 1) this.launch(input);
  }

  private launch(input: number): void {
    const spin = (input & IN.RIGHT ? 1 : 0) - (input & IN.LEFT ? 1 : 0);
    this.bank = (input & IN.DOWN) !== 0;
    this.vy = Math.sqrt(2 * GRAVITY * this.height);
    this.vx = this.bank ? BANK_VX : 0;
    this.L = spin * L_SPIN;
    // forward when the head moves the way the diver faces
    this.launchDir = (spin === 0 || spin === this.facingNow ? 1 : -1) as 1 | -1;
    this.startFlight();
    this.emit({ t: this.t, type: 'launch', spin, bank: this.bank, height: this.height });
  }

  private startFlight(): void {
    this.setPhase('air');
    this.flightTime = 0;
    this.launchAxis = this.axisAngle;
    this.launchHalfTwists = this.halfTwistsDone;
    this.queuedHalfTwists = this.halfTwistsDone;
    this.stickT = Number.NaN;
    this.armed = false;
    this.tuckTime = 0;
    this.pikeTime = 0;
    this.pose = 'open';
  }

  private stepAir(input: number, pressed: number): void {
    this.flightTime += DT;
    const ttc = this.timeToContact();
    if (!this.armed && this.pose === 'open' && this.vy < 0 && ttc <= ARM_TIME && this.flightTime > 0.2) this.armed = true;
    if (this.armed) {
      if (pressed & IN.ACTION && Number.isNaN(this.stickT)) {
        this.stickT = this.t;
        this.emit({ t: this.t, type: 'stick' });
      }
    } else {
      const want: Pose = input & IN.ACTION ? (input & IN.DOWN ? 'pike' : 'tuck') : 'open';
      if (want !== this.pose) {
        this.pose = want;
        this.emit({ t: this.t, type: want });
      }
    }
    if (this.pose === 'tuck') this.tuckTime += DT;
    if (this.pose === 'pike') this.pikeTime += DT;
    if (pressed & IN.UP && this.queuedHalfTwists < this.halfTwistsDone + 4) this.queuedHalfTwists++;

    let target = this.pose === 'open' ? this.openPose() : POSES[this.pose];
    // ←/→ trim the spin with the arms, as on the tower: against the spin
    // raises them (slower), with the spin lowers them (faster)
    const dir = (input & IN.RIGHT ? 1 : 0) - (input & IN.LEFT ? 1 : 0);
    const trim = this.armed || this.L === 0 || this.pose !== 'open' ? 0 : dir * Math.sign(this.L);
    if (trim !== 0) target = { ...target, s: trim > 0 ? Math.max(0, target.s - TRIM_ARMS) : Math.min(Math.PI, target.s + TRIM_ARMS) };
    this.stepJoints(target);

    const targetPsi = this.queuedHalfTwists * Math.PI;
    if (this.psi < targetPsi - 1e-9 && this.j.h < 0.35 && this.j.k < 0.35) {
      const before = this.halfTwistsDone;
      this.psi = Math.min(targetPsi, this.psi + TWIST_W * DT);
      if (this.halfTwistsDone > before) this.emit({ t: this.t, type: 'twist' });
    }

    this.theta += (this.L / this.inertia) * DT;
    this.vy -= GRAVITY * DT;
    this.x += this.vx * DT;
    this.y += this.vy * DT;

    if (!this.bank && this.vy < 0 && this.y <= STAND_Y) this.land();
    else if (this.bank && this.lowestPoint() <= 0) this.enterWater();
  }

  private position(): TrickPos {
    if (Math.max(this.tuckTime, this.pikeTime) < 0.15) return 'straight';
    return this.pikeTime > this.tuckTime ? 'pike' : 'tuck';
  }

  private trick(step: number): Trick {
    return {
      turns: Math.round(Math.abs(this.axisAngle - this.launchAxis) / step),
      pos: this.position(),
      halfTwists: this.halfTwistsDone - this.launchHalfTwists,
      dir: this.launchDir,
      pool: this.bank,
    };
  }

  private land(): void {
    this.y = STAND_Y;
    this.vy = 0;
    const errDeg = wrap(this.axisAngle) * DEG;
    const a = Math.abs(errDeg);
    const bent = this.j.h > 1.0;
    const twisting = this.psi - this.halfTwistsDone * Math.PI > 0.05;
    const stick = this.t - this.stickT;
    const stuck = stick >= 0 && stick <= STICK_WINDOW;
    const trick = this.trick(TAU);
    if (bent || a > BAIL_DEG) {
      this.bail(bent ? 'Lądowanie w kuczce' : 'Upadek');
      this.stunDir = errDeg >= 0 ? 1 : -1;
      return;
    }
    const grade: Grade = a <= PERFECT_DEG && stuck && !twisting ? 'PERFECT' : a <= GOOD_DEG && !twisting ? 'GOOD' : 'SLOPPY';
    const points = this.combo.add(trick, grade === 'SLOPPY' ? 0.5 : 1);
    this.height = Math.min(MAX_H, Math.max(BASE_H, this.height * GAIN[grade]));
    if (grade === 'PERFECT' && isTrick(trick) && this.timeLeft > 0) this.timeLeft += TIME_BONUS;
    this.emit({ t: this.t, type: 'land', grade, trick, points, errDeg });
    if (this.timeLeft <= 0) this.endRun();
    else this.setPhase('bed');
  }

  private bail(reason: string): void {
    const lost = this.combo.value(1);
    this.combo.clear();
    this.height = BASE_H;
    this.L = 0;
    this.emit({ t: this.t, type: 'bail', lost, reason });
    this.setPhase('stun');
  }

  private stepStun(): void {
    // flat on the bed, then back up
    const down = this.phaseTime < STUN_TIME * 0.6;
    const want = down ? this.stunDir * (Math.PI / 2) : 0;
    const err = wrap(this.axisAngle - want);
    this.theta -= err * Math.min(1, 10 * DT);
    this.y += ((down ? BED_Y + 0.22 : STAND_Y) - this.y) * Math.min(1, 10 * DT);
    this.stepJoints(POSES.openFeet);
    if (this.phaseTime >= STUN_TIME) {
      if (this.timeLeft <= 0) this.endRun();
      else this.setPhase('bed');
    }
  }

  private enterWater(): void {
    const step = Math.PI;
    const errDeg = (((this.axisAngle % step) + step * 1.5) % step - step / 2) * DEG;
    const a = Math.abs(errDeg);
    const bent = this.j.h > 1.0;
    const rip = this.t - this.stickT;
    const trick = this.trick(step);
    let grade: EntryGrade;
    let mult = 1;
    if (bent || a > FLAT_DEG) grade = 'FLAT';
    else if (a > CLEAN_DEG) {
      grade = 'SPLASH';
      mult = 0.5;
    } else if (rip >= 0 && rip <= RIP_PERFECT) {
      grade = 'RIP';
      mult = 2;
    } else {
      grade = 'CLEAN';
      mult = rip > RIP_PERFECT && rip <= RIP_GOOD ? 1.5 : 1;
    }
    let banked = 0;
    let lost = 0;
    if (grade === 'FLAT') lost = this.combo.value(1);
    else {
      this.combo.add(trick);
      banked = this.combo.value(mult);
      this.score += banked;
    }
    this.combo.clear();
    const speed = Math.hypot(this.vx, this.vy);
    this.emit({ t: this.t, type: 'entry', grade, trick, banked, lost, errDeg, x: this.x, speed });
    this.setPhase('water');
    this.L *= grade === 'FLAT' ? 0.2 : 1;
  }

  private stepWater(): void {
    const sp = Math.hypot(this.vx, this.vy);
    if (sp > 1e-6) {
      const dv = Math.min(sp, (0.9 * sp * sp + sp) * DT);
      this.vx -= (this.vx / sp) * dv;
      this.vy -= (this.vy / sp) * dv;
    }
    if (this.y < -0.3) this.vy += 0.8 * DT;
    this.L -= this.L * Math.min(1, 14 * DT);
    this.theta += (this.L / this.inertia) * DT;
    this.x += this.vx * DT;
    this.y += this.vy * DT;
    this.stepJoints(this.openPose());
    if (this.phaseTime >= WATER_TIME) {
      if (this.timeLeft <= 0) this.endRun();
      else this.respawn();
    }
  }

  private respawn(): void {
    this.x = TRAMP_X;
    this.y = STAND_Y + BASE_H;
    this.vx = 0;
    this.vy = 0;
    this.L = 0;
    this.psi = 0;
    this.j = { ...POSES.openFeet };
    this.jv = { s: 0, e: 0, h: 0, k: 0, a: 0 };
    this.frame = bodyFrame(this.j);
    this.theta -= TAU * Math.round(this.theta / TAU);
    this.theta -= wrap(this.axisAngle);
    this.height = BASE_H;
    this.bank = false;
    this.startFlight();
    this.emit({ t: this.t, type: 'respawn' });
  }

  private endRun(): void {
    const lost = this.combo.value(1);
    this.combo.clear();
    this.setPhase('over');
    this.emit({ t: this.t, type: 'over', score: this.score, lost });
  }
}
