// Judging. Awards follow from measurable parameters of the dive, with a
// small seeded spread between judges. Awards are 0..10 in steps of 0.5.

import { Rng } from '../core/rng';
import type { DiverSim, EntryResult, SimEvent, Takeoff } from '../physics/diver';
import type { DiveSpec } from '../levels/diveCode';

export interface Deduction {
  reason: string;
  points: number;
}

export interface Execution {
  base: number;
  deductions: Deduction[];
  failed: boolean;
}

export interface DiveRecord {
  dive: DiveSpec;
  takeoff: Takeoff | null;
  entry: EntryResult | null;
  crashed: boolean;
  events: SimEvent[];
  trace: number[];
}

export function record(sim: DiverSim): DiveRecord {
  return {
    dive: sim.dive,
    takeoff: sim.takeoff,
    entry: sim.entry,
    crashed: sim.crashed,
    events: sim.events,
    trace: sim.trace,
  };
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export function execution(r: DiveRecord): Execution {
  const ded: Deduction[] = [];
  const add = (reason: string, points: number) => {
    if (points > 0.04) ded.push({ reason, points: Math.round(points * 100) / 100 });
  };
  const e = r.entry;
  if (r.crashed || !e) {
    return { base: 0, deductions: [{ reason: 'Uderzenie w platformę', points: 10 }], failed: true };
  }
  if (e.tuckEntry) {
    return { base: 1.5, deductions: [{ reason: 'Wejście w pozycji kucznej', points: 8.5 }], failed: true };
  }
  if (e.flat) {
    return { base: 1, deductions: [{ reason: 'Płaskie wejście', points: 9 }], failed: true };
  }
  const tk = r.takeoff;
  if (tk && tk.error !== 0) add('Wybicie poza strefą', clamp(Math.abs(tk.error) * 9, 0, 1.5));
  if (e.height < 0.6) add('Za niski lot', clamp((0.6 - e.height) * 4, 0, 1.5));
  if (e.clearance < 0.3) add('Za blisko platformy', clamp((0.3 - e.clearance) * 6, 0, 2));
  if (e.distance > 3.6) add('Za daleko od wieży', clamp((e.distance - 3.6) * 1.2, 0, 1.5));

  const pos = r.dive.position;
  const bentTime = e.tuckTime + e.pikeTime;
  if (pos === 'C' && e.pikeTime > e.tuckTime && bentTime > 0.15) add('Zła pozycja (łamana zamiast kucznej)', 2);
  if (pos === 'B' && e.tuckTime > e.pikeTime && bentTime > 0.15) add('Zła pozycja (kuczna zamiast łamanej)', 2);
  if (pos === 'A' && bentTime > 0.15) add('Zła pozycja (miała być prosta)', 2);
  if ((pos === 'B' || pos === 'C') && bentTime < 0.15 && r.dive.halfSoms > 1) add('Brak pozycji', 2);

  const tw = Math.abs(e.halfTwistsDone - r.dive.halfTwists);
  if (tw > 0) add(e.halfTwistsDone < r.dive.halfTwists ? 'Niedokończone śruby' : 'Za dużo śrub', clamp(tw * 2, 0, 4));
  if (e.twistInProgress) add('Śruba w trakcie wejścia', 1.5);

  const a = Math.abs(e.angleErr);
  add(e.angleErr > 0 ? 'Przekręcenie' : 'Niedokręcenie', a <= 2 ? 0 : clamp(0.6 * (a - 2) ** 0.85 * 0.35, 0, 6));
  if (e.openTime < 0.12) add('Za późne otwarcie', clamp((0.12 - e.openTime) * 12, 0, 1.2));
  add('Ugięte ciało', clamp((e.bend - 0.08) * 2.5, 0, 1.5));
  add('Rip', { PERFECT: 0, GOOD: 0.4, EARLY: 1.2, LATE: 1.4, NONE: 1.8 }[e.rip]);
  if (e.saveUsed) add('Korekta przy wejściu', 0.5);

  const total = ded.reduce((s, d) => s + d.points, 0);
  return { base: clamp(10 - total, 0, 10), deductions: ded, failed: false };
}

export interface SyncResult {
  base: number;
  deductions: Deduction[];
}

function eventTimes(r: DiveRecord, type: SimEvent['type']): number[] {
  return r.events.filter((e) => e.type === type).map((e) => e.t);
}

/** Compare two dives of the same pair. Times are on the shared clock. */
export function synchronisation(a: DiveRecord, b: DiveRecord): SyncResult {
  const ded: Deduction[] = [];
  const add = (reason: string, points: number) => {
    if (points > 0.04) ded.push({ reason, points: Math.round(points * 100) / 100 });
  };
  const ms = (x: number) => x * 1000;
  const pairDiff = (type: SimEvent['type']) => {
    const ta = eventTimes(a, type);
    const tb = eventTimes(b, type);
    const n = Math.min(ta.length, tb.length);
    let sum = 0;
    for (let i = 0; i < n; i++) sum += Math.abs(ms(ta[i]! - tb[i]!));
    const missing = Math.abs(ta.length - tb.length);
    return { mean: n ? sum / n : 0, missing };
  };
  const tk = pairDiff('takeoff');
  add('Wybicie nierówno', clamp((tk.mean - 25) * 0.02, 0, 3));
  const bend = ['tuck', 'pike'].map((t) => pairDiff(t as SimEvent['type']));
  const bendMean = (bend[0]!.mean + bend[1]!.mean) / 2;
  add('Pozycja w różnym czasie', clamp((bendMean - 30) * 0.012, 0, 2) + (bend[0]!.missing + bend[1]!.missing) * 0.5);
  const open = pairDiff('open');
  add('Otwarcie w różnym czasie', clamp((open.mean - 30) * 0.012, 0, 2) + open.missing * 0.3);
  const tw = pairDiff('twist');
  add('Śruby nierówno', clamp((tw.mean - 30) * 0.012, 0, 2) + tw.missing * 0.6);

  // body angle trajectory
  const n = Math.min(a.trace.length, b.trace.length);
  if (n > 0) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += Math.abs(a.trace[i]! - b.trace[i]!);
    const deg = ((sum / n) * 180) / Math.PI;
    add('Różna rotacja w locie', clamp((deg - 4) * 0.05, 0, 2.5));
  }
  if (a.entry && b.entry) {
    add('Wejście w różnym czasie', clamp((Math.abs(ms(a.entry.t - b.entry.t)) - 20) * 0.015, 0, 2));
    add('Różny kąt wejścia', clamp((Math.abs(a.entry.angleErr - b.entry.angleErr) - 3) * 0.08, 0, 2));
  }
  let base = 10 - ded.reduce((s, d) => s + d.points, 0);
  if (a.crashed || b.crashed || a.entry?.flat || b.entry?.flat || a.entry?.tuckEntry || b.entry?.tuckEntry) {
    base = Math.min(base, 2);
    ded.push({ reason: 'Nieudany skok w parze', points: 0 });
  }
  return { base: clamp(base, 0, 10), deductions: ded };
}

