// Odbicie (prototype): trick values and the combo. Points sit in the combo
// until a clean dive into the pool banks them; a bail or a flat entry loses
// everything that was not banked. Values are first guesses, tune after play.

export type TrickPos = 'tuck' | 'pike' | 'straight';

export interface Trick {
  /** full somersaults on the trampoline, half somersaults for the pool dive */
  turns: number;
  pos: TrickPos;
  halfTwists: number;
  /** +1 forward (head moves the way the diver faces), -1 backward */
  dir: 1 | -1;
  pool: boolean;
}

/** points per full somersault on the trampoline */
export const SALTO_VALUE: Record<TrickPos, number> = { tuck: 200, pike: 300, straight: 400 };
/** points per half somersault in the dive into the pool */
export const POOL_VALUE: Record<TrickPos, number> = { tuck: 100, pike: 150, straight: 200 };
export const HALF_TWIST_VALUE = 150;
/** each new kind of trick in the combo adds this to the multiplier */
export const MULT_STEP = 0.5;
/** a repeated trick is worth this much less each time */
export const REPEAT_FACTOR = 0.5;

export function trickKey(t: Trick): string {
  return `${t.pool ? 'P' : 'T'}${t.turns}${t.pos[0]}${t.halfTwists}${t.dir > 0 ? 'f' : 'b'}`;
}

export function isTrick(t: Trick): boolean {
  return t.turns > 0 || t.halfTwists > 0;
}

/** base value before repeats and landing */
export function trickValue(t: Trick): number {
  const per = t.pool ? POOL_VALUE[t.pos] : SALTO_VALUE[t.pos];
  // more rotations in one go are worth more than the same rotations spread out
  const rot = per * t.turns * (1 + 0.25 * Math.max(0, t.turns - 1));
  return Math.round(rot + HALF_TWIST_VALUE * t.halfTwists);
}

const FRAC = (n: number) => {
  const whole = Math.floor(n / 2);
  const half = n % 2 === 1;
  if (whole === 0) return '½';
  return `${whole}${half ? '½' : ''}`;
};

const POS_NAME: Record<TrickPos, string> = { tuck: 'KUCZNE', pike: 'ŁAMANE', straight: 'PROSTE' };

/** e.g. "2 SALTA W TYŁ ŁAMANE + ½ ŚR." */
export function trickName(t: Trick): string {
  const halves = t.pool ? t.turns : t.turns * 2;
  const tw = t.halfTwists > 0 ? `${halves > 0 ? ' + ' : ''}${FRAC(t.halfTwists)} ŚR.` : '';
  if (halves === 0) return t.halfTwists > 0 ? tw.trim() : 'ODBICIE';
  const n = halves === 2 ? 'SALTO' : halves === 1 ? 'PÓŁ SALTA' : `${FRAC(halves)} SALTA`;
  return `${n} ${t.dir > 0 ? 'W PRZÓD' : 'W TYŁ'} ${POS_NAME[t.pos]}${tw}`;
}

export class Combo {
  /** points waiting to be banked */
  sum = 0;
  readonly seen = new Map<string, number>();
  count = 0;

  get mult(): number {
    return 1 + MULT_STEP * this.seen.size;
  }

  get empty(): boolean {
    return this.count === 0;
  }

  /** add a landed trick; `landing` scales its value (sloppy landings 0.5). Returns the points added. */
  add(t: Trick, landing = 1): number {
    if (!isTrick(t)) return 0;
    const key = trickKey(t);
    const reps = this.seen.get(key) ?? 0;
    const pts = Math.round(trickValue(t) * REPEAT_FACTOR ** reps * landing);
    this.seen.set(key, reps + 1);
    this.sum += pts;
    this.count++;
    return pts;
  }

  /** points the combo is worth when banked with this entry multiplier */
  value(entry: number): number {
    return Math.round(this.sum * this.mult * entry);
  }

  clear(): void {
    this.sum = 0;
    this.count = 0;
    this.seen.clear();
  }
}
