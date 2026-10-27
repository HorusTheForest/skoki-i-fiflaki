// Tiny chiptune sequencer on WebAudio: square lead, triangle bass and a
// noise hi-hat, scheduled ahead of time so it does not drift.

import { audio } from './engine';

type Track = {
  bpm: number;
  /** notes per step, '.' = rest; names like C4, D#4 */
  lead: string;
  bass: string;
  drums: string;
};

const TRACKS: Record<string, Track> = {
  menu: {
    bpm: 132,
    lead: 'E5 . G5 . A5 . G5 E5 D5 . E5 . C5 . . . E5 . G5 . A5 . C6 A5 G5 . E5 . D5 . . . C5 . D5 E5 G5 . E5 . D5 . C5 . A4 . . . C5 . D5 . E5 G5 A5 . G5 . E5 . D5 . C5 . . .',
    bass: 'C3 . C3 . G2 . G2 . A2 . A2 . F2 . F2 . C3 . C3 . G2 . G2 . A2 . A2 . G2 . G2 . F2 . F2 . C3 . C3 . A2 . A2 . E2 . E2 . F2 . F2 . G2 . G2 . C3 . . .',
    drums: 'x . h . x . h . x . h . x . h h',
  },
  arena: {
    bpm: 112,
    lead: 'A4 . . C5 . . E5 . D5 . . C5 . . A4 . G4 . . A4 . . C5 . D5 . . E5 . . . . A4 . . C5 . . E5 . G5 . . E5 . . D5 . C5 . . D5 . . A4 . . . . . . . .',
    bass: 'A2 . . . A2 . . . F2 . . . F2 . . . C3 . . . C3 . . . G2 . . . G2 . . . A2 . . . A2 . . . F2 . . . F2 . . . G2 . . . G2 . . . A2 . . . . . . .',
    drums: 'x . . h . . x . x . . h . . h .',
  },
};

const NOTE: Record<string, number> = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
function freq(n: string): number {
  const m = /^([A-G]#?)(\d)$/.exec(n);
  if (!m) return 0;
  const midi = 12 * (Number(m[2]) + 1) + NOTE[m[1]!]!;
  return 440 * 2 ** ((midi - 69) / 12);
}

class Music {
  private timer: number | null = null;
  private current = '';
  private step = 0;
  private nextTime = 0;
  private noise: AudioBuffer | null = null;

  play(name: string): void {
    if (this.current === name) return;
    this.stop();
    this.current = name;
    this.step = 0;
    this.nextTime = 0;
    this.timer = window.setInterval(() => this.schedule(), 50);
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.current = '';
  }

  private schedule(): void {
    const ctx = audio.ctx;
    const track = TRACKS[this.current];
    if (!ctx || ctx.state !== 'running' || !track) return;
    const stepDur = 60 / track.bpm / 2;
    if (this.nextTime < ctx.currentTime) this.nextTime = ctx.currentTime + 0.05;
    const lead = track.lead.split(' ');
    const bass = track.bass.split(' ');
    const drums = track.drums.split(' ');
    while (this.nextTime < ctx.currentTime + 0.25) {
      const t = this.nextTime;
      const l = lead[this.step % lead.length]!;
      const b = bass[this.step % bass.length]!;
      const d = drums[this.step % drums.length]!;
      if (l !== '.') this.tone(ctx, 'square', freq(l), t, stepDur * 0.9, 0.06);
      if (b !== '.') this.tone(ctx, 'triangle', freq(b), t, stepDur * 1.8, 0.16);
      if (d !== '.') this.hat(ctx, t, d === 'x' ? 0.09 : 0.04, d === 'x' ? 0.08 : 0.03);
      this.step++;
      this.nextTime += stepDur;
    }
  }

  private tone(ctx: AudioContext, type: OscillatorType, f: number, t: number, dur: number, vol: number): void {
    if (!f) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = f;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(audio.musicBus);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private hat(ctx: AudioContext, t: number, vol: number, dur: number): void {
    if (!this.noise) {
      const len = Math.floor(ctx.sampleRate * 0.1);
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 6000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(audio.musicBus);
    s.start(t);
    s.stop(t + dur + 0.02);
  }
}

export const music = new Music();