export function roundAward(v: number): number {
  return clamp(Math.round(v * 2) / 2, 0, 10);
}

/** n judges around a base award with seeded spread */
export function panel(rng: Rng, base: number, n: number, sd = 0.3): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(roundAward(base + rng.gauss() * sd));
  return out;
}

export interface Award {
  value: number;
  cancelled: boolean;
}

/** mark the `hi` highest and `lo` lowest awards as cancelled */
export function cancel(awards: number[], hi: number, lo: number): Award[] {
  const idx = awards.map((v, i) => ({ v, i }));
  const sorted = [...idx].sort((p, q) => p.v - q.v || p.i - q.i);
  const out = awards.map((v) => ({ value: v, cancelled: false }));
  for (let k = 0; k < lo; k++) out[sorted[k]!.i]!.cancelled = true;
  for (let k = 0; k < hi; k++) out[sorted[sorted.length - 1 - k]!.i]!.cancelled = true;
  return out;
}

const sumKept = (a: Award[]) => a.filter((x) => !x.cancelled).reduce((s, x) => s + x.value, 0);
const round2 = (v: number) => Math.round(v * 100) / 100;

export interface IndividualScore {
  awards: Award[];
  sum: number;
  dd: number;
  total: number;
}

/** 7 judges: drop the two highest and two lowest, sum of three times DD */
export function scoreIndividual(awards: number[], dd: number): IndividualScore {
  if (awards.length !== 7) throw new Error('Individual events use 7 judges');
  const a = cancel(awards, 2, 2);
  const sum = sumKept(a);
  return { awards: a, sum, dd, total: round2(sum * dd) };
}

export interface SynchroScore {
  execA: Award[];
  execB: Award[];
  sync: Award[];
  sum: number;
  dd: number;
  total: number;
}

/**
 * 11 judges: 3 on diver A, 3 on diver B, 5 on synchronisation. In each trio
 * and in the five the highest and lowest are cancelled; the five remaining
 * awards are summed, multiplied by DD and by 0.6.
 */
export function scoreSynchro(execA: number[], execB: number[], sync: number[], dd: number): SynchroScore {
  if (execA.length !== 3 || execB.length !== 3 || sync.length !== 5) throw new Error('Synchro uses 3 + 3 + 5 judges');
  const a = cancel(execA, 1, 1);
  const b = cancel(execB, 1, 1);
  const s = cancel(sync, 1, 1);
  const sum = sumKept(a) + sumKept(b) + sumKept(s);
  return { execA: a, execB: b, sync: s, sum, dd, total: round2(sum * dd * 0.6) };
}

export function judgeIndividual(r: DiveRecord, dd: number, seed: number): { score: IndividualScore; exec: Execution } {
  const exec = execution(r);
  const rng = new Rng(seed);
  return { score: scoreIndividual(panel(rng, exec.base, 7, exec.failed ? 0.15 : 0.3), dd), exec };
}

export function judgeSynchro(
  a: DiveRecord,
  b: DiveRecord,
  dd: number,
  seed: number,
): { score: SynchroScore; execA: Execution; execB: Execution; sync: SyncResult } {
  const execA = execution(a);
  const execB = execution(b);
  const sync = synchronisation(a, b);
  const rng = new Rng(seed);
  const score = scoreSynchro(
    panel(rng, execA.base, 3, execA.failed ? 0.15 : 0.3),
    panel(rng, execB.base, 3, execB.failed ? 0.15 : 0.3),
    panel(rng, sync.base, 5, 0.3),
    dd,
  );
  return { score, execA, execB, sync };
}
