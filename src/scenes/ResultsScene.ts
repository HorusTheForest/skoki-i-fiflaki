// Scoreboard after a dive: judges' awards (cancelled ones greyed out), DD,
// total, what went wrong, and next steps (retry, TV replay, share, menu).

import Phaser from 'phaser';
import { HEIGHT, WIDTH } from '../config';
import type { DiveConfig } from './DiveScene';
import type { Award, DiveRecord, Execution, IndividualScore, SyncResult, SynchroScore } from '../scoring/judges';
import { DD_IS_APPROXIMATE } from '../scoring/dd';
import { encodeReplay, replayUrl, type ReplayData } from '../core/replay';
import { getSave, save } from '../core/save';
import { C, col } from '../render/palette';
import { panel, txt } from '../ui/text';
import { Menu, type MenuItem } from '../ui/menu';
import { audio } from '../audio/engine';
import { onLevelResult, startLevel, type LevelOutcome } from '../levels/progress';
import { isFinal, level } from '../levels/levels';

export interface DiveResult {
  cfg: DiveConfig;
  dd: number;
  replay: ReplayData;
  player: DiveRecord;
  solo?: { score: IndividualScore; exec: Execution };
  synchro?: { score: SynchroScore; execA: Execution; execB: Execution; sync: SyncResult };
  /** filled in once by the results screen */
  outcome?: LevelOutcome | null;
}

export class ResultsScene extends Phaser.Scene {
  private res!: DiveResult;
  private menu!: Menu;

  constructor() {
    super('Results');
  }

  init(res: DiveResult): void {
    this.res = res;
  }

  create(): void {
    const r = this.res;
    this.cameras.main.setBackgroundColor(col(C.navy));
    const total = r.synchro ? r.synchro.score.total : r.solo!.score.total;
    if (r.outcome === undefined) {
      r.outcome = onLevelResult(r, total, this);
      this.saveRecords(total);
    }

    panel(this, 4, 4, WIDTH - 8, 92, C.black, C.slate);
    txt(this, 10, 9, `${r.replay.code}  WT ${DD_IS_APPROXIMATE ? '≈' : ''}${r.dd.toFixed(1)}`, C.gold);
    txt(this, WIDTH - 10, 9, total.toFixed(2), C.white, 'right');

    const row = (y: number, label: string, awards: Award[], color: number) => {
      txt(this, 10, y, label, color);
      awards.forEach((a, i) => {
        const v = a.value % 1 === 0 ? a.value.toFixed(0) : a.value.toFixed(1);
        const x = 74 + i * 30;
        txt(this, x + 24, y, v, a.cancelled ? C.grey : C.white, 'right');
        if (a.cancelled) {
          const g = this.add.graphics().setScrollFactor(0);
          g.fillStyle(col(C.grey));
          g.fillRect(x + 24 - v.length * 8, y + 3, v.length * 8, 1);
        }
      });
    };
    let y = 24;
    if (r.synchro) {
      const s = r.synchro.score;
      row(y, 'TY', s.execA, C.sky);
      row(y + 11, 'PARTNER', s.execB, C.sky);
      row(y + 22, 'SYNCHRO', s.sync, C.lime);
      txt(this, 10, y + 36, `${s.sum.toFixed(1)} × ${s.dd.toFixed(1)} × 0,6 = ${s.total.toFixed(2)}`, C.lightGrey);
      y += 48;
    } else {
      const s = r.solo!.score;
      row(y, 'SĘDZIO.', s.awards.slice(0, 7), C.sky);
      txt(this, 10, y + 14, `${s.sum.toFixed(1)} × ${s.dd.toFixed(1)} = ${s.total.toFixed(2)}`, C.lightGrey);
      y += 26;
    }
    // biggest deductions
    const exec = r.synchro ? r.synchro.execA : r.solo!.exec;
    const ded = [...exec.deductions];
    if (r.synchro) ded.push(...r.synchro.sync.deductions.map((d) => ({ ...d, reason: `Sync: ${d.reason}` })));
    ded.sort((a, b) => b.points - a.points);
    const e = r.player.entry;
    const facts = e ? `Kąt ${e.angleErr >= 0 ? '+' : ''}${e.angleErr.toFixed(0)}°  Rip ${e.rip}  Wybicie ${r.player.takeoff?.label ?? '-'}` : '';
    txt(this, 10, y, facts, C.white);
    ded.slice(0, 2).forEach((d, i) => txt(this, 10, y + 10 + i * 9, `-${d.points.toFixed(1)} ${d.reason}`.slice(0, 37), C.salmon));

    // level outcome
    const o = r.outcome;
    if (o) {
      panel(this, 4, 100, WIDTH - 8, 24, o.passed ? C.darkGreen : C.darkRed, o.passed ? C.lime : C.red);
      txt(this, 10, 104, o.title, C.white);
      txt(this, 10, 114, o.detail, C.lightGrey);
      txt(this, WIDTH - 10, 104, '★'.repeat(o.stars) + '·'.repeat(3 - o.stars), C.gold, 'right');
      if (o.stars > 0) audio.play('star');
    }

    const items: MenuItem[] = [];
    if (o?.next) items.push({ label: o.nextLabel ?? 'DALEJ', onSelect: () => o.next!() });
    // a final has no retries of single rounds: it starts over
    const final = r.cfg.mode === 'level' && r.cfg.levelId !== undefined && isFinal(level(r.cfg.levelId));
    if (!final) items.push({ label: 'JESZCZE RAZ', onSelect: () => this.scene.start('Dive', { ...r.cfg, seed: r.cfg.seed + 1 }) });
    else if (o?.nextLabel !== 'FINAŁ OD NOWA') items.push({ label: 'FINAŁ OD NOWA', onSelect: () => startLevel(this, r.cfg.levelId!) });
    items.push({
      label: 'POWTÓRKA TV',
      onSelect: () =>
        this.scene.start('Dive', {
          ...r.cfg,
          mode: 'replay',
          tv: true,
          choose: false,
          replay: r.replay,
          returnTo: r,
        } satisfies DiveConfig),
    });
    items.push({ label: 'KOPIUJ LINK', onSelect: () => this.share() });
    items.push({ label: 'MENU', onSelect: () => this.scene.start(r.cfg.mode === 'level' ? 'Levels' : 'Menu') });
    const top = o ? 130 : 108;
    this.menu = new Menu(this, items, 8, top, 150, 10, HEIGHT - 9);
    this.menu.onBack = () => this.scene.start(r.cfg.mode === 'level' ? 'Levels' : 'Menu');
    audio.relax();
  }

  private saveRecords(total: number): void {
    const r = this.res;
    if (r.cfg.mode !== 'freestyle' && r.cfg.mode !== 'training') return;
    const key = `${r.replay.code}@${r.cfg.height}`;
    const s = getSave();
    if (!r.cfg.synchro && total > (s.records[key] ?? -1)) {
      s.records[key] = total;
      s.ghosts[key] = encodeReplay(r.replay);
      save(s);
    }
  }

  private share(): void {
    const url = replayUrl(this.res.replay);
    try {
      void navigator.clipboard.writeText(url);
    } catch {
      // clipboard blocked
    }
    history.replaceState(null, '', url);
    txt(this, WIDTH - 8, HEIGHT - 20, 'Link w schowku i pasku adresu', C.lime, 'right');
  }

  override update(): void {
    this.menu.update();
  }
}
