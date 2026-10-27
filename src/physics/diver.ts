// Deterministic diver simulation.
//
// Fixed 120 Hz step. The centre of mass flies ballistically, the angular
// momentum L is set at take-off and stays constant in the air, and the body
// rotation rate is omega = L / I(pose). The player only changes the shape of
// the body (joint targets driven by PD controllers); rotation speeds up and
// slows down on its own.
//
// World frame: metres, x grows away from the tower (platform edge at x = 0),
// y up, water surface at y = 0. Angles are clockwise from "up".

import {
  axisDir,
  bodyFrame,
  inertiaOfFrame,
  JOINT_NAMES,
  POSES,
  type BodyFrame,
  type Joints,
  type PoseName,
} from './body';
import type { DiveSpec } from '../levels/diveCode';

export const SIM_HZ = 120;
export const DT = 1 / SIM_HZ;
/** Game gravity: lower than 9.81 m/s² so a 10 m dive lasts long enough for 8-bit reflexes. */
export const GRAVITY = 6.5;

export const IN = { ACTION: 1, UP: 2, DOWN: 4, LEFT: 8, RIGHT: 16 } as const;

/** PD natural frequency of the joints: critically damped, ~160 ms to settle. */
export const JOINT_WN = 30;
export const PUSH_TIME = 0.1;
/** take-off vertical speed for a perfect release */
export const TAKEOFF_VY = 3.2;
/** horizontal speed: rotating away from / towards the tower */
export const TAKEOFF_VX_AWAY = 1.1;
export const TAKEOFF_VX_TOWARDS = 1.4;
/** power ring: triangle wave period (s) and gold zone centre */
export const POWER_PERIOD = 1.5;
export const ZONE_CENTER = 0.8;
/** time of one half twist */
export const HALF_TWIST_TIME = 0.15;
/** the entry line shows up after this fraction of the flight */
export const LINE_FROM = 0.4;
/** within this time to contact an ACTION press is a rip attempt, not a tuck */
export const RIP_ARM = 0.3;
export const RIP_PERFECT = 0.12;
export const RIP_GOOD = 0.17;
export const RIP_LATE = 0.03;
export const SAVE_WINDOW = 0.2;
export const SAVE_DEG = 4;
export const FLAT_DEG = 40;
export const LINE_GREEN_DEG = 5;
export const ASSIST_SWITCH = 0.14;
const ASSIST_ARMS_LOW = 0.02;
const ASSIST_ARMS_HIGH = Math.PI;
const DEG = 180 / Math.PI;

export const TOWER = {
  /** platform slab thickness */
  slab: 0.35,
  /** platform reaches this far from the tower column */
  overhang: 1.6,
  depth: 3.5,
} as const;

export type Phase = 'ready' | 'charge' | 'push' | 'flight' | 'water' | 'done';
export type Timing = 'PERFECT' | 'GOOD' | 'EARLY' | 'LATE' | 'NONE';
export type FlightPose = 'open' | 'tuck' | 'pike';

export type EventType =
  | 'charge'
  | 'release'
  | 'takeoff'
  | 'tuck'
  | 'pike'
  | 'open'
  | 'twist'
  | 'rip'
  | 'save'
  | 'entry'
  | 'crash'
  | 'surface';

export interface SimEvent {
  t: number;
  type: EventType;
  label?: Timing;
  value?: number;
}

export interface DiveSetup {
  dive: DiveSpec;
  /** platform height (m) */
  height: number;
  /** width of the gold zone in power units */
  zoneWidth: number;
  /** synchro: the power ring follows the clock and hits the zone centre at this time (s) */
  hepTime?: number;
  /** precomputed ideal angular momentum magnitude (computed when missing) */
  idealL?: number;
  /**
   * Arm assist (off in Pro mode): after opening, the diver keeps the arms
   * low (head-first) or high (feet-first) for a while, which changes I and
   * so the rotation speed, to steer towards a vertical entry.
   */
  assist?: boolean;
}

export interface Takeoff {
  power: number;
  label: Timing;
  /** signed distance from the gold zone (0 inside) */
  error: number;
  vx: number;
  vy: number;
  L: number;
}

