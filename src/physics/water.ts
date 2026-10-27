// Water surface as a 1D spring mesh: one column per screen pixel. Each
// column is a damped spring pulled back to rest and coupled to its
// neighbours, so a disturbance travels as waves. Splash and bubbles are
// simple pixel particles.

import { Rng } from '../core/rng';

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  /** colour slot: 0 foam, 1 light, 2 deep */
  tone: number;
}

const WATER_DT = 1 / 120;

export class WaterSurface {
  readonly x0: number;
  readonly cols: number;
  /** metres per column */
  readonly dx: number;
  readonly h: Float32Array;
  readonly v: Float32Array;
  readonly drops: Particle[] = [];
  readonly bubbles: Particle[] = [];
  private readonly rng: Rng;
  private readonly tmp: Float32Array;
  stiffness = 60;
  damping = 2.2;
  /** neighbour coupling (1/s²): wave speed ≈ sqrt(coupling) columns per second */
  coupling = 2000;
  private time = 0;

  constructor(x0: number, x1: number, dx: number, seed = 1) {
    this.x0 = x0;
    this.dx = dx;
    this.cols = Math.ceil((x1 - x0) / dx);
    this.h = new Float32Array(this.cols);
    this.v = new Float32Array(this.cols);
    this.tmp = new Float32Array(this.cols);
    this.rng = new Rng(seed);
  }

  column(x: number): number {
    return Math.round((x - this.x0) / this.dx);
  }

  heightAt(x: number): number {
    const i = this.column(x);
    return i >= 0 && i < this.cols ? this.h[i]! : 0;
  }

  /** push the surface at x (velocity in m/s, negative pushes down) */
  disturb(x: number, impulse: number, radius = 0.15): void {
    const c = this.column(x);
    const r = Math.max(1, Math.round(radius / this.dx));
    for (let i = c - r; i <= c + r; i++) {
      if (i < 0 || i >= this.cols) continue;
      const f = 1 - Math.abs(i - c) / (r + 1);
      this.v[i]! += impulse * f;
    }
  }

  /** pixel splash; size 0..1 */
  splash(x: number, size: number, speed: number): void {
    const n = Math.round(6 + size * 70);
    for (let i = 0; i < n; i++) {
      const a = this.rng.range(-0.5, 0.5) * (1.4 - size * 0.4);
      const sp = speed * this.rng.range(0.25, 0.75) * (0.35 + size * 0.9);
      this.drops.push({
        x: x + this.rng.range(-0.25, 0.25),
        y: 0.02,
        vx: Math.sin(a) * sp,
        vy: Math.cos(a) * sp,
        life: this.rng.range(0.6, 1.4),
        tone: this.rng.int(3),
      });
    }
    this.disturb(x, -speed * (0.03 + size * 0.12), 0.25 + size * 0.45);
  }

  /** column of bubbles following a diver underwater */
  bubble(x: number, y: number, count: number): void {
    for (let i = 0; i < count; i++) {
      this.bubbles.push({
        x: x + this.rng.range(-0.15, 0.15),
        y: y + this.rng.range(-0.2, 0.2),
        vx: 0,
        vy: this.rng.range(0.6, 1.4),
        life: this.rng.range(0.8, 2.2),
        tone: this.rng.int(2),
      });
    }
  }

  /** advance by dt in fixed sub-steps: the explicit spring mesh is only
   * stable for steps under 1/sqrt(coupling) (about 22 ms) */
  step(dt: number): void {
    const n = Math.max(1, Math.ceil(dt / WATER_DT));
    for (let k = 0; k < n; k++) this.substep(dt / n);
  }

  private substep(dt: number): void {
    this.time += dt;
    const { h, v, tmp, cols } = this;
    for (let i = 0; i < cols; i++) {
      const l = i > 0 ? h[i - 1]! : h[i]!;
      const r = i < cols - 1 ? h[i + 1]! : h[i]!;
      tmp[i] = (l + r - 2 * h[i]!) * this.coupling;
    }
    for (let i = 0; i < cols; i++) {
      const a = -this.stiffness * h[i]! - this.damping * v[i]! + tmp[i]!;
      v[i]! += a * dt;
      h[i]! += v[i]! * dt;
    }
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const p = this.drops[i]!;
      p.vy -= 9.81 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.y < this.heightAt(p.x) && p.vy < 0) {
        this.disturb(p.x, p.vy * 0.05, 0.05);
        p.life = 0;
      }
      if (p.life <= 0) this.drops.splice(i, 1);
    }
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const p = this.bubbles[i]!;
      p.x += Math.sin(this.time * 9 + i) * 0.15 * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.y >= 0 || p.life <= 0) this.bubbles.splice(i, 1);
    }
  }
}
