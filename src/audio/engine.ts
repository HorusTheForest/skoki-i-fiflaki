// Audio: ZzFX sound effects, crowd noise from filtered noise, and buses for
// master / music / effects / crowd volumes. Everything is synthesised.

import { ZZFX } from 'zzfx';
import { settings } from '../core/save';

export type Sfx =
  | 'beep'
  | 'hep'
  | 'jump'
  | 'tuck'
  | 'open'
  | 'twist'
  | 'rip'
  | 'splash'
  | 'bigSplash'
  | 'crash'
  | 'perfect'
  | 'good'
  | 'miss'
  | 'menu'
  | 'select'
  | 'back'
  | 'charge'
  | 'star'
  | 'whistle';

// ZzFX parameter lists (volume, randomness, frequency, attack, sustain, release,
// shape, shapeCurve, slide, deltaSlide, pitchJump, pitchJumpTime, repeatTime,
// noise, modulation, bitCrush, delay, sustainVolume, decay, tremolo, filter)
/** crowd level at rest and its low-pass corner (Hz) */
const CROWD_BASE = 0.12;
const CROWD_F = 520;

const SOUNDS: Record<Sfx, (number | undefined)[]> = {
  beep: [0.5, 0, 440, 0.005, 0.08, 0.05, 1],
  hep: [0.7, 0, 880, 0.005, 0.16, 0.1, 1, 1, 0, 0, 220, 0.06],
  jump: [0.45, 0.05, 160, 0.01, 0.05, 0.16, 0, 1, 9],
  tuck: [0.25, 0.1, 500, 0.01, 0.02, 0.08, 4, 1, -6, 0, 0, 0, 0, 2],
  open: [0.22, 0.1, 380, 0.01, 0.02, 0.1, 4, 1, 4, 0, 0, 0, 0, 2],
  twist: [0.3, 0.05, 900, 0, 0.02, 0.07, 4, 1, 14, 0, 0, 0, 0, 1],
  rip: [0.9, 0.05, 1600, 0.002, 0.015, 0.07, 4, 3, -30, 0, 0, 0, 0, 12, 0, 0.05, 0, 0.6, 0.02, 0, 2400],
  splash: [0.7, 0.1, 260, 0.01, 0.12, 0.4, 4, 1, -2, 0, 0, 0, 0, 4, 0, 0, 0, 0.6, 0.15, 0, -2400],
  bigSplash: [1, 0.1, 140, 0.01, 0.25, 0.7, 4, 1, -3, 0, 0, 0, 0, 6, 0, 0.1, 0, 0.7, 0.2, 0, -1600],
  crash: [1, 0.1, 70, 0.01, 0.1, 0.45, 3, 2, -3, 0, 0, 0, 0, 4, 0, 0.2],
  perfect: [0.45, 0, 660, 0.01, 0.06, 0.18, 1, 1.5, 0, 0, 330, 0.05, 0.06],
  good: [0.4, 0, 523, 0.01, 0.05, 0.1, 1],
  miss: [0.4, 0, 150, 0.01, 0.08, 0.1, 2, 1, -1],
  menu: [0.25, 0, 700, 0, 0.02, 0.03, 1],
  select: [0.35, 0, 880, 0, 0.04, 0.08, 1, 0, 0, 0, 300, 0.03],
  back: [0.3, 0, 440, 0, 0.03, 0.06, 1, 0, 0, 0, -120, 0.03],
  charge: [0.15, 0, 300, 0, 0.02, 0.02, 2],
  star: [0.45, 0, 990, 0.01, 0.06, 0.25, 1, 1, 0, 0, 495, 0.08, 0.12],
  whistle: [0.5, 0, 1800, 0.02, 0.2, 0.08, 0, 1, 0, 0, 0, 0, 0, 0, 30],
};

