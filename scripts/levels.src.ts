// Source table for src/levels/levels.json. The thresholds (sync, score,
// stars) are derived here from the tier and the DD so they stay consistent.
// Regenerate with: npm run levels:gen   (tests/levels.data.test.ts checks it)

import type { LevelDef, Modifier } from '../src/levels/levels';
import { parseDiveCode } from '../src/levels/diveCode';
import { degreeOfDifficulty } from '../src/scoring/dd';

type Src = Pick<LevelDef, 'id' | 'name' | 'dives' | 'partner' | 'tip'> & Partial<Pick<LevelDef, 'ribbon' | 'modifiers' | 'unlock' | 'rivals'>>;
const L = (id: number, name: string, dives: string[], partner: string, opts: Partial<Src> & { tip: string }): Src => ({ id, name, dives, partner, ...opts });
export const LEVEL_SOURCE: Src[] = [
  L(1, 'Wybicie', ['101C'], 'ola', { tip: 'Trzymaj AKCJĘ na 3-2-1, puść na HEP w złotej strefie.' }),
  L(2, 'Kuczka', ['103C'], 'ola', { tip: 'W locie TRZYMAJ strzałkę obrotu (→): kuczka kręci szybciej.' }),
  L(3, 'Otwarcie', ['201C'], 'ola', { tip: 'Trzymaj strzałkę obrotu, PUŚĆ ją, żeby się otworzyć.' }),
  L(4, 'Linia wejścia', ['203C'], 'ola', { tip: 'Otwórz się, gdy linia przy skoczku zrobi się zielona.' }),
  L(5, 'RIP', ['101B'], 'ola', { tip: 'Tuż przed wodą wciśnij AKCJĘ jeszcze raz: chwyt płaską dłonią.', unlock: { partner: 'kuba' } }),
  L(6, 'Łamana', ['201B'], 'ola', { tip: 'Skok łamany: trzymaj strzałkę obrotu, ciało samo się złamie.' }),
  L(7, 'Do wieży', ['301C'], 'kuba', { tip: 'Skok odwrotny kręci w stronę wieży. Wybij się w strefie!' }),
  L(8, 'Do środka', ['401C'], 'kuba', { tip: 'Tyłem do wody, obrót w przód. Pilnuj wybicia.' }),
  L(9, 'Nogami w dół', ['102C'], 'ola', { tip: 'Pełne salto kończy się wejściem nogami.' }),
  L(10, 'Finał juniorów', ['101B', '201C', '401C'], 'kuba', { tip: 'Trzy serie. Podium wygrywa.', rivals: 5, unlock: { partner: 'mila', outfit: 1 } }),
  L(11, 'Półtora', ['103B'], 'kuba', { tip: 'Łamana kręci wolniej niż kuczka: otwórz później.' }),
  L(12, 'Półtora w tył', ['203C'], 'mila', { tip: 'Mila wybija się późno. Słuchaj HEP i patrz na wstęgę.' }),
  L(13, 'Odwrotne półtora', ['303C'], 'mila', { tip: 'Rotacja do wieży: odważnie od platformy.' }),
  L(14, 'Do środka półtora', ['403C'], 'mila', { tip: 'Linia wejścia pokaże moment otwarcia.' }),
  L(15, 'Wieczorny skok', ['203B'], 'kuba', { tip: 'Hala nocna. Łamana w tył.', modifiers: ['night'], unlock: { partner: 'igor', arena: 'night' } }),
  L(16, 'Pierwsza śruba', ['5112D'], 'igor', { tip: '↑ = pół śruby. Śruby kręcą się tylko w pozycji otwartej.' }),
  L(17, 'Śruba w przód', ['5122D'], 'igor', { tip: 'Otwórz się, potem stuknij ↑ dwa razy.' }),
  L(18, 'Śruba w tył', ['5221D'], 'igor', { tip: 'Pół śruby w skoku w tył.' }),
  L(19, 'Łamane odwrotne', ['303B'], 'mila', { tip: 'Łamana, rotacja do wieży.', modifiers: ['night'] }),
  L(20, 'Finał krajowy', ['203B', '5122D', '403C'], 'igor', { tip: 'Trzy serie, mocniejsi rywale.', rivals: 6, unlock: { partner: 'zoja', outfit: 2 } }),
  L(21, 'Półtora ze śrubą', ['5132D'], 'zoja', { tip: 'Zoja jest precyzyjna jak metronom.' }),
  L(22, 'Śruba w tył 2', ['5231D'], 'zoja', { tip: 'Salto w tył z półtorej śruby.' }),
  L(23, 'Łamane do środka', ['403B'], 'zoja', { tip: 'Do środka, łamana.', modifiers: ['night'] }),
  L(24, 'Bez wstęgi', ['103B'], 'ola', { tip: 'Wstęgi nie ma. Patrz na partnera i słuchaj HEP.', ribbon: false }),
  L(25, 'Plener', ['5132D'], 'zoja', { tip: 'Basen na otwartym powietrzu, bez wstęgi.', ribbon: false, modifiers: ['outdoor'], unlock: { partner: 'tymon', arena: 'outdoor' } }),
  L(26, 'Dwa i pół', ['105C'], 'ola', { tip: '2½ salta: kuczka i późne otwarcie.' }),
  L(27, 'Dwa i pół w tył', ['205C'], 'tymon', { tip: 'Tymon skacze późno i mocno.' }),
  L(28, 'Odwrotne 2½', ['305C'], 'tymon', { tip: 'Do wieży, 2½ salta.', modifiers: ['outdoor'] }),
  L(29, 'Do środka 2½', ['405C'], 'zoja', { tip: 'Do środka, 2½ salta.' }),
  L(30, 'Finał kontynentalny', ['105C', '205C', '305C', '405C'], 'zoja', { tip: 'Cztery serie.', rivals: 7, unlock: { partner: 'lena', outfit: 3 } }),
  L(31, 'Łamane 2½', ['105B'], 'tymon', { tip: 'Wstęga pokazuje tylko najbliższe ruchy.', modifiers: ['shortRibbon'] }),
  L(32, 'Łamane 2½ w tył', ['205B'], 'lena', { tip: 'Lena zawsze trafia w pion.', modifiers: ['shortRibbon', 'night'] }),
  L(33, 'Trzy i pół', ['107C'], 'lena', { tip: 'Bez wstęgi. Patrz na Lenę.', ribbon: false }),
  L(34, 'Trzy i pół w tył', ['207C'], 'lena', { tip: '3½ salta w tył.', ribbon: false, modifiers: ['outdoor'] }),
  L(35, 'Bez linii', ['307C'], 'lena', { tip: 'Linia wejścia wyłączona. Czuj obrót.', modifiers: ['noLine'], unlock: { partner: 'bruno', outfit: 4 } }),
  L(36, 'Kombinacja I', ['5152B'], 'igor', { tip: '2½ salta i śruba.' }),
  L(37, 'Kombinacja II', ['5253B'], 'igor', { tip: 'W tył: 2½ salta, 1½ śruby.' }),
  L(38, 'Kombinacja III', ['5353B'], 'igor', { tip: 'Odwrotny: 2½ salta, 1½ śruby.', modifiers: ['night'] }),
  L(39, 'Do środka 3½', ['407C'], 'bruno', { tip: 'Bruno otwiera bardzo wcześnie.', ribbon: false, modifiers: ['noLine'] }),
  L(40, 'Finał świata', ['107C', '5253B', '307C', '205B'], 'lena', { tip: 'Cztery serie, światowa czołówka.', rivals: 8, unlock: { outfit: 5 } }),
  L(41, 'Dwie śruby', ['5154B'], 'zoja', { tip: '2½ salta, 2 śruby.', ribbon: false }),
  L(42, 'Dwie i pół śruby', ['5255B'], 'igor', { tip: 'W tył: 2½ śruby.', ribbon: false, modifiers: ['noLine'] }),
  L(43, 'Odwrotne śruby', ['5355B'], 'lena', { tip: 'Odwrotny z 2½ śruby.', ribbon: false, modifiers: ['noLine', 'outdoor'] }),
  L(44, '3½ ze śrubą', ['5172B'], 'tymon', { tip: '3½ salta i pół śruby.', ribbon: false }),
  L(45, 'Łamane 3½ w tył', ['207B'], 'bruno', { tip: 'Bez wstęgi, bez linii.', ribbon: false, modifiers: ['noLine', 'night'], unlock: { outfit: 6 } }),
  L(46, 'Cztery i pół', ['109C'], 'zoja', { tip: 'Granica fizyki: 4½ salta.', ribbon: false, modifiers: ['noLine'] }),
  L(47, '4½ w tył', ['209C'], 'lena', { tip: 'Bez asysty ramion.', ribbon: false, modifiers: ['noLine', 'noAssist'] }),
  L(48, '4½ łamane', ['109B'], 'tymon', { tip: 'Łamana przy 4½ salta.', ribbon: false, modifiers: ['noLine'] }),
  L(49, 'Śruby na granicy', ['5257B'], 'igor', { tip: '2½ salta, 3½ śruby.', ribbon: false, modifiers: ['noLine', 'outdoor'] }),
  L(50, 'Wielki finał', ['109C', '5255B', '307B', '209C', '5257B'], 'lena', { tip: 'Pięć serii o złoto.', ribbon: false, rivals: 8, modifiers: ['noLine'], unlock: { outfit: 7 } }),
];