export interface EntryResult {
  t: number;
  /** signed entry angle error in degrees, positive = over-rotated */
  angleErr: number;
  /** rotation speed at contact (deg/s) */
  omega: number;
  rip: Timing;
  /** contact time minus press time (s), NaN if no press */
  ripDelta: number;
  /** body straightness at contact (0 = perfectly straight) */
  bend: number;
  /** seconds between the last opening and contact */
  openTime: number;
  halfTwistsDone: number;
  twistInProgress: boolean;
  /** horizontal distance from the platform edge at contact (m) */
  distance: number;
  /** smallest distance to the platform during the flight (m) */
  clearance: number;
  /** highest point of the centre of mass above take-off (m) */
  height: number;
  flat: boolean;
  tuckEntry: boolean;
  saveUsed: boolean;
  /** time spent tucked / piked in the air (s) */
  tuckTime: number;
  pikeTime: number;
  /** 0..1, how big the splash is */
  splash: number;
}

export interface RenderState {
  x: number;
  y: number;
  theta: number;
  j: Joints;
  /** twist angle */
  psi: number;
  facing: 1 | -1;
}

const TWIST_W = Math.PI / HALF_TWIST_TIME;

function tri(u: number): number {
  const f = u - Math.floor(u);
  return 1 - Math.abs(f * 2 - 1);
}

function zeroJoints(): Joints {
  return { s: 0, e: 0, h: 0, k: 0, a: 0 };
}

const OPEN_HEAD_F = bodyFrame(POSES.openHead);
const OPEN_FEET_F = bodyFrame(POSES.openFeet);
/** distance from the centre of mass to the leading point for a vertical open body */
export const OPEN_REACH_HEAD = OPEN_HEAD_F.hand[1] - OPEN_HEAD_F.com[1];
export const OPEN_REACH_FEET = OPEN_FEET_F.com[1] - OPEN_FEET_F.toe[1];

/** ballistic time until the centre of mass falls to height `h` */
export function timeToHeight(y: number, vy: number, h: number, g = GRAVITY): number {
  const d = vy * vy + 2 * g * (y - h);
  if (d <= 0) return 0;
  return Math.max(0, (vy + Math.sqrt(d)) / g);
}

const idealCache = new Map<string, number>();

export class DiverSim {
  readonly setup: DiveSetup;
  readonly dive: DiveSpec;
  readonly idealL: number;
  tick = 0;
  phase: Phase = 'ready';
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  theta = 0;
  L = 0;
  j: Joints = { ...POSES.stand };
  jv: Joints = zeroJoints();
  pose: FlightPose | 'stand' | 'crouch' = 'stand';
  psi = 0;
  queuedHalfTwists = 0;
  events: SimEvent[] = [];
  takeoff: Takeoff | null = null;
  entry: EntryResult | null = null;
  crashed = false;
  frame: BodyFrame;
  /** how much the arm assist is steering right now (0..1) */
  assistArms = 0;
  /** body angle samples (30 Hz) for synchronisation */
  trace: number[] = [];

  private prevInput = 0;
  private holdTime = 0;
  private phaseTime = 0;
  private flightTime = 0;
  private lastOpenT = 0;
  private ripPressT = Number.NaN;
  private ripLocked = false;
  private saveUsed = false;
  private saveLeft = 0;
  private saveDir = 0;
  private maxY = -Infinity;
  private takeoffY = 0;
  private clearance = Infinity;
  private tuckTime = 0;
  private pikeTime = 0;
  /** expected flight time from take-off to contact (s) */
  flightDuration = 2;
  private readonly probe: number;
  private readonly anchorX: number;
  private readonly anchorY: number;

  constructor(setup: DiveSetup, opts: { probeL?: number } = {}) {
    this.setup = setup;
    this.dive = setup.dive;
    this.probe = opts.probeL ?? 0;
    this.idealL = this.probe ? this.probe : setup.idealL ?? idealAngularMomentum(setup);
    this.anchorX = this.dive.facing === 1 ? -0.21 : -0.04;
    this.anchorY = setup.height + 0.06;
    this.frame = bodyFrame(this.j);
    this.placeOnPlatform();
  }

