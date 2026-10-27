// Settings: volumes, assists, Pro mode, flashes, vibration, and remapping
// of keyboard keys and gamepad buttons. Everything is saved immediately.

import Phaser from 'phaser';
import { HEIGHT, WIDTH } from '../config';
import { C, col } from '../render/palette';
import { Menu, type MenuItem } from '../ui/menu';
import { txt } from '../ui/text';
import { input } from '../core/input';
import { DEFAULT_KEYS, DEFAULT_PAD, defaultSettings, getSave, save, settings, type Bindable, type Settings } from '../core/save';
import { audio } from '../audio/engine';

type Page = 'main' | 'keys' | 'pad';

const NAMES: Record<Bindable, string> = {
  action: 'AKCJA',
  up: 'GÓRA',
  down: 'DÓŁ',
  left: 'LEWO',
  right: 'PRAWO',
  back: 'WSTECZ',
};
const ORDER: Bindable[] = ['action', 'up', 'down', 'left', 'right', 'back'];

/** short readable name of a KeyboardEvent.code */
function keyName(code: string): string {
  const arrows: Record<string, string> = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };
  if (arrows[code]) return arrows[code]!;
  return code.replace(/^Key/, '').replace(/^Digit/, '').replace('Escape', 'Esc').replace('Backspace', 'Bksp').replace('Space', 'Spacja');
}

export class SettingsScene extends Phaser.Scene {
  private menu!: Menu;
  private page: Page = 'main';
  private prompt!: Phaser.GameObjects.BitmapText;

  constructor() {
    super('Settings');
  }

  init(data: { page?: Page }): void {
    this.page = data.page ?? 'main';
  }

  create(): void {
    this.cameras.main.setBackgroundColor(col(C.navy));
    const title = { main: 'USTAWIENIA', keys: 'KLAWISZE', pad: 'PAD' }[this.page];
    txt(this, 8, 6, title, C.gold);
    this.prompt = txt(this, WIDTH - 8, 6, '', C.lime, 'right').setDepth(101);
    const items = this.page === 'main' ? this.mainItems() : this.bindItems(this.page);
    this.menu = new Menu(this, items, 14, 20, 292, 10, HEIGHT - 11);
    this.menu.onBack = () => this.back();
  }

  private back(): void {
    const inp = input();
    inp.captureKey = null;
    inp.capturePad = null;
    if (this.page === 'main') this.scene.start('Menu');
    else this.scene.restart({ page: 'main' });
  }

  private change(f: (s: Settings) => void): void {
    f(settings());
    save(getSave());
    audio.applyVolumes();
  }

  private mainItems(): MenuItem[] {
    const s = () => settings();
    const pct = (v: number) => `${Math.round(v * 100)}%`.padStart(4);
    const vol = (label: string, key: 'master' | 'music' | 'sfx' | 'crowd', hint: string): MenuItem => ({
      label: () => `${label.padEnd(18)}← ${pct(s()[key])} →`,
      onLeft: () => this.change((x) => (x[key] = Math.max(0, Math.round((x[key] - 0.1) * 10) / 10))),
      onRight: () => this.change((x) => (x[key] = Math.min(1, Math.round((x[key] + 0.1) * 10) / 10))),
      hint,
    });
    const flag = (label: string, key: 'assist' | 'entryLine' | 'rhythmRibbon' | 'pro' | 'reduceFlashes' | 'vibration', hint: string): MenuItem => {
      const toggle = () => this.change((x) => (x[key] = !x[key]));
      return { label: () => `${label.padEnd(18)}${s()[key] ? 'TAK' : 'NIE'}`, onSelect: toggle, onLeft: toggle, onRight: toggle, hint };
    };
    return [
      vol('GŁOŚNOŚĆ', 'master', 'Głośność całej gry'),
      vol('MUZYKA', 'music', 'Chiptune w menu i na hali'),
      vol('EFEKTY', 'sfx', 'Wybicie, plusk, sygnały'),
      vol('PUBLICZNOŚĆ', 'crowd', 'Szum i doping trybun'),
      flag('ASYSTA RAMION', 'assist', 'Ręce lekko korygują rotację po otwarciu'),
      flag('LINIA WEJŚCIA', 'entryLine', 'Pokazuje przewidywany kąt wejścia'),
      flag('WSTĘGA RYTMU', 'rhythmRibbon', 'Ruchy partnera na pasku u dołu'),
      flag('TRYB PRO', 'pro', 'Bez asysty i bez linii wejścia'),
      flag('MNIEJ BŁYSKÓW', 'reduceFlashes', 'Bez białych błysków i mrugania'),
      flag('WIBRACJE', 'vibration', 'Telefon lub pad przy wejściu do wody'),
      { label: 'KLAWISZE', onSelect: () => this.scene.restart({ page: 'keys' }), hint: 'Zmień przypisanie klawiszy' },
      { label: 'PAD', onSelect: () => this.scene.restart({ page: 'pad' }), hint: 'Zmień przypisanie przycisków pada' },
      {
        label: 'PRZYWRÓĆ DOMYŚLNE',
        onSelect: () => {
          getSave().settings = defaultSettings();
          save(getSave());
          audio.applyVolumes();
        },
        hint: 'Wszystkie ustawienia jak na początku',
      },
      { label: 'POWRÓT', onSelect: () => this.back() },
    ];
  }

  private bindItems(page: 'keys' | 'pad'): MenuItem[] {
    const s = () => settings();
    const items: MenuItem[] = ORDER.map((b) => ({
      label: () => {
        const v = page === 'keys' ? s().keys[b].map(keyName) : s().pad[b].map((i) => `#${i}`);
        return `${NAMES[b].padEnd(8)}${v.join('  ')}`;
      },
      onSelect: () => this.capture(page, b),
      hint: page === 'keys' ? 'AKCJA, potem nowy klawisz (Esc: anuluj)' : 'AKCJA, potem przycisk na padzie',
    }));
    items.push({
      label: 'DOMYŚLNE',
      onSelect: () => this.change((x) => (page === 'keys' ? (x.keys = structuredClone(DEFAULT_KEYS)) : (x.pad = structuredClone(DEFAULT_PAD)))),
    });
    items.push({ label: 'POWRÓT', onSelect: () => this.back() });
    return items;
  }

  private capture(page: 'keys' | 'pad', b: Bindable): void {
    const inp = input();
    this.prompt.setText(page === 'keys' ? `${NAMES[b]}: naciśnij klawisz` : `${NAMES[b]}: przycisk pada`);
    const done = () => {
      this.prompt.setText('');
      this.menu.refresh();
      audio.play('select');
    };
    if (page === 'keys') {
      inp.captureKey = (code) => {
        if (code === 'Escape') {
          this.prompt.setText('');
          return;
        }
        this.change((x) => {
          // a key does one thing: remove it elsewhere
          for (const o of ORDER) x.keys[o] = x.keys[o].filter((c) => c !== code);
          x.keys[b] = [code, ...x.keys[b]].slice(0, 2);
        });
        done();
      };
    } else {
      inp.capturePad = (i) => {
        this.change((x) => {
          for (const o of ORDER) x.pad[o] = x.pad[o].filter((c) => c !== i);
          x.pad[b] = [i, ...x.pad[b]].slice(0, 2);
        });
        done();
      };
    }
  }

  override update(): void {
    const inp = input();
    if (inp.captureKey || inp.capturePad) {
      inp.poll();
      inp.menuPressed();
      inp.takeClick();
      return;
    }
    this.menu.update();
  }
}
