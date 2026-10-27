// 16-bit style music, synthesised on WebAudio: a detuned saw lead with
// echo and vibrato, slap bass, brass stabs, an arpeggio, pads and a drum
// kit (kick, snare, hats), through a small reverb and a compressor.
// Songs are chord charts plus hand-written melodies, scheduled ahead of
// time so they do not drift. `duck` lowers the music during a dive.

import { audio } from './engine';
import { SONGS, hz, parseChord, parseMelody, type NoteEv } from './songs';

class Music {
  private timer: number | null = null;
  private current = '';
  private step = 0;
  private nextTime = 0;
  private noise: AudioBuffer | null = null;
  private melody: Map<number, NoteEv> = new Map();
  // buses, built on first use
  private out: GainNode | null = null;
  private duckGain: GainNode | null = null;
  private verb: GainNode | null = null;
  private echo: GainNode | null = null;

  play(name: string): void {
    if (this.current === name) return;
    this.stop();
    const song = SONGS[name];
    if (!song) return;
    this.current = name;
    this.step = 0;
    this.nextTime = 0;
    this.melody = new Map(parseMelody(song.lead).map((e) => [e.step, e]));
    this.timer = window.setInterval(() => this.schedule(), 50);
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.current = '';
  }

  /** lower (0..1) or restore (1) the music, e.g. during the dive itself */
  duck(level: number, time = 0.4): void {
    const ctx = audio.ctx;
    if (!ctx || !this.duckGain) return;
    const g = this.duckGain.gain;
    g.cancelScheduledValues(ctx.currentTime);
    g.setValueAtTime(g.value, ctx.currentTime);
    g.linearRampToValueAtTime(level, ctx.currentTime + time);
  }

  /** short brass fanfare over whatever plays (great entries, passed levels) */
  fanfare(): void {
    const ctx = audio.ctx;
    if (!ctx || ctx.state !== 'running') return;
    this.buses(ctx);
    const t = ctx.currentTime + 0.02;
    const s = 0.09;
    [72, 76, 79].forEach((m, i) => this.brass(ctx, [m], t + i * s, s * 0.9, 0.09));
    this.brass(ctx, [72, 76, 79, 84], t + 3 * s, 0.7, 0.07);
    this.kick(ctx, t + 3 * s, 0.4);
    this.crash(ctx, t + 3 * s);
  }

