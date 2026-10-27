// AI synchro partners. Each partner runs the same physics with scripted
// inputs from the bot, humanised by a personality: tempo (early or late),
// timing spread, opening style and rip habits.

import { Rng } from '../core/rng';
import { DiverSim, IN, type DiveSetup } from '../physics/diver';
import { Bot, PERFECT_BOT, type BotParams } from './bot';
import type { DiverLook } from '../render/sprites';
import { C } from '../render/palette';

export interface Partner {
  id: string;
  name: string;
  country: string;
  look: DiverLook;
  /** mean take-off offset from HEP (s): negative = eager, positive = lazy */
  tempo: number;
  /** timing spread (s, standard deviation) */
  jitter: number;
  /** opening habit in degrees on the entry line (negative = opens early) */
  openBias: number;
  /** rip lead before contact (s) */
  ripLead: number;
  style: string;
}

export const PARTNERS: Partner[] = [
  { id: 'ola', name: 'Ola Fala', country: 'POL', look: { outfit: 0, hair: C.brown, skin: 1 }, tempo: 0, jitter: 0.012, openBias: -1, ripLead: 0.06, style: 'Spokojna i równa. Idealna na początek.' },
  { id: 'kuba', name: 'Kuba Wir', country: 'POL', look: { outfit: 1, hair: C.black, skin: 0 }, tempo: -0.03, jitter: 0.02, openBias: 1.5, ripLead: 0.05, style: 'Gorący start, lubi się przekręcić.' },
  { id: 'mila', name: 'Mila Kropla', country: 'CZE', look: { outfit: 3, hair: C.gold, skin: 1 }, tempo: 0.025, jitter: 0.015, openBias: -2, ripLead: 0.07, style: 'Wybija się późno, otwiera wcześnie.' },
  { id: 'igor', name: 'Igor Śruba', country: 'UKR', look: { outfit: 4, hair: C.darkBrown, skin: 0 }, tempo: 0, jitter: 0.025, openBias: 0.5, ripLead: 0.05, style: 'Mistrz śrub, ale nierówny w tempie.' },
  { id: 'zoja', name: 'Zoja Rip', country: 'GER', look: { outfit: 2, hair: C.orange, skin: 1 }, tempo: -0.01, jitter: 0.01, openBias: 0, ripLead: 0.06, style: 'Precyzyjna jak metronom.' },
  { id: 'tymon', name: 'Tymon Salto', country: 'ITA', look: { outfit: 7, hair: C.black, skin: 2 }, tempo: 0.035, jitter: 0.03, openBias: 2.5, ripLead: 0.04, style: 'Showman: późno, mocno, efektownie.' },
  { id: 'lena', name: 'Lena Pion', country: 'SWE', look: { outfit: 5, hair: C.paleYellow, skin: 1 }, tempo: -0.02, jitter: 0.008, openBias: -0.5, ripLead: 0.065, style: 'Chłodna głowa, zawsze w pionie.' },
  { id: 'bruno', name: 'Bruno Bryza', country: 'BRA', look: { outfit: 6, hair: C.darkBrown, skin: 2 }, tempo: 0.015, jitter: 0.02, openBias: -3, ripLead: 0.075, style: 'Luz i rytm. Otwiera bardzo wcześnie.' },
];

export function partnerById(id: string): Partner {
  return PARTNERS.find((p) => p.id === id) ?? PARTNERS[0]!;
}

export function humanize(p: Partner, seed: number): BotParams {
  const rng = new Rng(seed);
  return {
    ...PERFECT_BOT,
    releaseDelay: p.tempo + rng.gauss() * p.jitter,
    bendDelay: 0.06 + Math.abs(rng.gauss()) * p.jitter,
    openBias: p.openBias + rng.gauss() * 1.2,
    ripLead: Math.max(0.01, p.ripLead + rng.gauss() * p.jitter * 0.7),
    twistDelay: 0.02 + Math.abs(rng.gauss()) * p.jitter,
  };
}

export type CueKind = 'jump' | 'tuck' | 'pike' | 'open' | 'twist' | 'rip';

export interface Cue {
  t: number;
  kind: CueKind;
}

export interface PartnerDive {
  inputs: number[];
  cues: Cue[];
  params: BotParams;
}

/** Simulate the partner's whole dive ahead of time (deterministic). */
export function planPartnerDive(setup: DiveSetup, p: Partner, seed: number): PartnerDive {
  const params = humanize(p, seed);
  const sim = new DiverSim(setup);
  const bot = new Bot(params);
  const inputs: number[] = [];
  const cues: Cue[] = [];
  let prev = 0;
  for (let i = 0; i < 120 * 14 && sim.phase !== 'done'; i++) {
    const phase = sim.phase;
    const inp = bot.input(sim);
    const pressed = inp & ~prev;
    const released = ~inp & prev;
    const t = sim.t;
    if (phase === 'charge' && released & IN.ACTION) cues.push({ t, kind: 'jump' });
    if (phase === 'flight') {
      if (pressed & IN.ACTION) {
        const ripping = sim.entry === null && sim.timeToContact() <= 0.3 && cues.some((c) => c.kind === 'open');
        cues.push({ t, kind: ripping ? 'rip' : inp & IN.DOWN ? 'pike' : 'tuck' });
      }
      if (released & IN.ACTION && cues[cues.length - 1]?.kind !== 'rip') cues.push({ t, kind: 'open' });
      if (pressed & IN.UP) cues.push({ t, kind: 'twist' });
    }
    inputs.push(inp);
    sim.step(inp);
    prev = inp;
  }
  return { inputs, cues, params };
}
