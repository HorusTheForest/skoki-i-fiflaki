// Progress saved in localStorage with a versioned schema and migrations.

import { SAVE_KEY } from '../config';

export type Bindable = 'action' | 'up' | 'down' | 'left' | 'right' | 'back';

export interface Settings {
  master: number;
  music: number;
  sfx: number;
  crowd: number;
  /** KeyboardEvent.code values per logical button */
  keys: Record<Bindable, string[]>;
  /** gamepad button indices per logical button */
  pad: Record<Bindable, number[]>;
  assist: boolean;
  entryLine: boolean;
  rhythmRibbon: boolean;
  pro: boolean;
  reduceFlashes: boolean;
  vibration: boolean;
}

export interface LevelProgress {
  stars: number;
  best: number;
}

export interface SaveData {
  version: 4;
  settings: Settings;
  levels: Record<string, LevelProgress>;
  /** freestyle records per "code@height" */
  records: Record<string, number>;
  /** best dive replays (encoded) per "code@height" or level id */
  ghosts: Record<string, string>;
  unlocks: { partners: string[]; outfits: number[]; arenas: string[] };
  outfit: number;
  arena: string;
  /** partner for synchro training */
  partner: string;
}

export const DEFAULT_KEYS: Record<Bindable, string[]> = {
  action: ['Space', 'Enter'],
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  back: ['Escape', 'Backspace'],
};

export const DEFAULT_PAD: Record<Bindable, number[]> = {
  action: [0],
  up: [12],
  down: [13],
  left: [14],
  right: [15],
  back: [1, 9],
};

export function defaultSettings(): Settings {
  return {
    master: 0.8,
    music: 0.6,
    sfx: 0.9,
    crowd: 0.6,
    keys: structuredClone(DEFAULT_KEYS),
    pad: structuredClone(DEFAULT_PAD),
    assist: true,
    entryLine: true,
    rhythmRibbon: true,
    pro: false,
    reduceFlashes: false,
    vibration: true,
  };
}

export function defaultSave(): SaveData {
  return {
    version: 4,
    settings: defaultSettings(),
    levels: {},
    records: {},
    ghosts: {},
    unlocks: { partners: ['ola'], outfits: [0], arenas: ['day'] },
    outfit: 0,
    arena: 'day',
    partner: 'ola',
  };
}

type AnySave = { version?: number } & Record<string, unknown>;

/**
 * Migrations: index n upgrades a version n+1 save to version n+2.
 * v1 (first public build): { version: 1, volume, stars: {levelId: n}, pro }
 * v2: settings object, levels with best scores, no ghosts/unlocks
 * v3: ghosts, unlocks, outfit, arena, rhythmRibbon setting
 * v4: chosen synchro partner
 */
const MIGRATIONS: ((s: AnySave) => AnySave)[] = [
  (v1) => {
    const stars = (v1['stars'] as Record<string, number> | undefined) ?? {};
    const settings = defaultSettings();
    if (typeof v1['volume'] === 'number') settings.master = v1['volume'] as number;
    if (typeof v1['pro'] === 'boolean') settings.pro = v1['pro'] as boolean;
    const levels: Record<string, LevelProgress> = {};
    for (const [k, n] of Object.entries(stars)) levels[k] = { stars: n, best: 0 };
    return { version: 2, settings, levels, records: {} };
  },
  (v2) => {
    const base = defaultSave();
    const settings = { ...base.settings, ...(v2['settings'] as Partial<Settings>) };
    return {
      ...base,
      settings,
      levels: (v2['levels'] as Record<string, LevelProgress>) ?? {},
      records: (v2['records'] as Record<string, number>) ?? {},
      version: 3,
    };
  },
  (v3) => {
    const unlocked = ((v3['unlocks'] as { partners?: string[] } | undefined)?.partners ?? ['ola'])[0] ?? 'ola';
    return { ...v3, partner: unlocked, version: 4 };
  },
];

export const CURRENT_VERSION = 4;

export function migrate(raw: unknown): SaveData {
  if (!raw || typeof raw !== 'object') return defaultSave();
  let s = raw as AnySave;
  let v = typeof s.version === 'number' ? s.version : 1;
  if (v > CURRENT_VERSION) return defaultSave();
  while (v < CURRENT_VERSION) {
    const m = MIGRATIONS[v - 1];
    if (!m) return defaultSave();
    s = m(s);
    v = s.version as number;
  }
  // fill fields added later in the same version with defaults
  const base = defaultSave();
  const out = { ...base, ...(s as unknown as SaveData) };
  out.settings = { ...base.settings, ...out.settings };
  out.settings.keys = { ...base.settings.keys, ...out.settings.keys };
  out.settings.pad = { ...base.settings.pad, ...out.settings.pad };
  out.unlocks = { ...base.unlocks, ...out.unlocks };
  return out;
}

interface Store {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

function storage(): Store | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

let current: SaveData | null = null;

export function load(store: Store | null = storage()): SaveData {
  let data: SaveData;
  try {
    const raw = store?.getItem(SAVE_KEY);
    data = raw ? migrate(JSON.parse(raw)) : defaultSave();
  } catch {
    data = defaultSave();
  }
  current = data;
  return data;
}

export function save(data: SaveData = getSave(), store: Store | null = storage()): void {
  current = data;
  try {
    store?.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {
    // storage full or blocked: keep playing with in-memory progress
  }
}

export function getSave(): SaveData {
  return current ?? load();
}

export function settings(): Settings {
  return getSave().settings;
}
