// Closed-loop bot: reads the same state the player sees (power ring, entry
// line, distance to the water) and produces the same inputs (bitmask per
// tick). Used for the AI partner (with humanisation), for level validation
// in CI and for calibration tests.

import { DiverSim, IN, ZONE_CENTER, referenceOpenTime } from '../physics/diver';

export interface BotParams {
  /** solo: release when power reaches ZONE_CENTER + this */
  powerOffset: number;
  /** synchro: release this many seconds after HEP */
  releaseDelay: number;
  /** start charging this long before HEP (synchro) or at this time (solo) */
  chargeLead: number;
  /** delay between take-off and bending (s) */
  bendDelay: number;
  /** open when the entry line shows this error (deg); negative opens earlier */
  openBias: number;
  /** press the rip this long before contact (s) */
  ripLead: number;
  /** delay between opening and the first twist tap (s) */
  twistDelay: number;
  /** use the save when the predicted error exceeds this (deg); Infinity = never */
  saveAbove: number;
}

export const PERFECT_BOT: BotParams = {
  powerOffset: 0,
  releaseDelay: 0,
  chargeLead: 0.9,
  bendDelay: 0.06,
  openBias: 0,
  ripLead: 0.06,
  twistDelay: 0.02,
  saveAbove: Infinity,
};

export class Bot {
  private takeoffT = -1;
  private openedT = -1;
  private twistsTapped = 0;
  private lastTap = -1;
  private ripped = false;
  private bent = false;
  private released = false;
  private saved = false;
  private prevErr = Number.NaN;

  constructor(private readonly p: BotParams) {}

  input(sim: DiverSim): number {
    const d = sim.dive;
    switch (sim.phase) {
      case 'ready': {
        const hep = sim.setup.hepTime;
        const start = hep !== undefined ? hep - this.p.chargeLead : this.p.chargeLead * 0.25;
        return sim.t >= start ? IN.ACTION : 0;
      }
      case 'charge': {
        if (this.released) return 0;
        const hep = sim.setup.hepTime;
        let go: boolean;
        if (hep !== undefined) go = sim.t >= hep + this.p.releaseDelay - 1e-9;
        else go = sim.powerRising && sim.power >= ZONE_CENTER + this.p.powerOffset;
        if (go) {
          this.released = true;
          return 0;
        }
        return IN.ACTION;
      }
      case 'push':
        return 0;
      case 'flight':
        return this.flight(sim, d.position === 'A' ? 0 : d.position === 'B' ? IN.ACTION | IN.DOWN : IN.ACTION);
      default:
        return 0;
    }
  }

  private flight(sim: DiverSim, bend: number): number {
    if (this.takeoffT < 0) this.takeoffT = sim.t;
    const since = sim.t - this.takeoffT;
    const d = sim.dive;
    const ttc = sim.timeToContact();
    let input = 0;

    if (this.openedT < 0) {
      if (bend && since >= this.p.bendDelay) {
        const err = sim.flightProgress > 0.15 ? sim.predictEntryError() : -999;
        // open on the tick closest to the target, using the line's speed
        const step = Number.isFinite(this.prevErr) && err > -900 ? err - this.prevErr : 0;
        if (err > -900) this.prevErr = err;
        const forced = ttc <= referenceOpenTime(d) * 0.55;
        if (this.bent && (err >= this.p.openBias - step / 2 || forced)) {
          this.openedT = sim.t;
        } else {
          this.bent = true;
          input |= bend;
        }
      } else if (!bend) {
        this.openedT = sim.t;
      }
    }

    if (this.openedT >= 0) {
      if (
        this.twistsTapped < d.halfTwists &&
        sim.t - this.openedT >= this.p.twistDelay &&
        sim.tick - this.lastTap >= 2
      ) {
        input |= IN.UP;
        this.twistsTapped++;
        this.lastTap = sim.tick;
      }
      if (!this.saved && ttc <= 0.19 && ttc > 0.05 && Number.isFinite(this.p.saveAbove)) {
        const err = sim.rotationError() + sim.omega * ttc * sim.dive.rot * (180 / Math.PI);
        if (Math.abs(err) > this.p.saveAbove) {
          this.saved = true;
          input |= -sim.dive.rot * Math.sign(err) > 0 ? IN.RIGHT : IN.LEFT;
        }
      }
      if (!this.ripped && ttc <= this.p.ripLead && since > 0.3) {
        this.ripped = true;
        input |= IN.ACTION;
      }
    }
    return input;
  }
}

/** Run a whole dive with the bot and return the finished simulation and its inputs. */
export function runBot(sim: DiverSim, params: BotParams = PERFECT_BOT, maxTicks = 120 * 12): { sim: DiverSim; inputs: number[] } {
  const bot = new Bot(params);
  const inputs: number[] = [];
  while (sim.phase !== 'done' && inputs.length < maxTicks) {
    const i = bot.input(sim);
    inputs.push(i);
    sim.step(i);
  }
  return { sim, inputs };
}