  get t(): number {
    return this.tick * DT;
  }

  get facingNow(): 1 | -1 {
    return (Math.cos(this.psi) >= 0 ? this.dive.facing : -this.dive.facing) as 1 | -1;
  }

  get inertia(): number {
    return inertiaOfFrame(this.frame);
  }

  get omega(): number {
    return this.phase === 'flight' ? this.L / this.inertia : 0;
  }

  /** power of the take-off ring right now (0..1) */
  get power(): number {
    if (this.phase !== 'charge' && this.phase !== 'ready') return 0;
    if (this.setup.hepTime !== undefined) {
      const ready = Math.min(1, this.holdTime / 0.3);
      return tri(0.4 + (this.t - this.setup.hepTime) / POWER_PERIOD) * ready;
    }
    return tri(this.holdTime / POWER_PERIOD);
  }

  get powerRising(): boolean {
    if (this.setup.hepTime !== undefined) {
      const u = 0.4 + (this.t - this.setup.hepTime) / POWER_PERIOD;
      return u - Math.floor(u) < 0.5;
    }
    const u = this.holdTime / POWER_PERIOD;
    return u - Math.floor(u) < 0.5;
  }

  get zone(): [number, number] {
    const w = this.setup.zoneWidth;
    return [ZONE_CENTER - w / 2, ZONE_CENTER + w / 2];
  }

  /** fraction of the expected flight completed (0..1) */
  get flightProgress(): number {
    return this.phase === 'flight' ? Math.min(1, this.flightTime / this.flightDuration) : 0;
  }

  get entryPose(): Joints {
    return this.dive.headFirst ? POSES.openHead : POSES.openFeet;
  }

  get lineVisible(): boolean {
    return this.phase === 'flight' && this.flightProgress >= LINE_FROM && !this.crashed;
  }

  /** the body's long axis in world terms, unwrapped (accumulated rotation) */
  get axisAngle(): number {
    const sg = Math.cos(this.psi) >= 0 ? this.dive.facing : -this.dive.facing;
    return this.theta + sg * axisDir(this.frame);
  }

  /** target long-axis angle at contact */
  get targetAngle(): number {
    return this.dive.rot * this.dive.halfSoms * Math.PI;
  }

  /** signed rotation error in degrees (positive = over-rotated) */
  rotationError(axis = this.axisAngle): number {
    return this.dive.rot * (axis - this.targetAngle) * DEG;
  }

  /** time until the leading point touches the water, for the current shape */
  timeToContact(): number {
    if (this.phase !== 'flight') return 0;
    const minY = this.lowestPoint();
    return timeToHeight(this.y, this.vy, this.y - minY);
  }

  /**
   * Entry line: rotation error at contact if the diver opened right now.
   * Runs the same joint controllers and rotation integration forward.
   */
  predictEntryError(): number {
    return this.predict(null);
  }

  /**
   * Forward prediction of the rotation error at contact for an open body.
   * `altArms`: shoulder angle held until ASSIST_SWITCH before contact.
   */
  private predict(altArms: number | null): number {
    const reach = this.dive.headFirst ? OPEN_REACH_HEAD : OPEN_REACH_FEET;
    const tRem = timeToHeight(this.y, this.vy, reach);
    const n = Math.round(tRem / DT);
    const nSwitch = Math.round((tRem - ASSIST_SWITCH) / DT);
    const j = { ...this.j };
    const jv = { ...this.jv };
    const entry = this.entryPose;
    const alt = altArms === null ? entry : { ...entry, s: altArms };
    let theta = this.theta;
    let f = this.frame;
    for (let i = 0; i < n; i++) {
      pdStep(j, jv, i < nSwitch ? alt : entry);
      f = bodyFrame(j);
      theta += (this.L / inertiaOfFrame(f)) * DT;
    }
    const sg = Math.cos(this.psi) >= 0 ? this.dive.facing : -this.dive.facing;
    return this.rotationError(theta + sg * axisDir(f));
  }