class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  musicBus!: GainNode;
  private crowdBus!: GainNode;
  private crowdGain!: GainNode;
  private crowdFilter!: BiquadFilterNode;
  private cache = new Map<Sfx, AudioBuffer>();
  private inArena = false;

  /** must be called from a user gesture */
  unlock(): void {
    if (!this.ctx) {
      try {
        this.ctx = ZZFX.audioContext as AudioContext;
      } catch {
        return;
      }
      const c = this.ctx;
      this.master = c.createGain();
      this.master.connect(c.destination);
      this.sfxBus = c.createGain();
      this.sfxBus.connect(this.master);
      this.musicBus = c.createGain();
      this.musicBus.connect(this.master);
      this.crowdBus = c.createGain();
      this.crowdBus.connect(this.master);
      this.startCrowd();
      this.applyVolumes();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  applyVolumes(): void {
    if (!this.ctx) return;
    const s = settings();
    this.master.gain.value = s.master;
    this.sfxBus.gain.value = s.sfx;
    this.musicBus.gain.value = s.music * 0.5;
    this.crowdBus.gain.value = s.crowd;
  }

  play(name: Sfx, volume = 1, rate = 1): void {
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    let buf = this.cache.get(name);
    if (!buf) {
      const samples = ZZFX.buildSamples(...(SOUNDS[name] as number[]));
      buf = c.createBuffer(1, samples.length, ZZFX.sampleRate);
      buf.getChannelData(0).set(samples);
      this.cache.set(name, buf);
    }
    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = c.createGain();
    g.gain.value = volume;
    src.connect(g).connect(this.sfxBus);
    src.start();
  }

  /**
   * Crowd murmur: a long loop of low-passed brown noise with a slow,
   * irregular swell. Silent outside the arena (see `arena`); the loop seam is
   * cross-faded so it does not click.
   */
  private startCrowd(): void {
    const c = this.ctx!;
    const len = c.sampleRate * 6;
    const fade = Math.floor(c.sampleRate * 0.5);
    const raw = new Float32Array(len + fade);
    let b = 0;
    let env = 0.7;
    let envTarget = 0.7;
    for (let i = 0; i < raw.length; i++) {
      b = (b + (Math.random() * 2 - 1) * 0.06) * 0.99;
      if (i % 4000 === 0) envTarget = 0.55 + Math.random() * 0.45;
      env += (envTarget - env) * 0.0002;
      raw[i] = b * env;
    }
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = raw[i]!;
    for (let i = 0; i < fade; i++) {
      const u = i / fade;
      d[i] = raw[i]! * u + raw[len + i]! * (1 - u);
    }
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    this.crowdFilter = c.createBiquadFilter();
    this.crowdFilter.type = 'lowpass';
    this.crowdFilter.frequency.value = CROWD_F;
    this.crowdFilter.Q.value = 0.5;
    this.crowdGain = c.createGain();
    this.crowdGain.gain.value = this.inArena ? CROWD_BASE : 0;
    src.connect(this.crowdFilter).connect(this.crowdGain).connect(this.crowdBus);
    src.start();
  }

  /** the crowd is only heard in the arena */
  arena(on: boolean): void {
    this.inArena = on;
    const c = this.ctx;
    if (!c) return;
    const g = this.crowdGain.gain;
    g.cancelScheduledValues(c.currentTime);
    g.setValueAtTime(g.value, c.currentTime);
    g.linearRampToValueAtTime(on ? CROWD_BASE : 0, c.currentTime + 0.6);
  }

  /** crowd reaction 0..1 (roar on great entries, groan on flops) */
  roar(level: number, groan = false): void {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime;
    const g = this.crowdGain.gain;
    const f = this.crowdFilter.frequency;
    g.cancelScheduledValues(t);
    f.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    f.setValueAtTime(f.value, t);
    g.linearRampToValueAtTime(CROWD_BASE + level * 1.4, t + 0.12);
    f.linearRampToValueAtTime(groan ? 300 : 700 + level * 900, t + 0.12);
    g.linearRampToValueAtTime(this.inArena ? CROWD_BASE : 0, t + 1.4 + level * 1.6);
    f.linearRampToValueAtTime(CROWD_F, t + 1.4 + level * 1.6);
  }

  hush(): void {
    const c = this.ctx;
    if (!c) return;
    const g = this.crowdGain.gain;
    g.cancelScheduledValues(c.currentTime);
    g.setValueAtTime(g.value, c.currentTime);
    g.linearRampToValueAtTime(this.inArena ? CROWD_BASE * 0.3 : 0, c.currentTime + 0.5);
  }

  relax(): void {
    const c = this.ctx;
    if (!c) return;
    const g = this.crowdGain.gain;
    g.cancelScheduledValues(c.currentTime);
    g.setValueAtTime(g.value, c.currentTime);
    g.linearRampToValueAtTime(this.inArena ? CROWD_BASE : 0, c.currentTime + 0.8);
  }
}

export const audio = new AudioEngine();