/** required fraction of the maximum synchro score (30 x DD) by level */
export function passFraction(id: number): number {
  const lerp = (a: number, b: number, lo: number, hi: number) => a + ((b - a) * (id - lo)) / Math.max(1, hi - lo);
  if (id <= 5) return 0.45;
  if (id <= 15) return lerp(0.55, 0.62, 6, 15);
  if (id <= 25) return lerp(0.62, 0.66, 16, 25);
  if (id <= 35) return lerp(0.66, 0.7, 26, 35);
  if (id <= 45) return lerp(0.7, 0.74, 36, 45);
  return lerp(0.74, 0.78, 46, 50);
}

export function syncFor(id: number): number {
  if (id <= 5) return 0;
  return [6, 6.5, 7, 7.5, 8][Math.min(4, Math.floor((id - 6) / 10))]!;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

export function buildLevels(): LevelDef[] {
  return LEVEL_SOURCE.map((s) => {
    const f = passFraction(s.id);
    const max = s.dives.reduce((a, c) => a + 30 * degreeOfDifficulty(parseDiveCode(c)), 0);
    const def: LevelDef = {
      id: s.id,
      name: s.name,
      dives: s.dives,
      partner: s.partner,
      syncMin: syncFor(s.id),
      scoreMin: r1(max * f),
      stars: [r1(max * Math.min(0.88, f + 0.1)), r1(max * Math.min(0.93, f + 0.18))],
      ribbon: s.ribbon ?? true,
      modifiers: (s.modifiers ?? []) as Modifier[],
      tip: s.tip,
    };
    if (s.unlock) def.unlock = s.unlock;
    if (s.rivals) def.rivals = s.rivals;
    return def;
  });
}
