// On-screen coach: tells the player what to press right now, read from the
// same state the player sees. Calls that need a reaction ("let go", "rip")
// come early by about a human reaction time.

import { DiverSim, IN, LINE_GREEN_DEG, RIP_GOOD } from '../physics/diver';
import { C } from '../render/palette';

export interface Hint {
  text: string;
  color: number;
  /** a call to act now: shown big */
  now: boolean;
}

/** typical reaction time (s): "let go" shows up this early */
export const REACTION = 0.18;

/** the arrow that spins the diver, as shown on screen */
export function arrowOf(sim: DiverSim): '←' | '→' {
  return sim.spinArrow === IN.RIGHT ? '→' : '←';
}

export class Coach {
  private prevErr = Number.NaN;
  private prevT = 0;

  hint(sim: DiverSim): Hint | null {
    const hep = sim.setup.hepTime;
    switch (sim.phase) {
      case 'ready':
        return hep !== undefined
          ? { text: `TRZYMAJ AKCJĘ na 3-2-1, PUŚĆ na HEP. Obrót: ${arrowOf(sim)}`, color: C.white, now: false }
          : { text: `TRZYMAJ AKCJĘ (spacja). Obrót: ${arrowOf(sim)}`, color: C.white, now: false };
      case 'charge': {
        if (hep !== undefined) {
          return sim.t >= hep - REACTION ? { text: 'PUŚĆ!', color: C.lime, now: true } : { text: 'TRZYMAJ... puść na HEP', color: C.white, now: false };
        }
        const [lo, hi] = sim.zone;
        // the ring grows by about 1/0.75 of its range per second
        const soon = sim.power + (sim.powerRising ? 1 : -1) * (REACTION / 0.75);
        if (sim.powerRising && soon >= lo && sim.power <= hi) return { text: 'PUŚĆ!', color: C.lime, now: true };
        return { text: 'TRZYMAJ... puść, gdy koło dojdzie do złotego', color: C.white, now: false };
      }
      case 'push':
        // the curl comes right after take-off: call it while the legs push
        return sim.dive.position !== 'A' ? { text: `TRZYMAJ ${arrowOf(sim)}`, color: C.orange, now: true } : null;
      case 'flight':
        return this.flight(sim);
      default:
        return null;
    }
  }

  private flight(sim: DiverSim): Hint | null {
    const d = sim.dive;
    const ttc = sim.timeToContact();
    if (sim.ripArmed) {
      if (sim.ripDone) return null;
      return ttc <= RIP_GOOD + REACTION * 0.5 ? { text: 'RIP: AKCJA!', color: C.cyan, now: true } : { text: 'RIP: AKCJA tuż przed wodą', color: C.cyan, now: false };
    }
    const bend = d.position !== 'A';
    const arrow = arrowOf(sim);
    if (bend && !sim.hasBent) return { text: `TRZYMAJ ${arrow}`, color: C.orange, now: true };
    if (sim.pose !== 'open') {
      const err = sim.flightProgress > 0.15 ? sim.predictEntryError() : -999;
      const dt = sim.t - this.prevT;
      const rate = Number.isFinite(this.prevErr) && err > -900 && dt > 0 ? (err - this.prevErr) / dt : 0;
      this.prevErr = err > -900 ? err : Number.NaN;
      this.prevT = sim.t;
      if (err > -900 && err + Math.max(0, rate) * REACTION >= -LINE_GREEN_DEG) return { text: 'PUŚĆ: OTWÓRZ!', color: C.lime, now: true };
      return { text: `TRZYMAJ ${arrow}... kręcisz się`, color: C.orange, now: false };
    }
    this.prevErr = Number.NaN;
    const done = sim.queuedHalfTwists;
    if (done < d.halfTwists) return { text: `↑ ŚRUBA ${done}/${d.halfTwists}`, color: C.sky, now: true };
    if (sim.lineVisible) return { text: 'Lecisz prosto. Za chwilę RIP', color: C.lightGrey, now: false };
    return null;
  }
}
