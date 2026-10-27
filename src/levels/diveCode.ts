// Dive codes as used by World Aquatics, e.g. 107B, 405C, 5253B.
//
// Groups: 1 forward, 2 back, 3 reverse, 4 inward, 5 twisting, 6 armstand.
// Positions: A straight, B pike, C tuck, D free.

export type Position = 'A' | 'B' | 'C' | 'D';
export type Group = 1 | 2 | 3 | 4 | 5 | 6;

export interface DiveSpec {
  code: string;
  /** group of the direction of rotation (1-4); for twisting dives the second digit */
  dir: 1 | 2 | 3 | 4;
  group: Group;
  halfSoms: number;
  halfTwists: number;
  position: Position;
  flying: boolean;
  /** +1: diver faces the pool on the platform, -1: back to the pool */
  facing: 1 | -1;
  /** world rotation sign: +1 head moves away from the tower, -1 towards it */
  rot: 1 | -1;
  /** odd half somersaults enter head first */
  headFirst: boolean;
}

const DIR_NAMES = ['', 'w przód', 'w tył', 'odwrotny', 'do wieży'];
const POS_NAMES: Record<Position, string> = { A: 'prosta', B: 'łamana', C: 'kuczna', D: 'dowolna' };

export function parseDiveCode(raw: string): DiveSpec {
  const code = raw.trim().toUpperCase();
  const m = /^([1-6])(\d{2,3})([ABCD])$/.exec(code);
  if (!m) throw new Error(`Nieprawidłowy kod skoku: ${raw}`);
  const group = Number(m[1]) as Group;
  const digits = m[2]!;
  const position = m[3] as Position;
  let dir: 1 | 2 | 3 | 4;
  let halfSoms: number;
  let halfTwists = 0;
  let flying = false;
  if (group >= 1 && group <= 4) {
    if (digits.length !== 2) throw new Error(`Kod grupy ${group} ma 3 cyfry: ${raw}`);
    flying = digits[0] === '1';
    if (digits[0] !== '0' && digits[0] !== '1') throw new Error(`Druga cyfra musi być 0 lub 1: ${raw}`);
    dir = group as 1 | 2 | 3 | 4;
    halfSoms = Number(digits[1]);
  } else if (group === 5) {
    if (digits.length !== 3) throw new Error(`Kod skoku śrubowego ma 4 cyfry: ${raw}`);
    const d = Number(digits[0]);
    if (d < 1 || d > 4) throw new Error(`Nieprawidłowy kierunek w skoku śrubowym: ${raw}`);
    dir = d as 1 | 2 | 3 | 4;
    halfSoms = Number(digits[1]);
    halfTwists = Number(digits[2]);
  } else {
    throw new Error(`Skoki ze stania na rękach (grupa 6) nie są obsługiwane: ${raw}`);
  }
  if (halfSoms < 1) throw new Error(`Skok musi mieć co najmniej pół obrotu: ${raw}`);
  return {
    code,
    dir,
    group,
    halfSoms,
    halfTwists,
    position,
    flying,
    facing: dir === 1 || dir === 3 ? 1 : -1,
    rot: dir === 1 || dir === 2 ? 1 : -1,
    headFirst: halfSoms % 2 === 1,
  };
}

function frac(n: number): string {
  const whole = Math.floor(n / 2);
  const half = n % 2 === 1;
  if (whole === 0) return half ? '½' : '0';
  return `${whole}${half ? '½' : ''}`;
}

/** Short human readable name in Polish, e.g. "3½ salta w przód, łamana". */
export function diveName(d: DiveSpec): string {
  const soms = d.halfSoms === 1 ? 'skok' : `${frac(d.halfSoms)} salta`;
  const tw = d.halfTwists > 0 ? `, ${frac(d.halfTwists)} śr.` : '';
  return `${soms} ${DIR_NAMES[d.dir]}${tw}, ${POS_NAMES[d.position]}`;
}

/** Same somersaults/twists/position in another rotation group (platform ←/→ choice). */
export function withDir(d: DiveSpec, dir: 1 | 2 | 3 | 4): DiveSpec {
  const code =
    d.group === 5 ? `5${dir}${d.halfSoms}${d.halfTwists}${d.position}` : `${dir}${d.flying ? 1 : 0}${d.halfSoms}${d.position}`;
  return parseDiveCode(code);
}