  /** range of entry errors the arm assist can still fix: [errArmsEntry, errArmsAlt] */
  assistRange(): [number, number] {
    const base = this.predict(null);
    if (!this.setup.assist) return [base, base];
    return [base, this.predict(this.dive.headFirst ? ASSIST_ARMS_LOW : ASSIST_ARMS_HIGH)];
  }

  snapshot(): RenderState {
    return { x: this.x, y: this.y, theta: this.theta, j: { ...this.j }, psi: this.psi, facing: this.dive.facing };
  }

  /** world position of a point given in the local body frame */
  toWorld(p: readonly [number, number], out: [number, number] = [0, 0]): [number, number] {
    const xs = this.dive.facing * Math.cos(this.psi);
    const lx = (p[0] - this.frame.com[0]) * xs;
    const ly = p[1] - this.frame.com[1];
    const c = Math.cos(this.theta);
    const s = Math.sin(this.theta);
    out[0] = this.x + lx * c + ly * s;
    out[1] = this.y - lx * s + ly * c;
    return out;
  }

  keyPoints(): [number, number][] {
    const f = this.frame;
    const elbow: [number, number] = [f.seg.forearm.px, f.seg.forearm.py];
    return [f.headTop, f.hand, elbow, f.toe, f.ankle, f.knee, f.shoulder, f.hip].map((p) => this.toWorld(p));
  }

  lowestPoint(): number {
    let m = Infinity;
    for (const p of this.keyPoints()) m = Math.min(m, p[1]);
    return m;
  }

  private emit(type: EventType, label?: Timing, value?: number): void {
    const e: SimEvent = { t: this.t, type };
    if (label) e.label = label;
    if (value !== undefined) e.value = value;
    this.events.push(e);
  }

  private placeOnPlatform(): void {
    const f = this.frame;
    const footDir = f.seg.foot.dir;
    this.theta = this.dive.facing * (Math.PI / 2 - footDir);
    // pin the ankle to the platform
    const xs = this.dive.facing;
    const lx = (f.ankle[0] - f.com[0]) * xs;
    const ly = f.ankle[1] - f.com[1];
    const c = Math.cos(this.theta);
    const s = Math.sin(this.theta);
    this.x = this.anchorX - (lx * c + ly * s);
    this.y = this.anchorY - (-lx * s + ly * c);
  }

  step(input: number): void {
    const pressed = input & ~this.prevInput;
    const released = ~input & this.prevInput;
    this.prevInput = input;
    this.phaseTime += DT;

    switch (this.phase) {
      case 'ready':
        if (pressed & IN.ACTION) {
          this.phase = 'charge';
          this.phaseTime = 0;
          this.holdTime = 0;
          this.emit('charge');
        }
        this.stepJoints(POSES.stand);
        this.placeOnPlatform();
        break;
      case 'charge': {
        this.holdTime += DT;
        if (released & IN.ACTION || this.probe) {
          if (!this.probe || this.holdTime >= 0.3) {
            this.release();
            break;
          }
        }
        this.stepJoints(POSES.crouch);
        this.placeOnPlatform();
        break;
      }
      case 'push':
        // legs extend with the feet still flat on the platform
        this.stepJoints({ ...this.entryPose, a: Math.PI / 2 });
        if (this.phaseTime >= PUSH_TIME) {
          this.leavePlatform();
        } else {
          this.placeOnPlatform();
        }
        break;
      case 'flight':
        this.stepFlight(input, pressed);
        break;
      case 'water':
        this.stepWater(pressed);
        break;
      case 'done':
        break;
    }
    this.tick++;
  }

