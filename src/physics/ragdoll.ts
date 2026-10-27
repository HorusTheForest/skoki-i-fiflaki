// Ragdoll (Planck.js, a Box2D port): used for flops, tuck entries and
// hitting the platform. At the switch every segment keeps its velocity,
// v + omega x r, so the motion continues seamlessly. Revolute joints have
// anatomical angle limits. Under water: drag and buoyancy.

import { Box, Circle, RevoluteJoint, Vec2, World, type Body } from 'planck';
import { bodyFrame, LEN, MASS, type Joints, type SegName } from './body';
import { DT, GRAVITY, TOWER } from './diver';

export interface SegWorld {
  name: SegName;
  /** proximal joint in world metres */
  px: number;
  py: number;
  /** direction (clockwise from up) from proximal to distal */
  dir: number;
  len: number;
}

export interface BodyPose {
  x: number;
  y: number;
  theta: number;
  j: Joints;
  psi: number;
  facing: 1 | -1;
}

/** world frames of all segments for a kinematic pose */
export function segmentsWorld(st: BodyPose): { segs: SegWorld[]; sg: 1 | -1; squash: number } {
  const f = bodyFrame(st.j);
  const cosPsi = Math.cos(st.psi);
  const xs = st.facing * cosPsi;
  const sg = xs >= 0 ? 1 : -1;
  const c = Math.cos(st.theta);
  const s = Math.sin(st.theta);
  const out: SegWorld[] = [];
  for (const name of ['torso', 'head', 'upperArm', 'forearm', 'thigh', 'shin', 'foot'] as SegName[]) {
    const sf = f.seg[name];
    const lx = name === 'head' ? sf.cx : sf.px;
    const ly = name === 'head' ? sf.cy : sf.py;
    const dx = (lx - f.com[0]) * xs;
    const dy = ly - f.com[1];
    out.push({
      name,
      px: st.x + dx * c + dy * s,
      py: st.y - dx * s + dy * c,
      dir: st.theta + sg * sf.dir,
      len: sf.len,
    });
  }
  return { segs: out, sg, squash: Math.max(0.34, Math.abs(cosPsi)) };
}

const WIDTH: Record<SegName, number> = {
  torso: 0.26,
  head: LEN.headR * 2,
  upperArm: 0.1,
  forearm: 0.09,
  thigh: 0.16,
  shin: 0.11,
  foot: 0.09,
};

/** allowed joint ranges in body terms (radians) */
const RANGE: Record<keyof Joints, [number, number]> = {
  s: [-1.2, 3.3],
  e: [0, 2.6],
  h: [-0.5, 2.7],
  k: [0, 2.6],
  a: [0, 1.9],
};

export class Ragdoll {
  readonly world: World;
  private readonly bodies = new Map<SegName, Body>();
  private readonly lens = new Map<SegName, number>();
  readonly sg: 1 | -1;
  time = 0;

  constructor(st: BodyPose, omega: number, vx: number, vy: number, platformHeight: number) {
    this.world = new World({ gravity: new Vec2(0, -GRAVITY) });
    const { segs, sg } = segmentsWorld(st);
    this.sg = sg;
    // static platform, tower and pool floor
    const ground = this.world.createBody();
    ground.createFixture({ shape: new Box(TOWER.depth / 2, TOWER.slab / 2, new Vec2(-TOWER.depth / 2, platformHeight - TOWER.slab / 2), 0), friction: 0.6 });
    ground.createFixture({ shape: new Box(1.5, platformHeight / 2, new Vec2(-TOWER.overhang - 1.5, platformHeight / 2), 0), friction: 0.6 });
    ground.createFixture({ shape: new Box(40, 0.5, new Vec2(0, -5.5), 0), friction: 0.8 });

    // omega is clockwise-positive; Planck uses counter-clockwise
    const w = -omega;
    for (const s of segs) {
      const half = s.name === 'head' ? 0 : s.len / 2;
      const cx = s.px + Math.sin(s.dir) * half;
      const cy = s.py + Math.cos(s.dir) * half;
      const rx = cx - st.x;
      const ry = cy - st.y;
      const b = this.world.createBody({
        type: 'dynamic',
        position: new Vec2(cx, cy),
        angle: -s.dir,
        linearVelocity: new Vec2(vx - w * ry, vy + w * rx),
        angularVelocity: w,
        angularDamping: 0.4,
      });
      const shape = s.name === 'head' ? new Circle(LEN.headR) : new Box(WIDTH[s.name] / 2, s.len / 2);
      const area = s.name === 'head' ? Math.PI * LEN.headR ** 2 : WIDTH[s.name] * s.len;
      b.createFixture({ shape, density: (MASS[s.name] * 70) / area, filterGroupIndex: -1, friction: 0.4, restitution: 0.1 });
      this.bodies.set(s.name, b);
      this.lens.set(s.name, s.len);
    }
    const B = (n: SegName) => this.bodies.get(n)!;
    const P = (n: SegName) => segs.find((s) => s.name === n)!;
    const joint = (a: SegName, b: SegName, at: SegWorld, key: keyof Joints | null, sign: number) => {
      let lower = -0.4;
      let upper = 0.4;
      if (key) {
        const q = st.j[key];
        const [lo, hi] = RANGE[key];
        const m = sign * sg;
        const l1 = m * (lo - q);
        const l2 = m * (hi - q);
        lower = Math.min(l1, l2);
        upper = Math.max(l1, l2);
      }
      this.world.createJoint(new RevoluteJoint({ enableLimit: true, lowerAngle: lower, upperAngle: upper }, B(a), B(b), new Vec2(at.px, at.py)));
    };
    const torso = P('torso');
    const neck = { ...torso, px: torso.px + Math.sin(torso.dir) * LEN.torso, py: torso.py + Math.cos(torso.dir) * LEN.torso };
    joint('torso', 'head', neck, null, 1);
    joint('torso', 'upperArm', P('upperArm'), 's', 1);
    joint('upperArm', 'forearm', P('forearm'), 'e', 1);
    joint('torso', 'thigh', P('thigh'), 'h', 1);
    joint('thigh', 'shin', P('shin'), 'k', -1);
    joint('shin', 'foot', P('foot'), 'a', 1);
  }

  step(): void {
    this.time += DT;
    for (const b of this.bodies.values()) {
      const p = b.getWorldCenter();
      if (p.y < 0) {
        const v = b.getLinearVelocity();
        const m = b.getMass();
        const depth = Math.min(1, -p.y / 0.15);
        // buoyancy slightly above gravity, strong drag
        b.applyForceToCenter(new Vec2(-v.x * m * 6, m * GRAVITY * 1.4 * depth - v.y * m * 6), true);
        b.setAngularVelocity(b.getAngularVelocity() * 0.96);
      }
    }
    this.world.step(DT, 8, 3);
  }

  centre(): [number, number] {
    const p = this.bodies.get('torso')!.getWorldCenter();
    return [p.x, p.y];
  }

  velocity(): [number, number] {
    const v = this.bodies.get('torso')!.getLinearVelocity();
    return [v.x, v.y];
  }

  segments(): SegWorld[] {
    const out: SegWorld[] = [];
    for (const [name, b] of this.bodies) {
      const c = b.getPosition();
      const dir = -b.getAngle();
      const len = this.lens.get(name)!;
      const half = name === 'head' ? 0 : len / 2;
      out.push({ name, px: c.x - Math.sin(dir) * half, py: c.y - Math.cos(dir) * half, dir, len });
    }
    return out;
  }
}
