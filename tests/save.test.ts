import { describe, expect, it } from 'vitest';
import { CURRENT_VERSION, defaultSave, load, migrate, save } from '../src/core/save';
import { SAVE_KEY } from '../src/config';

class MemStore {
  m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
}

describe('save schema', () => {
  it('migrates a v1 save to the current version', () => {
    const v1 = { version: 1, volume: 0.3, pro: true, stars: { '1': 3, '2': 1 } };
    const s = migrate(v1);
    expect(s.version).toBe(CURRENT_VERSION);
    expect(s.settings.master).toBe(0.3);
    expect(s.settings.pro).toBe(true);
    expect(s.levels['1']).toEqual({ stars: 3, best: 0 });
    expect(s.ghosts).toEqual({});
    expect(s.unlocks.partners).toContain('ola');
  });

  it('migrates v2 and keeps settings', () => {
    const v2 = { version: 2, settings: { music: 0.1 }, levels: { '5': { stars: 2, best: 50 } }, records: { '103C@10': 60 } };
    const s = migrate(v2);
    expect(s.settings.music).toBe(0.1);
    expect(s.settings.keys.action).toContain('Space');
    expect(s.records['103C@10']).toBe(60);
  });

  it('migrates v3 and adds the synchro partner', () => {
    const v3 = { ...defaultSave(), version: 3, partner: undefined, outfit: 2, unlocks: { partners: ['ola', 'kuba'], outfits: [0, 2], arenas: ['day'] } };
    const s = migrate(v3);
    expect(s.version).toBe(4);
    expect(s.partner).toBe('ola');
    expect(s.outfit).toBe(2);
    expect(s.unlocks.partners).toEqual(['ola', 'kuba']);
  });

  it('falls back to defaults for unknown or broken data', () => {
    expect(migrate(null)).toEqual(defaultSave());
    expect(migrate({ version: 99 })).toEqual(defaultSave());
    const st = new MemStore();
    st.setItem(SAVE_KEY, '{broken');
    expect(load(st)).toEqual(defaultSave());
  });

  it('saves and loads', () => {
    const st = new MemStore();
    const s = defaultSave();
    s.levels['3'] = { stars: 2, best: 77.5 };
    save(s, st);
    expect(load(st).levels['3']).toEqual({ stars: 2, best: 77.5 });
  });
});