  private buses(ctx: AudioContext): void {
    if (this.out) return;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 3;
    comp.attack.value = 0.005;
    comp.release.value = 0.15;
    this.duckGain = ctx.createGain();
    comp.connect(this.duckGain).connect(audio.musicBus);
    this.out = ctx.createGain();
    this.out.gain.value = 0.9;
    this.out.connect(comp);
    // reverb: a decaying stereo noise impulse
    const len = Math.floor(ctx.sampleRate * 1.4);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    }
    const conv = ctx.createConvolver();
    conv.buffer = ir;
    this.verb = ctx.createGain();
    this.verb.gain.value = 0.22;
    this.verb.connect(conv).connect(comp);
    // echo on a dotted eighth, for the lead and the arpeggio
    const delay = ctx.createDelay(1);
    delay.delayTime.value = (60 / 126) * 0.75;
    const fb = ctx.createGain();
    fb.gain.value = 0.28;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2600;
    this.echo = ctx.createGain();
    this.echo.gain.value = 0.25;
    this.echo.connect(delay);
    delay.connect(tone).connect(fb).connect(delay);
    tone.connect(comp);
  }

  private schedule(): void {
    const ctx = audio.ctx;
    const song = SONGS[this.current];
    if (!ctx || ctx.state !== 'running' || !song) return;
    this.buses(ctx);
    const sd = 60 / song.bpm / 4;
    if (this.nextTime < ctx.currentTime) this.nextTime = ctx.currentTime + 0.05;
    const bars = song.chords.length;
    while (this.nextTime < ctx.currentTime + 0.2) {
      const t = this.nextTime;
      const total = bars * 16;
      const s = this.step % total;
      const bar = Math.floor(s / 16);
      const i = s % 16;
      const chord = parseChord(song.chords[bar]![i < 8 ? 0 : 1]);
      // drums
      if (song.drums.kick[i] === 'x') this.kick(ctx, t, 0.55);
      if (song.drums.snare[i] === 'x') this.snare(ctx, t);
      const h = song.drums.hat[i];
      if (h === 'h') this.hat(ctx, t, 0.05, 0.03);
      if (h === 'o') this.hat(ctx, t, 0.045, 0.16);
      if (i === 0 && bar % 8 === 0 && this.step > 0) this.crash(ctx, t);
      // bass
      const b = song.bass[i];
      if (b === 'x') this.bass(ctx, chord.root - 12 + (i === 10 ? 7 : 0), t, sd * 1.6, false);
      if (b === 'o') this.bass(ctx, chord.root, t, sd * 0.9, true);
      // harmony
      const voicing = chord.tones.map((x) => chord.root + 12 + x);
      if (song.stabs && (i === 2 || i === 6 || i === 10 || i === 14)) this.brass(ctx, voicing, t, sd * 0.8, 0.028);
      if (song.pads && (i === 0 || i === 8)) this.pad(ctx, voicing, t, sd * 8);
      if (song.arpFrom >= 0 && bar >= song.arpFrom) {
        const tone = voicing[i % voicing.length]! + 12 * (1 + (Math.floor(i / voicing.length) % 2));
        this.arp(ctx, tone, t, sd * 0.7);
      }
      // melody
      const n = this.melody.get(s);
      if (n && n.midi > 0) this.lead(ctx, n.midi, t, n.len * sd);
      this.step++;
      this.nextTime += sd;
    }
  }

  // ------------------------------------------------------------ instruments

  private env(ctx: AudioContext, t: number, peak: number, attack: number, dur: number, release: number): GainNode {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak * 0.75, t + Math.max(attack, dur - release));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + release);
    return g;
  }

  private lead(ctx: AudioContext, midi: number, t: number, dur: number): void {
    const f = hz(midi);
    const g = this.env(ctx, t, 0.07, 0.012, dur * 0.95, 0.09);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 2;
    lp.frequency.setValueAtTime(4200, t);
    lp.frequency.exponentialRampToValueAtTime(1900, t + 0.18);
    // vibrato that comes in on held notes
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.value = 5.5;
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(dur > 0.3 ? f * 0.006 : 0, t + 0.25);
    lfo.connect(depth);
    for (const det of [-8, 8]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = det;
      depth.connect(o.frequency);
      o.connect(lp);
      o.start(t);
      o.stop(t + dur + 0.15);
    }
    lfo.start(t);
    lfo.stop(t + dur + 0.15);
    lp.connect(g);
    g.connect(this.out!);
    g.connect(this.echo!);
    g.connect(this.verb!);
  }

  private bass(ctx: AudioContext, midi: number, t: number, dur: number, pop: boolean): void {
    const g = this.env(ctx, t, pop ? 0.16 : 0.24, 0.004, dur, 0.05);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 6;
    lp.frequency.setValueAtTime(pop ? 4000 : 2400, t);
    lp.frequency.exponentialRampToValueAtTime(pop ? 900 : 380, t + 0.12);
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = hz(midi);
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = hz(midi);
    o.connect(lp);
    sub.connect(g);
    lp.connect(g).connect(this.out!);
    for (const x of [o, sub]) {
      x.start(t);
      x.stop(t + dur + 0.08);
    }
  }

  private brass(ctx: AudioContext, notes: number[], t: number, dur: number, vol: number): void {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(800, t);
    lp.frequency.linearRampToValueAtTime(2600, t + 0.03);
    lp.frequency.exponentialRampToValueAtTime(1100, t + dur);
    const g = this.env(ctx, t, vol, 0.02, dur, 0.06);
    for (const m of notes) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = hz(m);
      o.connect(lp);
      o.start(t);
      o.stop(t + dur + 0.1);
    }
    lp.connect(g);
    g.connect(this.out!);
    g.connect(this.verb!);
  }

  private pad(ctx: AudioContext, notes: number[], t: number, dur: number): void {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.022, t + dur * 0.3);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    for (const m of notes) {
      for (const det of [-6, 6]) {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = hz(m);
        o.detune.value = det;
        o.connect(g);
        o.start(t);
        o.stop(t + dur + 0.05);
      }
    }
    g.connect(this.out!);
    g.connect(this.verb!);
  }

  private arp(ctx: AudioContext, midi: number, t: number, dur: number): void {
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = hz(midi);
    const g = this.env(ctx, t, 0.018, 0.003, dur, 0.03);
    o.connect(g);
    g.connect(this.out!);
    g.connect(this.echo!);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noiseBuf(ctx: AudioContext): AudioBuffer {
    if (!this.noise) {
      const len = Math.floor(ctx.sampleRate * 1);
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    return this.noise;
  }

  private noiseHit(ctx: AudioContext, t: number, type: BiquadFilterType, f: number, q: number, vol: number, dur: number, verb = 0): void {
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf(ctx);
    const flt = ctx.createBiquadFilter();
    flt.type = type;
    flt.frequency.value = f;
    flt.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(flt).connect(g).connect(this.out!);
    if (verb) {
      const v = ctx.createGain();
      v.gain.value = verb;
      g.connect(v).connect(this.verb!);
    }
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.02);
  }

  private kick(ctx: AudioContext, t: number, vol: number): void {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    o.connect(g).connect(this.out!);
    o.start(t);
    o.stop(t + 0.3);
  }

  private snare(ctx: AudioContext, t: number): void {
    this.noiseHit(ctx, t, 'bandpass', 1900, 0.7, 0.22, 0.16, 1.2);
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.06);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    o.connect(g).connect(this.out!);
    o.start(t);
    o.stop(t + 0.1);
  }

  private hat(ctx: AudioContext, t: number, vol: number, dur: number): void {
    this.noiseHit(ctx, t, 'highpass', 8000, 0.5, vol, dur);
  }

  private crash(ctx: AudioContext, t: number): void {
    this.noiseHit(ctx, t, 'highpass', 5000, 0.3, 0.05, 1.1, 0.8);
  }
}

export const music = new Music();
