// Countries with simplified pixel-art flags (9x6). Real countries and flags
// are fine to use; no federations, logos or real athletes.

import { C, type ColorIndex } from '../render/palette';

export interface Flag {
  layout: 'h' | 'v';
  colors: ColorIndex[];
  mark?: { kind: 'dot' | 'cross' | 'canton' | 'star' | 'centerCross' | 'triangle'; color: ColorIndex };
}

export interface Country {
  code: string;
  name: string;
  flag: Flag;
}

export const COUNTRIES: Country[] = [
  { code: 'POL', name: 'Polska', flag: { layout: 'h', colors: [C.white, C.red] } },
  { code: 'GER', name: 'Niemcy', flag: { layout: 'h', colors: [C.black, C.red, C.gold] } },
  { code: 'ITA', name: 'Włochy', flag: { layout: 'v', colors: [C.green, C.white, C.red] } },
  { code: 'FRA', name: 'Francja', flag: { layout: 'v', colors: [C.deepBlue, C.white, C.red] } },
  { code: 'JPN', name: 'Japonia', flag: { layout: 'h', colors: [C.white], mark: { kind: 'dot', color: C.red } } },
  { code: 'CHN', name: 'Chiny', flag: { layout: 'h', colors: [C.red], mark: { kind: 'star', color: C.gold } } },
  { code: 'UKR', name: 'Ukraina', flag: { layout: 'h', colors: [C.blue, C.gold] } },
  { code: 'SWE', name: 'Szwecja', flag: { layout: 'h', colors: [C.blue], mark: { kind: 'cross', color: C.gold } } },
  { code: 'NOR', name: 'Norwegia', flag: { layout: 'h', colors: [C.red], mark: { kind: 'cross', color: C.deepBlue } } },
  { code: 'USA', name: 'USA', flag: { layout: 'h', colors: [C.red, C.white, C.red, C.white, C.red, C.white], mark: { kind: 'canton', color: C.deepBlue } } },
  { code: 'CAN', name: 'Kanada', flag: { layout: 'v', colors: [C.red, C.white, C.white, C.red], mark: { kind: 'dot', color: C.red } } },
  { code: 'MEX', name: 'Meksyk', flag: { layout: 'v', colors: [C.darkGreen, C.white, C.red] } },
  { code: 'BRA', name: 'Brazylia', flag: { layout: 'h', colors: [C.green], mark: { kind: 'dot', color: C.gold } } },
  { code: 'GBR', name: 'Wielka Brytania', flag: { layout: 'h', colors: [C.deepBlue], mark: { kind: 'centerCross', color: C.red } } },
  { code: 'NED', name: 'Holandia', flag: { layout: 'h', colors: [C.red, C.white, C.deepBlue] } },
  { code: 'ESP', name: 'Hiszpania', flag: { layout: 'h', colors: [C.red, C.gold, C.gold, C.red] } },
  { code: 'AUS', name: 'Australia', flag: { layout: 'h', colors: [C.deepBlue], mark: { kind: 'star', color: C.white } } },
  { code: 'CZE', name: 'Czechy', flag: { layout: 'h', colors: [C.white, C.red], mark: { kind: 'triangle', color: C.deepBlue } } },
  { code: 'AUT', name: 'Austria', flag: { layout: 'h', colors: [C.red, C.white, C.red] } },
  { code: 'HUN', name: 'Węgry', flag: { layout: 'h', colors: [C.red, C.white, C.green] } },
  { code: 'IRL', name: 'Irlandia', flag: { layout: 'v', colors: [C.green, C.white, C.orange] } },
  { code: 'BEL', name: 'Belgia', flag: { layout: 'v', colors: [C.black, C.gold, C.red] } },
  { code: 'COL', name: 'Kolumbia', flag: { layout: 'h', colors: [C.gold, C.gold, C.blue, C.red] } },
  { code: 'KOR', name: 'Korea Płd.', flag: { layout: 'h', colors: [C.white], mark: { kind: 'dot', color: C.blue } } },
];

export function country(code: string): Country {
  const c = COUNTRIES.find((x) => x.code === code);
  if (!c) throw new Error(`Unknown country ${code}`);
  return c;
}