  private release(): void {
    const p = this.probe ? ZONE_CENTER : this.power;
    const rising = this.probe ? true : this.powerRising;
    const [lo, hi] = this.zone;
    let error = 0;
    if (p < lo) error = p - lo;
    else if (p > hi) error = p - hi;
    let label: Timing = 'PERFECT';
    if (error !== 0) {
      if (Math.abs(error) < 0.05) label = 'GOOD';
      else if (error > 0) label = 'LATE';
      else label = rising ? 'EARLY' : 'LATE';
    }
    const towards = this.dive.rot === -1;
    const vx0 = towards ? TAKEOFF_VX_TOWARDS : TAKEOFF_VX_AWAY;
    this.takeoff = {
      power: p,
      label,
      error,
      vy: TAKEOFF_VY * (1 + 0.5 * Math.min(error, 0.06)),
      vx: vx0 * (1 + 0.8 * error),
      L: this.dive.rot * this.idealL * (1 + 1.1 * error),
    };
    this.phase = 'push';
    this.phaseTime = 0;
    this.emit('release', label, error);
  }

  private leavePlatform(): void {
    const tk = this.takeoff!;
    this.phase = 'flight';
    this.phaseTime = 0;
    this.flightTime = 0;
    this.vx = tk.vx;
    this.vy = tk.vy;
    this.L = tk.L;
    this.pose = 'open';
    this.lastOpenT = this.t;
    this.takeoffY = this.y;
    this.maxY = this.y;
    const reach = this.dive.headFirst ? OPEN_REACH_HEAD : OPEN_REACH_FEET;
    this.flightDuration = timeToHeight(this.y, this.vy, reach);
    this.emit('takeoff', tk.label, tk.error);
  }

  private stepJoints(target: Joints): void {
    pdStep(this.j, this.jv, target);
    this.frame = bodyFrame(this.j);
  }

  private stepFlight(input: number, pressed: number): void {
    this.flightTime += DT;
    const ttc = this.timeToContact();
    const opened = this.pose === 'open';
    // rip window: ACTION presses near the water are a flat-hand grab, not a tuck
    if (!this.ripLocked && opened && ttc <= RIP_ARM && this.flightTime > 0.2) this.ripLocked = true;
    if (this.ripLocked) {
      if (pressed & IN.ACTION && Number.isNaN(this.ripPressT)) {
        this.ripPressT = this.t;
        this.emit('rip');
      }
    } else {
      let want: FlightPose = 'open';
      if (input & IN.ACTION) want = input & IN.DOWN ? 'pike' : 'tuck';
      if (want !== this.pose) {
        this.pose = want;
        if (want === 'open') this.lastOpenT = this.t;
        this.emit(want);
      }
    }
    if (this.pose === 'tuck') this.tuckTime += DT;
    if (this.pose === 'pike') this.pikeTime += DT;

    if (pressed & IN.UP && this.queuedHalfTwists < 9) this.queuedHalfTwists++;

    if (!this.saveUsed && ttc <= SAVE_WINDOW && pressed & (IN.LEFT | IN.RIGHT)) {
      this.saveUsed = true;
      this.saveDir = pressed & IN.RIGHT ? 1 : -1;
      this.saveLeft = 0.1;
      this.emit('save', undefined, this.saveDir);
    }

    let target = this.pose === 'open' ? this.entryPose : POSES[this.pose as PoseName];
    this.assistArms = 0;
    if (this.setup.assist && this.pose === 'open' && this.flightProgress >= LINE_FROM && ttc > ASSIST_SWITCH) {
      const [eEntry, eAlt] = this.assistRange();
      let u = 0;
      if (this.dive.headFirst && eEntry < 0 && eAlt > eEntry) u = -eEntry / (eAlt - eEntry);
      if (!this.dive.headFirst && eEntry > 0 && eAlt < eEntry) u = eEntry / (eEntry - eAlt);
      u = Math.min(1, Math.max(0, u));
      if (u > 0) {
        const alt = this.dive.headFirst ? ASSIST_ARMS_LOW : ASSIST_ARMS_HIGH;
        target = { ...target, s: target.s + (alt - target.s) * u };
        this.assistArms = u;
      }
    }
    this.stepJoints(target);

    // twists: only with an open body, around the long axis
    const targetPsi = this.queuedHalfTwists * Math.PI;
    if (this.psi < targetPsi - 1e-9 && this.j.h < 0.35 && this.j.k < 0.35) {
      const before = Math.floor(this.psi / Math.PI + 1e-9);
      this.psi = Math.min(targetPsi, this.psi + TWIST_W * DT);
      if (Math.abs(this.psi - before * Math.PI) <= TWIST_W * DT + 1e-9 && this.psi > before * Math.PI) {
        this.emit('twist', undefined, before + 1);
      }
    }

    this.theta += (this.L / this.inertia) * DT;
    if (this.saveLeft > 0) {
      const dt = Math.min(DT, this.saveLeft);
      this.theta += (this.saveDir * (SAVE_DEG / DEG) * dt) / 0.1;
      this.saveLeft -= dt;
    }

    this.vy -= GRAVITY * DT;
    this.x += this.vx * DT;
    this.y += this.vy * DT;
    this.maxY = Math.max(this.maxY, this.y);
    if (this.tick % 4 === 0) this.trace.push(this.axisAngle);

    // platform collision
    const pts = this.keyPoints();
    const top = this.setup.height;
    if (!this.probe) {
      for (let i = 0; i < pts.length; i++) {
        const [px, py] = pts[i]!;
        const isFoot = i === 3 || i === 4;
        if (isFoot && this.flightTime < 0.25) continue;
        if (px < 0) {
          const inSlab = py < top && py > top - TOWER.slab;
          const inColumn = px < -TOWER.overhang && py < top;
          if (inSlab || inColumn) {
            this.crash();
            return;
          }
        }
        if (this.flightTime >= 0.25) {
          const d = px >= 0 ? Math.hypot(px, Math.max(0, py - top)) : Math.max(0, py - top);
          this.clearance = Math.min(this.clearance, d);
        }
      }
    }

    let minY = Infinity;
    for (const p of pts) minY = Math.min(minY, p[1]);
    if (minY <= 0) this.enterWater();
  }

