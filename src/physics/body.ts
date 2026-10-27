// Segmented diver body: geometry, poses and moment of inertia.
//
// Local frame: hip joint at origin, torso pointing up (+y), front of the body
// towards +x. Directions are angles measured clockwise from "up", so a
// direction `a` corresponds to the unit vector (sin a, cos a).

export interface Joints {
  /** shoulder: 0 = arm down along the body, PI = arm overhead, positive swings forward */
  s: number;
  /** elbow: 0 = straight, positive bends the forearm forward */
  e: number;
  /** hip: 0 = legs straight, positive folds thighs towards the chest */
  h: number;
  /** knee: 0 = straight, positive bends the shin backwards */
  k: number;
  /** ankle: PI/2 = foot flat (perpendicular to the shin), 0 = toes pointed */
  a: number;
}

export type JointName = keyof Joints;
export const JOINT_NAMES: readonly JointName[] = ['s', 'e', 'h', 'k', 'a'];

export type SegName = 'torso' | 'head' | 'upperArm' | 'forearm' | 'thigh' | 'shin' | 'foot';
export const SEG_NAMES: readonly SegName[] = ['torso', 'head', 'upperArm', 'forearm', 'thigh', 'shin', 'foot'];

/** Segment lengths in metres. */
export const LEN = {
  torso: 0.56,
  shoulder: 0.5,
  headR: 0.115,
  neck: 0.03,
  upperArm: 0.3,
  forearm: 0.36,
  thigh: 0.44,
  shin: 0.43,
  foot: 0.22,
} as const;

/** Mass fractions. Limbs count twice: the far arm/leg mirrors the near one. */
const MASS_RAW: Record<SegName, number> = {
  torso: 0.46,
  head: 0.08,
  upperArm: 0.028 * 2,
  forearm: 0.022 * 2,
  thigh: 0.1 * 2,
  shin: 0.045 * 2,
  foot: 0.015 * 2,
};
const MASS_SUM = SEG_NAMES.reduce((s, n) => s + MASS_RAW[n], 0);
export const MASS: Record<SegName, number> = Object.fromEntries(
  SEG_NAMES.map((n) => [n, MASS_RAW[n] / MASS_SUM]),
) as Record<SegName, number>;

const PI = Math.PI;

export const POSES = {
  stand: { s: 0.08, e: 0.15, h: 0, k: 0, a: PI / 2 },
  crouch: { s: -0.65, e: 0.3, h: 1.66, k: 1.4, a: 1.92 },
  /** open body, arms overhead: head-first entry */
  openHead: { s: PI, e: 0, h: 0, k: 0, a: 0.05 },
  /** open body, arms along the sides: feet-first entry */
  openFeet: { s: 0.02, e: 0, h: 0, k: 0, a: 0.05 },
  tuck: { s: 0.8, e: 1.9, h: 2.22, k: 2.3, a: 0.15 },
  pike: { s: 2.0, e: 0.05, h: 1.95, k: 0, a: 0.1 },
} satisfies Record<string, Joints>;
export type PoseName = keyof typeof POSES;

export interface SegFrame {
  /** proximal joint */
  px: number;
  py: number;
  /** centre of the segment */
  cx: number;
  cy: number;
  /** direction (clockwise from up) from proximal to distal end */
  dir: number;
  len: number;
}

export interface BodyFrame {
  seg: Record<SegName, SegFrame>;
  /** key points used for collisions and contact */
  headTop: [number, number];
  hand: [number, number];
  toe: [number, number];
  knee: [number, number];
  ankle: [number, number];
  shoulder: [number, number];
  hip: [number, number];
  com: [number, number];
}

const sx = (a: number) => Math.sin(a);
const cy = (a: number) => Math.cos(a);

function seg(px: number, py: number, dir: number, len: number): SegFrame {
  const ex = px + sx(dir) * len;
  const ey = py + cy(dir) * len;
  return { px, py, cx: (px + ex) / 2, cy: (py + ey) / 2, dir, len };
}
const end = (s: SegFrame): [number, number] => [s.px + sx(s.dir) * s.len, s.py + cy(s.dir) * s.len];

/** Forward kinematics in the local body frame. */
export function bodyFrame(j: Joints): BodyFrame {
  const torso = seg(0, 0, 0, LEN.torso);
  const neckTop = LEN.torso + LEN.neck;
  const head: SegFrame = {
    px: 0,
    py: neckTop,
    cx: 0,
    cy: neckTop + LEN.headR,
    dir: 0,
    len: LEN.headR * 2,
  };
  const shoulder: [number, number] = [0, LEN.shoulder];
  const dUA = PI - j.s;
  const upperArm = seg(shoulder[0], shoulder[1], dUA, LEN.upperArm);
  const elbow = end(upperArm);
  const forearm = seg(elbow[0], elbow[1], dUA - j.e, LEN.forearm);
  const dTh = PI - j.h;
  const thigh = seg(0, 0, dTh, LEN.thigh);
  const knee = end(thigh);
  const dSh = dTh + j.k;
  const shin = seg(knee[0], knee[1], dSh, LEN.shin);
  const ankle = end(shin);
  const foot = seg(ankle[0], ankle[1], dSh - j.a, LEN.foot);

  const segs: Record<SegName, SegFrame> = { torso, head, upperArm, forearm, thigh, shin, foot };
  let mx = 0;
  let my = 0;
  for (const n of SEG_NAMES) {
    mx += segs[n].cx * MASS[n];
    my += segs[n].cy * MASS[n];
  }
  return {
    seg: segs,
    headTop: [0, neckTop + LEN.headR * 2],
    hand: end(forearm),
    toe: end(foot),
    knee,
    ankle,
    shoulder,
    hip: [0, 0],
    com: [mx, my],
  };
}

function rawInertia(f: BodyFrame): number {
  let i = 0;
  for (const n of SEG_NAMES) {
    const s = f.seg[n];
    const dx = s.cx - f.com[0];
    const dy = s.cy - f.com[1];
    const m = MASS[n];
    const own = n === 'head' ? (m * LEN.headR * LEN.headR) / 2 : (m * s.len * s.len) / 12;
    i += m * (dx * dx + dy * dy) + own;
  }
  return i;
}

const I_REF = rawInertia(bodyFrame(POSES.openHead));

/** Normalised moment of inertia about the centre of mass (open body, arms up = 1.0). */
export function inertia(j: Joints): number {
  return rawInertia(bodyFrame(j)) / I_REF;
}

export function inertiaOfFrame(f: BodyFrame): number {
  return rawInertia(f) / I_REF;
}

/**
 * Direction of the body's long axis in the local frame (clockwise from up),
 * measured from the ankle to the top of the head.
 */
export function axisDir(f: BodyFrame): number {
  return Math.atan2(f.headTop[0] - f.ankle[0], f.headTop[1] - f.ankle[1]);
}

export function lerpJoints(a: Joints, b: Joints, t: number): Joints {
  return {
    s: a.s + (b.s - a.s) * t,
    e: a.e + (b.e - a.e) * t,
    h: a.h + (b.h - a.h) * t,
    k: a.k + (b.k - a.k) * t,
    a: a.a + (b.a - a.a) * t,
  };
}
