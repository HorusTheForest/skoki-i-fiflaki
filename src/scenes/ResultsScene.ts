// Scoreboard after a dive: judges' awards (cancelled ones greyed out), DD,
// total, what went wrong, and next steps (retry, TV replay, share, menu).

import Phaser from 'phaser';
import { UI_H as HEIGHT, UI_W as WIDTH } from '../config';
import type { DiveConfig } from './DiveScene';
import type { Award, DiveRecord, Execution, IndividualScore, SyncResult, SynchroScore } from '../scoring/judges';
import { DD_IS_APPROXIMATE } from '../scoring/dd';
import { encodeReplay, replayUrl, type ReplayData } from '../core/replay';
import { getSave, save } from '../core/save';
import { C, col } from '../render/palette';
import { panel, title, txt, uiFrame } from '../ui/text';
import { diveName, parseDiveCode } from '../levels/diveCode';
import { Menu, type MenuItem } from '../ui/menu';
import { audio } from '../audio/engine';
import { music } from '../audio/music';
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
    uiFrame(this, C.navy);
    const total = r.synchro ? r.synchro.score.total : r.solo!.score.total;
    if (r.outcome === undefined) {
      r.outcome = onLevelResult(r, total, this);
      this.saveRecords(total);
    }

    const L = 26;
    panel(this, 12, 10, WIDTH - 24, 196, C.charcoal, C.slate);
    txt(this, L, 22, `${r.replay.code}  ${diveName(parseDiveCode(r.replay.code))}`, C.gold);
    txt(this, L, 34, `Współczynnik trudności ${DD_IS_APPROXIMATE ? '≈' : ''}${r.dd.toFixed(1)}`, C.lightGrey);
    title(this, WIDTH - 90, 20, total.toFixed(2), 16, col(C.white), col(C.paleBlue));

    const row = (y: number, label: string, awards: Award[], color: number) => {
      txt(this, L, y, label, color);
      awards.forEach((a, i) => {
        const v = a.value % 1 === 0 ? a.value.toFixed(0) : a.value.toFixed(1);
        const x = 140 + i * 50;
        txt(this, x + 32, y, v, a.cancelled ? C.grey : C.white, 'right');
        if (a.cancelled) {
          const g = this.add.graphics().setScrollFactor(0);
          g.fillStyle(col(C.grey));
          g.fillRect(x + 32 - v.length * 8 - 1, y + 3, v.length * 8 + 2, 1);
        }
      });
    };
    let y = 56;
    if (r.synchro) {
      const s = r.synchro.score;
      row(y, 'TY', s.execA, C.sky);
      row(y + 16, 'PARTNER', s.execB, C.sky);
      row(y + 32, 'SYNCHRO', s.sync, C.lime);
      txt(this, L, y + 52, `Suma ${s.sum.toFixed(1)} × WT ${s.dd.toFixed(1)} × 0,6 = ${s.total.toFixed(2)}`, C.lightGrey);
      y += 72;
    } else {
      const s = r.solo!.score;
      row(y, 'SĘDZIOWIE', s.awards.slice(0, 7), C.sky);
      txt(this, L, y + 20, `Suma ${s.sum.toFixed(1)} × WT ${s.dd.toFixed(1)} = ${s.total.toFixed(2)}`, C.lightGrey);
      y += 40;
    }
    // what happened and the biggest deductions
    const exec = r.synchro ? r.synchro.execA : r.solo!.exec;
    const ded = [...exec.deductions];
    if (r.synchro) ded.push(...r.synchro.sync.deductions.map((d) => ({ ...d, reason: `Synchro: ${d.reason}` })));
    ded.sort((a, b) => b.points - a.points);
    const e = r.player.entry;
    const facts = e ? `Kąt wejścia ${e.angleErr >= 0 ? '+' : ''}${e.angleErr.toFixed(0)}°   Rip ${e.rip}   Wybicie ${r.player.takeoff?.label ?? '-'}` : 'Skok przerwany';
    txt(this, L, y, facts, C.white);
    const room = Math.max(1, Math.floor((196 - (y + 14 - 10)) / 12));
    ded.slice(0, Math.min(4, room)).forEach((d, i) => txt(this, L, y + 14 + i * 12, `-${d.points.toFixed(1)}  ${d.reason}`.slice(0, 72), C.salmon));

    // level outcome
    const o = r.outcome;
    if (o) {
      panel(this, 12, 212, WIDTH - 24, 40, o.passed ? C.darkGreen : C.darkRed, o.passed ? C.lime : C.red);
      txt(this, L, 221, o.title, C.white);
      txt(this, L, 235, o.detail, C.lightGrey);
      title(this, WIDTH - 70, 222, '★'.repeat(o.stars) + '·'.repeat(3 - o.stars), 16, col(C.paleYellow), col(C.orange));
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
    const top = o ? 262 : 216;
    this.menu = new Menu(this, items, 12, top, 220, 17);
    this.menu.onBack = () => this.scene.start(r.cfg.mode === 'level' ? 'Levels' : 'Menu');
    audio.relax();
    music.duck(1, 1);
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
    txt(this, WIDTH - 16, HEIGHT - 18, 'Link w schowku i w pasku adresu', C.lime, 'right');
  }

  override update(): void {
    this.menu.update();
  }
}