  private crash(): void {
    this.crashed = true;
    this.emit('crash');
    this.finishEntry(true);
    this.phase = 'water';
    this.phaseTime = 0;
  }

  private enterWater(): void {
    this.finishEntry(false);
    this.phase = 'water';
    this.phaseTime = 0;
  }

  private finishEntry(crashed: boolean): void {
    const err = this.rotationError();
    const bend = Math.abs(this.j.h) + Math.abs(this.j.k) * 0.6 + Math.abs(this.entryPose.s - this.j.s) * 0.25;
    const tuckEntry = this.j.h > 1.2;
    const flat = !crashed && Math.abs(err) > FLAT_DEG;
    const done = Math.floor(this.psi / Math.PI + 1e-6);
    this.entry = {
      t: this.t,
      angleErr: err,
      omega: Math.abs(this.omega) * DEG,
      rip: 'NONE',
      ripDelta: Number.NaN,
      bend,
      openTime: this.pose === 'open' ? this.t - this.lastOpenT : 0,
      halfTwistsDone: done,
      twistInProgress: this.psi - done * Math.PI > 0.05,
      distance: this.x,
      clearance: this.clearance === Infinity ? 5 : this.clearance,
      height: this.maxY - this.takeoffY,
      flat,
      tuckEntry,
      saveUsed: this.saveUsed,
      tuckTime: this.tuckTime,
      pikeTime: this.pikeTime,
      splash: 1,
    };
    if (!crashed) {
      this.resolveRip();
      this.emit('entry', this.entry.rip, err);
    }
  }

  private resolveRip(late = false): void {
    const e = this.entry!;
    if (!Number.isNaN(this.ripPressT)) {
      const d = e.t - this.ripPressT;
      e.ripDelta = d;
      if (d >= 0 && d <= RIP_PERFECT) e.rip = 'PERFECT';
      else if ((d > RIP_PERFECT && d <= RIP_GOOD) || (d < 0 && d >= -RIP_LATE)) e.rip = 'GOOD';
      else if (d > RIP_GOOD) e.rip = 'EARLY';
      else e.rip = 'LATE';
    } else if (late) {
      e.rip = 'LATE';
    }
    e.splash = splashSize(e);
  }

