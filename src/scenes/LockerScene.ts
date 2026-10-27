// Locker room: pick the outfit, the synchro partner and the arena from
// what the campaign has unlocked. Previews both divers.

import Phaser from 'phaser';
import { HEIGHT } from '../config';
import { C, col, OUTFITS } from '../render/palette';
import { Menu, type MenuItem } from '../ui/menu';
import { txt } from '../ui/text';
import { getSave, save } from '../core/save';
import { DiverView, type Plane } from '../render/diverView';
import { POSES } from '../physics/body';
import { PARTNERS, partnerById } from '../ai/partner';
import { ARENAS } from '../render/arena';
import type { RenderState } from '../physics/diver';

const STAND: RenderState = { x: 0, y: 0, theta: 0, j: { ...POSES.stand }, psi: 0, facing: 1 };
const plane = (x: number, y: number): Plane => ({ s: 2, ox: x, oy: y });

export class LockerScene extends Phaser.Scene {
  private menu!: Menu;
  private me: DiverView | null = null;
  private mate: DiverView | null = null;
  private style!: Phaser.GameObjects.BitmapText;
  private lockInfo!: Phaser.GameObjects.BitmapText;

  constructor() {
    super('Locker');
  }

  create(): void {
    this.cameras.main.setBackgroundColor(col(C.navy));
    txt(this, 8, 6, 'SZATNIA', C.gold);
    const floor = this.add.graphics();
    floor.fillStyle(col(C.slate));
    floor.fillRect(196, 112, 116, 3);
    this.style = txt(this, 8, 124, '', C.sky).setDepth(2);
    this.lockInfo = txt(this, 8, 152, '', C.grey).setDepth(2);
    const s = getSave();
    const cycle = <T>(list: T[], cur: T, d: number) => list[(list.indexOf(cur) + d + list.length) % list.length]!;
    const items: MenuItem[] = [
      {
        label: () => `STRÓJ    ← ${OUTFITS[getSave().outfit]!.name} →`,
        onLeft: () => this.set(() => (s.outfit = cycle([...s.unlocks.outfits].sort((a, b) => a - b), s.outfit, -1))),
        onRight: () => this.set(() => (s.outfit = cycle([...s.unlocks.outfits].sort((a, b) => a - b), s.outfit, 1))),
        hint: `Odblokowane: ${s.unlocks.outfits.length}/${OUTFITS.length}`,
      },
      {
        label: () => `PARTNER  ← ${partnerById(getSave().partner).name} →`,
        onLeft: () => this.set(() => (s.partner = cycle(this.partners(), s.partner, -1))),
        onRight: () => this.set(() => (s.partner = cycle(this.partners(), s.partner, 1))),
        hint: 'Partner do treningu synchro',
      },
      {
        label: () => `ARENA    ← ${ARENAS.find((a) => a.id === getSave().arena)?.name ?? ''} →`,
        onLeft: () => this.set(() => (s.arena = cycle(this.arenas(), s.arena, -1))),
        onRight: () => this.set(() => (s.arena = cycle(this.arenas(), s.arena, 1))),
        hint: 'Arena do freestyle i treningu',
      },
      { label: 'POWRÓT', onSelect: () => this.scene.start('Menu') },
    ];
    this.menu = new Menu(this, items, 8, 30, 190, 14, HEIGHT - 10);
    this.menu.onBack = () => this.scene.start('Menu');
    this.refresh();
  }

  private partners(): string[] {
    const un = getSave().unlocks.partners;
    return PARTNERS.filter((p) => un.includes(p.id)).map((p) => p.id);
  }

  private arenas(): string[] {
    const un = getSave().unlocks.arenas;
    return ARENAS.filter((a) => un.includes(a.id)).map((a) => a.id);
  }

  private set(f: () => void): void {
    f();
    save(getSave());
    this.refresh();
  }

  private refresh(): void {
    const s = getSave();
    this.me?.destroy();
    this.mate?.destroy();
    const p = partnerById(s.partner);
    // centre of mass about 1 m above the feet, at scale 2
    this.me = new DiverView(this, { outfit: s.outfit, hair: C.darkBrown, skin: 0 }, 10, plane(228, 112 - 1.0 * 32));
    this.mate = new DiverView(this, p.look, 10, plane(282, 112 - 1.0 * 32));
    // keep them dry: the preview has no pool
    this.me.waterY = this.mate.waterY = -100;
    this.me.update(STAND);
    this.mate.update({ ...STAND, facing: -1 });
    this.style.setText(`${p.name} (${p.country})\n${p.style.slice(0, 38)}`);
    const lockedP = PARTNERS.length - s.unlocks.partners.length;
    const lockedO = OUTFITS.length - s.unlocks.outfits.length;
    const lockedA = ARENAS.length - s.unlocks.arenas.length;
    this.lockInfo.setText(lockedP + lockedO + lockedA ? `Zablokowane: ${lockedP} partn. ${lockedO} stroj. ${lockedA} aren` : 'Wszystko odblokowane!');
  }

  override update(): void {
    this.menu.update();
  }
}