  private stepWater(pressed: number): void {
    const e = this.entry!;
    // a press shortly after contact still counts as a (late) rip
    if (!this.crashed && e.rip === 'NONE' && Number.isNaN(this.ripPressT) && pressed & IN.ACTION && this.phaseTime <= 0.12) {
      this.ripPressT = this.t;
      e.ripDelta = e.t - this.t;
      this.resolveRip(true);
      this.emit('rip', 'LATE');
    }
    if (this.crashed && this.y > 0) {
      // falling after hitting the platform
      this.vy -= GRAVITY * DT;
      this.vx *= 0.995;
    } else {
      const drag = 5;
      this.vx -= this.vx * drag * DT;
      this.vy -= this.vy * drag * DT;
      this.vy += (this.y < -0.4 ? 3.2 : 0.6) * DT;
      if (this.y > -0.5 && this.vy > 0) this.vy *= 0.9;
      this.L -= this.L * 4 * DT;
    }
    this.x += this.vx * DT;
    this.y += this.vy * DT;
    this.theta += (this.L / this.inertia) * DT;
    this.stepJoints(this.entryPose);
    if (this.phaseTime >= 2.2) {
      this.phase = 'done';
      this.emit('surface');
    }
  }
}

export function pdStep(j: Joints, jv: Joints, target: Joints): void {
  const k = JOINT_WN * JOINT_WN;
  const d = 2 * JOINT_WN;
  for (const n of JOINT_NAMES) {
    const acc = k * (target[n] - j[n]) - d * jv[n];
    jv[n] += acc * DT;
    j[n] += jv[n] * DT;
  }
}

export function splashSize(e: EntryResult): number {
  if (e.flat || e.tuckEntry) return 1;
  const ang = Math.min(1, Math.abs(e.angleErr) / 30);
  const ripF = { PERFECT: 0.05, GOOD: 0.3, EARLY: 0.55, LATE: 0.6, NONE: 0.7 }[e.rip];
  return Math.min(1, ripF + ang * 0.6 + Math.min(0.3, e.bend * 0.3));
}

/** Plan used to calibrate the ideal angular momentum (and by the bot as a reference). */
export function referenceOpenTime(d: DiveSpec): number {
  return 0.32 + HALF_TWIST_TIME * d.halfTwists + (d.halfTwists > 0 ? 0.06 : 0);
}

/**
 * Angular momentum for which a perfect take-off plus the reference plan
 * (bend right after take-off, open `referenceOpenTime` before contact)
 * ends exactly at the target angle. theta(T) is linear in L for a fixed pose
 * timeline, so one probe run with L = 1 is enough.
 */
export function idealAngularMomentum(setup: DiveSetup): number {
  const key = `${setup.dive.code}@${setup.height}`;
  const hit = idealCache.get(key);
  if (hit !== undefined) return hit;
  const probeSetup: DiveSetup = { ...setup, hepTime: undefined, idealL: 1 };
  const sim = new DiverSim(probeSetup, { probeL: 1 });
  const d = setup.dive;
  const bend = d.position === 'A' ? 0 : d.position === 'B' ? IN.ACTION | IN.DOWN : IN.ACTION;
  const openAt = referenceOpenTime(d);
  let twistsTapped = 0;
  let takeoffT = -1;
  let guard = 0;
  sim.step(IN.ACTION);
  while (sim.phase !== 'water' && sim.phase !== 'done' && guard++ < 2000) {
    let input = 0;
    if (sim.phase === 'flight') {
      if (takeoffT < 0) takeoffT = sim.t;
      const remaining = sim.flightDuration - (sim.t - takeoffT);
      if (sim.t - takeoffT >= 0.08 && remaining > openAt) input = bend;
      if (remaining <= openAt && twistsTapped < d.halfTwists && sim.tick % 2 === 0) {
        input |= IN.UP;
        twistsTapped++;
      }
    }
    sim.step(input);
  }
  // entry.angleErr = rot * (axis - rot * halfSoms * PI), so the achieved rotation is:
  const achieved = sim.entry ? sim.entry.angleErr / DEG + d.halfSoms * Math.PI : 0;
  const L = achieved > 0 ? (d.halfSoms * Math.PI) / achieved : 1;
  idealCache.set(key, L);
  return L;
}
