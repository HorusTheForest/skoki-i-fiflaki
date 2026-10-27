// The dive itself: platform, take-off, flight, entry, water. Runs the
// simulation at a fixed 120 Hz with an accumulator and renders with
// interpolation. Handles solo and synchro, live play and replays (TV mode).

import Phaser from 'phaser';
import { HEIGHT, PPM, WIDTH } from '../config';
import {
  DiverSim,
  DT,
  IN,
  LINE_GREEN_DEG,
  type DiveSetup,
  type RenderState,
  type SimEvent,
} from '../physics/diver';
import { Ragdoll } from '../physics/ragdoll';
import { parseDiveCode, diveName, withDir, type DiveSpec } from '../levels/diveCode';
import { degreeOfDifficulty, DD_IS_APPROXIMATE } from '../scoring/dd';
import { judgeIndividual, judgeSynchro, record } from '../scoring/judges';
import { Arena, type ArenaKind } from '../render/arena';
import { DiverView, FRONT, lerpState, toScreen, type Plane } from '../render/diverView';
import { C, col } from '../render/palette';
import { FONT } from '../render/font';
import { input } from '../core/input';
import { getSave, settings } from '../core/save';
import { audio, type Sfx } from '../audio/engine';
import { partnerById, planPartnerDive, type Cue, type PartnerDive } from '../ai/partner';
import { hashSeed } from '../core/rng';
import { Bot, PERFECT_BOT } from '../ai/bot';
import { decodeReplay, type ReplayData } from '../core/replay';
import { shadowTxt, txt } from '../ui/text';
import { FREESTYLE_DIVES } from '../levels/freestyle';
import { level, type Modifier } from '../levels/levels';
import { TvOverlay } from '../ui/tv';
import type { DiveResult } from './ResultsScene';

export interface DiveConfig {
  mode: 'freestyle' | 'training' | 'level' | 'replay';
  code: string;
  height: number;
  synchro: boolean;
  partner?: string;
  zoneWidth: number;
  ribbon: boolean;
  seed: number;
  arena: ArenaKind;
  levelId?: number;
  /** replay data (mode 'replay') */
  replay?: ReplayData;
  /** TV presentation of a replay */
  tv?: boolean;
  /** where to go after a replay: back to results (payload) or menu */
  returnTo?: DiveResult;
  /** finals: index of the round */
  round?: number;
  /** freestyle: allow changing the dive on the platform */
  choose?: boolean;
  /** modifiers from the level data */
  modifiers?: Modifier[];
}

const BACK: Plane = { s: 0.85, ox: (1 - 0.85) * (WIDTH / 2) + 10, oy: (1 - 0.85) * (HEIGHT / 2) - 22 };
const COUNT_T = [0, 0.6, 1.2];
const HEP_T = 1.8;
const RIBBON_SPEED = 90;
const RIBBON_HIT_X = 56;

type Stage = 'intro' | 'live' | 'end';

interface Diver {
  sim: DiverSim;
  view: DiverView;
  prev: RenderState;
  curr: RenderState;
  ragdoll: Ragdoll | null;
  inputs: number[];
  scripted: number[] | null;
  plane: Plane;
  water: 'front' | 'back';
  belowPrev: boolean[];
  splashed: boolean;
  bubbleTimer: number;
  seenEvents: number;
}

export class DiveScene extends Phaser.Scene {
  private cfg!: DiveConfig;
  private dive!: DiveSpec;
  private setup!: DiveSetup;
  private arena!: Arena;
  private player!: Diver;
  private partner: Diver | null = null;
  private ghost: Diver | null = null;
  private partnerPlan: PartnerDive | null = null;
  private stage: Stage = 'intro';
  private acc = 0;
  private hitstop = 0;
  private timeScale = 1;
  private introTime = 0;
  private endTimer = 0;
  private world!: Phaser.GameObjects.Graphics;
  private hud!: Phaser.GameObjects.Graphics;
  private label!: ReturnType<typeof shadowTxt>;
  private labelTimer = 0;
  private syncLabel!: ReturnType<typeof shadowTxt>;
  private syncLabelTimer = 0;
  private bigText!: Phaser.GameObjects.BitmapText;
  private bigShadow!: Phaser.GameObjects.BitmapText;
  private bigTimer = 0;
  private card: { destroy(): void }[] = [];
  private info!: ReturnType<typeof shadowTxt>;
  private ribbonIcons: { cue: Cue; box: Phaser.GameObjects.BitmapText }[] = [];
  private countIndex = 0;
  private flashTimer = 0;
  private camZoom = 2;
  private camX = 0;
  private camY = 0;
  private tv: TvOverlay | null = null;
  private uiCam!: Phaser.Cameras.Scene2D.Camera;
  private forcedJump = 0;
  private chooseIdx = 0;
  /** ?autoplay in the URL: the bot plays the player's diver (demo and smoke tests) */
  private autoBot: Bot | null = null;
  private chooseDir: 1 | 2 | 3 | 4 = 1;

  constructor() {
    super('Dive');
  }

  init(cfg: DiveConfig): void {
    this.cfg = cfg;
    this.stage = 'intro';
    this.acc = 0;
    this.hitstop = 0;
    this.timeScale = 1;
    this.introTime = 0;
    this.endTimer = 0;
    this.countIndex = 0;
    this.flashTimer = 0;
    this.labelTimer = 0;
    this.bigTimer = 0;
    this.partner = null;
    this.ghost = null;
    this.partnerPlan = null;
    this.ribbonIcons = [];
    this.card = [];
    this.tv = null;
    this.forcedJump = 0;
    this.camZoom = 2;
  }

  private has(m: Modifier): boolean {
    return this.cfg.modifiers?.includes(m) ?? false;
  }

  private get assistOn(): boolean {
    if (this.cfg.replay) return this.cfg.replay.assist;
    if (this.has('noAssist')) return false;
    const s = settings();
    return s.assist && !s.pro;
  }

  create(): void {
    const cfg = this.cfg;
    this.dive = parseDiveCode(cfg.code);
    if (cfg.choose) {
      const i = FREESTYLE_DIVES.findIndex((c) => c.slice(1) === this.dive.code.slice(1) || c === this.dive.code);
      this.chooseIdx = Math.max(0, i);
      this.chooseDir = this.dive.dir;
    }
    this.cameras.main.setBackgroundColor(col(C.black));
    this.cameras.main.setRoundPixels(true);
    this.arena = new Arena(this, cfg.arena, { backPlane: cfg.synchro ? BACK : undefined, activeHeight: cfg.height });
    this.world = this.add.graphics().setDepth(80);
    this.hud = this.add.graphics().setDepth(200).setScrollFactor(0);
    this.label = shadowTxt(this, WIDTH / 2, 40, '', C.gold, 'center');
    this.label.setDepth(210);
    this.bigShadow = this.add.bitmapText(WIDTH / 2 + 1, 61, FONT, '', 16).setOrigin(0.5, 0).setScrollFactor(0).setDepth(210).setTint(col(C.black));
    this.bigText = this.add.bitmapText(WIDTH / 2, 60, FONT, '', 16).setOrigin(0.5, 0).setScrollFactor(0).setDepth(211).setTint(col(C.gold));
    this.syncLabel = shadowTxt(this, WIDTH - 4, HEIGHT - 26, '', C.gold, 'right');
    this.syncLabel.setDepth(225);
    this.info = shadowTxt(this, 4, HEIGHT - 12, '', C.white);
    this.info.setDepth(210);
    this.autoBot = /[?&]autoplay\b/.test(location.search) && !cfg.replay ? new Bot(PERFECT_BOT) : null;
    this.buildDivers();
    this.showCard();
    if (cfg.tv) this.tv = new TvOverlay(this, cfg.replay?.score);
    this.arena.setBoard(this.dive.code, cfg.synchro ? 'SYNCHRO' : `${cfg.height} M`, cfg.levelId !== undefined ? `POZIOM ${cfg.levelId}` : '');
    // HUD gets its own camera so the world zoom does not scale it
    this.uiCam = this.cameras.add(0, 0, WIDTH, HEIGHT);
    this.uiCam.setRoundPixels(true);
    this.syncCameras();
    this.placeCamera(true);
    input().clearLatches();
    audio.hush();
    this.events.once('shutdown', () => this.tv?.destroy());
  }

  /** screen-space objects (scroll factor 0) render only on the UI camera, the rest only on the main one */
  private syncCameras(): void {
    const main = this.cameras.main;
    for (const o of this.children.list) {
      const sf = (o as unknown as { scrollFactorX?: number }).scrollFactorX;
      if (sf === 0) main.ignore(o);
      else this.uiCam.ignore(o);
    }
  }

  private makeSetup(dive: DiveSpec): DiveSetup {
    const s: DiveSetup = {
      dive,
      height: this.cfg.height,
      zoneWidth: this.cfg.zoneWidth,
      assist: this.assistOn,
    };
    if (this.cfg.synchro) s.hepTime = this.cfg.replay?.hep ?? HEP_T;
    return s;
  }

  private newDiver(setup: DiveSetup, view: DiverView, plane: Plane, water: 'front' | 'back', scripted: number[] | null): Diver {
    const sim = new DiverSim(setup);
    const st = sim.snapshot();
    view.update(st);
    return {
      sim,
      view,
      prev: st,
      curr: st,
      ragdoll: null,
      inputs: [],
      scripted,
      plane,
      water,
      belowPrev: [],
      splashed: false,
      bubbleTimer: 0,
      seenEvents: 0,
    };
  }

  private buildDivers(): void {
    const cfg = this.cfg;
    this.setup = this.makeSetup(this.dive);
    const save = getSave();
    const outfit = cfg.replay?.outfit ?? save.outfit;
    const pView = new DiverView(this, { outfit, hair: C.darkBrown, skin: 0 }, 50, FRONT, { underDepth: 75 });
    this.player = this.newDiver(this.setup, pView, FRONT, 'front', cfg.replay ? cfg.replay.inputs : null);
    if (cfg.synchro) {
      const p = partnerById(cfg.replay?.partner ?? cfg.partner ?? 'ola');
      this.partnerPlan = cfg.replay?.partnerInputs
        ? { inputs: cfg.replay.partnerInputs, cues: [], params: {} as never }
        : planPartnerDive(this.setup, p, cfg.seed);
      if (!this.partnerPlan.cues.length) this.partnerPlan = { ...planPartnerDive(this.setup, p, cfg.seed), inputs: this.partnerPlan.inputs };
      const view = new DiverView(this, p.look, 40, BACK, { underDepth: 47 });
      view.waterY = 0;
      this.partner = this.newDiver(this.setup, view, BACK, 'back', this.partnerPlan.inputs);
      if (cfg.ribbon && !cfg.tv) this.buildRibbon(this.partnerPlan.cues);
    }
    // ghost of the best dive (solo freestyle)
    if (cfg.mode === 'freestyle' && !cfg.synchro) this.buildGhost();
  }

  private ghostKey(): string {
    return `${this.dive.code}@${this.cfg.height}`;
  }

  private buildGhost(): void {
    this.ghost?.view.destroy();
    this.ghost = null;
    const raw = getSave().ghosts[this.ghostKey()];
    if (!raw) return;
    try {
      const r = decodeReplay(raw);
      if (r.code !== this.dive.code || this.stage !== 'intro') return;
      const view = new DiverView(this, { outfit: 5, hair: C.slate, skin: 0 }, 45, FRONT, { outline: false, underDepth: 74 });
      view.silhouetteColor = C.slate;
      const setup: DiveSetup = { ...this.makeSetup(this.dive), assist: r.assist, zoneWidth: r.zone };
      this.ghost = this.newDiver(setup, view, FRONT, 'front', r.inputs);
    } catch {
      // ignore broken ghosts
    }
  }

  // ---------------------------------------------------------------- HUD bits

  private showCard(): void {
    for (const c of this.card) c.destroy();
    this.card = [];
    const d = this.dive;
    const dd = degreeOfDifficulty(d, this.cfg.height);
    const lines: [string, number][] = [
      [`${d.code}  WT ${DD_IS_APPROXIMATE ? '≈' : ''}${dd.toFixed(1)}`, C.gold],
      [diveName(d), C.white],
    ];
    const isLevel = this.cfg.mode === 'level' && this.cfg.levelId !== undefined;
    if (this.cfg.synchro && this.cfg.mode !== 'replay' && !(isLevel && this.stage === 'intro')) {
      const p = partnerById(this.cfg.partner ?? 'ola');
      lines.push([`Partner: ${p.name} (${p.country})`, C.sky]);
    }
    if (isLevel && this.stage === 'intro') {
      const l = level(this.cfg.levelId!);
      const n = l.dives.length;
      lines.unshift([`POZIOM ${l.id}: ${l.name.toUpperCase()}${n > 1 ? `  SERIA ${(this.cfg.round ?? 0) + 1}/${n}` : ''}`, C.lime]);
      let line = '';
      for (const w of l.tip.split(' ')) {
        if ((line + ' ' + w).trim().length > 38) {
          lines.push([line, C.paleYellow]);
          line = w;
        } else line = (line + ' ' + w).trim();
      }
      if (line) lines.push([line, C.paleYellow]);
    } else if (this.cfg.choose && this.stage === 'intro') lines.push(['←→ grupa  ↑↓ skok  AKCJA start', C.lightGrey]);
    else if (this.cfg.mode !== 'replay' && this.stage === 'intro') lines.push([this.cfg.synchro ? 'Trzymaj AKCJĘ na 3-2-1, puść na HEP!' : 'Trzymaj AKCJĘ, puść w złotej strefie', C.lightGrey]);
    // on the platform the card sits low, on a dark band, clear of the divers
    const intro = this.stage === 'intro' && this.cfg.mode !== 'replay';
    const y0 = intro ? HEIGHT - 20 - lines.length * 10 : 4;
    if (intro) {
      const bg = this.add.graphics().setScrollFactor(0).setDepth(204);
      bg.fillStyle(col(C.black), 0.6);
      bg.fillRect(0, y0 - 3, Math.max(...lines.map(([t]) => t.length)) * 8 + 8, lines.length * 10 + 4);
      this.card.push(bg);
    }
    lines.forEach(([s, c], i) => {
      const t = shadowTxt(this, 4, y0 + i * 10, s, c);
      t.setDepth(205);
      this.card.push(t);
    });
  }

  private buildRibbon(cues: Cue[]): void {
    const icon: Record<Cue['kind'], [string, number]> = {
      jump: ['W', C.gold],
      tuck: ['K', C.orange],
      pike: ['Ł', C.salmon],
      open: ['O', C.lime],
      twist: ['Ś', C.sky],
      rip: ['R', C.cyan],
    };
    for (const cue of cues) {
      const [ch, c] = icon[cue.kind];
      const box = txt(this, -20, HEIGHT - 13, ch, c, 'center').setDepth(222);
      this.ribbonIcons.push({ cue, box });
    }
  }

  private flashLabel(s: string, c: number, big = false): void {
    if (big) {
      this.bigText.setText(s).setTint(col(c));
      this.bigShadow.setText(s);
      this.bigTimer = 0.7;
    } else {
      this.label.set(s);
      this.label.main.setTint(col(c));
      this.labelTimer = 0.9;
    }
  }

  // ------------------------------------------------------------- main loop

  override update(_time: number, deltaMs: number): void {
    const inp = input();
    inp.poll();
    const dt = Math.min(deltaMs, 50) / 1000;
    const menu = inp.menuPressed();
    if (menu) audio.unlock();

    if (menu & 32) {
      // back: leave
      audio.play('back');
      this.leave();
      return;
    }

    if (this.stage === 'intro') this.updateIntro(dt, menu);

    if (this.stage === 'live') {
      if (this.hitstop > 0) this.hitstop -= dt;
      else {
        this.acc += dt * this.timeScale;
        let guard = 0;
        while (this.acc >= DT && guard++ < 12) {
          this.tick();
          this.acc -= DT;
        }
      }
    }
    if (this.stage === 'end') {
      this.endTimer += dt;
      // keep the water and ragdolls alive while the results load
      if (this.endTimer > 0.3) this.finish();
    }

    this.arena.update(dt * (this.hitstop > 0 ? 0.15 : this.timeScale), !settings().reduceFlashes);
    this.syncCameras();
    this.render(Math.min(1, this.acc / DT));
    this.updateHud(dt);
    this.placeCamera(false, dt);
  }

  private updateIntro(dt: number, menu: number): void {
    this.introTime += dt;
    const cfg = this.cfg;
    if (cfg.choose) {
      let changed = false;
      if (menu & IN.LEFT) {
        this.chooseDir = (((this.chooseDir + 2) % 4) + 1) as 1 | 2 | 3 | 4;
        changed = true;
      }
      if (menu & IN.RIGHT) {
        this.chooseDir = ((this.chooseDir % 4) + 1) as 1 | 2 | 3 | 4;
        changed = true;
      }
      if (menu & IN.UP) {
        this.chooseIdx = (this.chooseIdx + 1) % FREESTYLE_DIVES.length;
        changed = true;
      }
      if (menu & IN.DOWN) {
        this.chooseIdx = (this.chooseIdx + FREESTYLE_DIVES.length - 1) % FREESTYLE_DIVES.length;
        changed = true;
      }
      if (changed) {
        audio.play('menu');
        let d = parseDiveCode(FREESTYLE_DIVES[this.chooseIdx]!);
        try {
          d = withDir(d, this.chooseDir);
        } catch {
          // keep the base group
        }
        this.dive = d;
        this.cfg = { ...this.cfg, code: d.code };
        this.player.view.destroy();
        this.ghost?.view.destroy();
        this.ghost = null;
        this.buildDivers();
        this.showCard();
      }
    }
    const auto = cfg.mode === 'replay' ? 0.8 : cfg.synchro || this.autoBot ? 1.6 : 0;
    const go = (menu & IN.ACTION && !cfg.tv) || (auto > 0 && this.introTime >= auto);
    if (go) this.startLive();
  }

  private startLive(): void {
    this.stage = 'live';
    this.acc = 0;
    audio.unlock();
    this.showCard();
    // in solo the ACTION that started the dive also starts the charge
    if (!this.cfg.synchro) input().clearLatches();
    if (this.cfg.mode === 'training') this.timeScale = 0.5;
  }

  private tick(): void {
    const p = this.player;
    const t = p.sim.t;
    // synchro countdown
    if (this.cfg.synchro) {
      while (this.countIndex < 4 && t >= (this.countIndex < 3 ? COUNT_T[this.countIndex]! : HEP_T)) {
        const s = this.countIndex < 3 ? String(3 - this.countIndex) : 'HEP!';
        this.flashLabel(s, this.countIndex < 3 ? C.white : C.gold, true);
        audio.play(this.countIndex < 3 ? 'beep' : 'hep');
        this.countIndex++;
      }
    }
    let mask: number;
    if (p.scripted) mask = p.scripted[p.inputs.length] ?? 0;
    else if (this.autoBot) mask = this.autoBot.input(p.sim);
    else mask = input().simMask();
    // balk: in synchro the diver must go shortly after HEP
    if (!p.scripted && this.cfg.synchro && (p.sim.phase === 'ready' || p.sim.phase === 'charge') && t > HEP_T + 1.2) {
      this.forcedJump++;
      mask = p.sim.phase === 'ready' ? IN.ACTION : 0;
    }
    p.inputs.push(mask);
    this.stepDiver(p, mask);
    if (this.partner) {
      const pm = this.partner.scripted![this.partner.inputs.length] ?? 0;
      this.partner.inputs.push(pm);
      this.stepDiver(this.partner, pm);
    }
    if (this.ghost && this.ghost.sim.phase !== 'done') {
      const gm = this.ghost.scripted![this.ghost.inputs.length] ?? 0;
      this.ghost.inputs.push(gm);
      this.stepDiver(this.ghost, gm);
    }
    this.handleEvents(p, true);
    if (this.partner) this.handleEvents(this.partner, false);

    // slow motion near the water (and throughout a TV replay)
    if (this.cfg.mode !== 'training') {
      const ps = p.sim;
      const near = ps.phase === 'flight' && ps.timeToContact() < 0.25;
      this.timeScale = this.cfg.tv ? (ps.phase === 'flight' || near ? 0.45 : 0.8) : near ? 0.6 : 1;
    }

    const done = p.sim.phase === 'done' && (!this.partner || this.partner.sim.phase === 'done');
    if (done) {
      this.stage = 'end';
      this.endTimer = 0;
    }
  }

  private stepDiver(d: Diver, mask: number): void {
    d.prev = d.curr;
    d.sim.step(mask);
    if (d.ragdoll) d.ragdoll.step();
    d.curr = d.sim.snapshot();
    this.waterContact(d);
  }

  private waterOf(d: Diver) {
    return d.water === 'front' ? this.arena.water : this.arena.backWater!;
  }

  private waterContact(d: Diver): void {
    const sim = d.sim;
    if (sim.phase !== 'flight' && sim.phase !== 'water') return;
    const w = this.waterOf(d);
    const segs = d.ragdoll ? d.ragdoll.segments().map((s) => [s.px, s.py] as [number, number]) : sim.keyPoints();
    const vy = d.ragdoll ? d.ragdoll.velocity()[1] : sim.vy;
    const e = sim.entry;
    const clean = e ? (e.rip === 'PERFECT' ? 0.08 : e.rip === 'GOOD' ? 0.3 : 0.7) * (e.flat || e.tuckEntry ? 3 : 1) : 1;
    segs.forEach(([x, y], i) => {
      const below = y < w.heightAt(x);
      if (below && !d.belowPrev[i]) {
        if (!d.splashed && e) {
          d.splashed = true;
          w.splash(x, e.splash, Math.abs(vy) * 0.9);
        } else {
          w.disturb(x, vy * 0.06 * clean, 0.12);
        }
      }
      d.belowPrev[i] = below;
    });
    if (sim.phase === 'water' && !d.ragdoll && sim.y < 0) {
      d.bubbleTimer -= DT;
      if (d.bubbleTimer <= 0) {
        d.bubbleTimer = 0.05;
        const perfect = e?.rip === 'PERFECT';
        w.bubble(sim.x, sim.y, perfect ? 3 : 1);
      }
    }
  }

  private startRagdoll(d: Diver): void {
    const s = d.sim;
    const st = s.snapshot();
    d.ragdoll = new Ragdoll(st, s.L / s.inertia, s.vx, s.vy, this.cfg.height);
  }

  private handleEvents(d: Diver, isPlayer: boolean): void {
    const evs = d.sim.events;
    while (d.seenEvents < evs.length) {
      const e = evs[d.seenEvents++]!;
      this.onEvent(d, e, isPlayer);
    }
  }

  private sfx(name: Sfx, isPlayer: boolean, vol = 1): void {
    audio.play(name, isPlayer ? vol : vol * 0.45);
  }

  /** timing feedback against the partner's cue of the same kind */
  private syncFeedback(e: SimEvent): void {
    if (!this.partnerPlan || this.cfg.tv) return;
    const kindOf: Partial<Record<SimEvent['type'], Cue['kind']>> = { release: 'jump', tuck: 'tuck', pike: 'pike', open: 'open', rip: 'rip' };
    const kind = kindOf[e.type];
    if (!kind) return;
    let best: Cue | null = null;
    for (const c of this.partnerPlan.cues) {
      if (c.kind === kind && (!best || Math.abs(c.t - e.t) < Math.abs(best.t - e.t))) best = c;
    }
    if (!best || Math.abs(best.t - e.t) > 0.6) return;
    const ms = Math.round((e.t - best.t) * 1000);
    const a = Math.abs(ms);
    const label = a <= 40 ? 'PERFECT' : a <= 90 ? 'GOOD' : ms < 0 ? 'EARLY' : 'LATE';
    const c = label === 'PERFECT' ? C.gold : label === 'GOOD' ? C.lime : C.salmon;
    this.syncLabel.set(`${label} ${ms > 0 ? '+' : ''}${ms}ms`);
    this.syncLabel.main.setTint(col(c));
    this.syncLabelTimer = 1.2;
    if (label === 'PERFECT') audio.play('good', 0.4, 1.5);
  }

  private onEvent(d: Diver, e: SimEvent, isPlayer: boolean): void {
    const inp = input();
    if (isPlayer) this.syncFeedback(e);
    const labelColor = (l?: string) => (l === 'PERFECT' ? C.gold : l === 'GOOD' ? C.lime : C.salmon);
    switch (e.type) {
      case 'charge':
        if (isPlayer) this.sfx('charge', true);
        break;
      case 'release':
        if (isPlayer) {
          this.flashLabel(e.label ?? '', labelColor(e.label));
          this.sfx(e.label === 'PERFECT' ? 'perfect' : e.label === 'GOOD' ? 'good' : 'miss', true, 0.8);
          if (!d.scripted) inp.vibrate(e.label === 'PERFECT' ? 60 : 30);
        }
        break;
      case 'takeoff':
        this.sfx('jump', isPlayer);
        break;
      case 'tuck':
      case 'pike':
        this.sfx('tuck', isPlayer, 0.7);
        break;
      case 'open':
        this.sfx('open', isPlayer, 0.7);
        break;
      case 'twist':
        this.sfx('twist', isPlayer, 0.8);
        break;
      case 'save':
        if (isPlayer) this.flashLabel('KOREKTA', C.sky);
        break;
      case 'crash':
        this.sfx('crash', isPlayer);
        this.startRagdoll(d);
        if (isPlayer) {
          this.hitstop = 0.12;
          this.cameras.main.shake(260, 0.02);
          this.flashLabel('UDERZENIE!', C.red, true);
          audio.roar(0.5, true);
          inp.vibrate(200, 1);
        }
        break;
      case 'entry': {
        const en = d.sim.entry!;
        const bad = en.flat || en.tuckEntry;
        if (bad) this.startRagdoll(d);
        if (en.rip === 'PERFECT' && !bad) {
          this.sfx('rip', isPlayer);
          if (isPlayer) {
            this.hitstop = 0.08;
            this.flash();
            this.flashLabel('RIP ENTRY!', C.cyan, true);
            audio.roar(Math.abs(en.angleErr) < 6 ? 1 : 0.6);
            inp.vibrate(80, 0.8);
            this.arena.cheer(1);
          }
        } else {
          this.sfx(bad || en.splash > 0.7 ? 'bigSplash' : 'splash', isPlayer);
          if (isPlayer) {
            if (bad) {
              this.cameras.main.shake(220, 0.015);
              this.flashLabel(en.flat ? 'PŁASKACZ!' : 'KUCZKA!', C.red, true);
              audio.roar(0.4, true);
              inp.vibrate(160, 1);
            } else {
              this.flashLabel(en.rip === 'NONE' ? 'BEZ RIPA' : en.rip, labelColor(en.rip));
              audio.roar(en.rip === 'GOOD' ? 0.55 : 0.3);
              this.arena.cheer(en.rip === 'GOOD' ? 0.6 : 0.3);
              inp.vibrate(40);
            }
          }
        }
        break;
      }
      case 'rip':
        if (isPlayer && e.label === 'LATE') this.flashLabel('LATE', C.salmon);
        break;
      default:
        break;
    }
  }

  private flash(): void {
    if (settings().reduceFlashes) return;
    this.flashTimer = 2 / 60;
  }

  // ---------------------------------------------------------------- render

  private render(alpha: number): void {
    const draw = (d: Diver | null) => {
      if (!d) return;
      if (d.ragdoll) {
        d.view.draw(d.ragdoll.segments(), d.ragdoll.sg, 1, 0);
      } else {
        d.view.update(lerpState(d.prev, d.curr, alpha), d === this.ghost);
      }
    };
    draw(this.player);
    draw(this.partner);
    draw(this.ghost);
    this.drawWorldHud();
  }

  private drawWorldHud(): void {
    const g = this.world;
    g.clear();
    const s = this.player.sim;
    const st = this.player.curr;
    const showAids = !this.cfg.tv && this.cfg.mode !== 'replay';
    // power ring
    if (showAids && (s.phase === 'charge' || (this.cfg.synchro && s.phase === 'ready' && this.stage === 'live'))) {
      const [cx, cy] = toScreen(FRONT, st.x, st.y);
      const [lo, hi] = s.zone;
      const r = (p: number) => 4 + p * 18;
      g.lineStyle(1, col(C.gold));
      for (let rr = Math.round(r(lo)); rr <= Math.round(r(hi)); rr++) g.strokeCircle(Math.round(cx), Math.round(cy), rr);
      const p = s.power;
      const inZone = p >= lo && p <= hi;
      g.lineStyle(1, col(inZone ? C.white : s.powerRising ? C.sky : C.salmon));
      g.strokeCircle(Math.round(cx), Math.round(cy), Math.round(r(p)));
    }
    // entry line
    const st2 = settings();
    if (showAids && s.lineVisible && st2.entryLine && !st2.pro && !this.has('noLine')) {
      const err = s.predictEntryError();
      let colr: number = C.lightGrey;
      if (Math.abs(err) <= LINE_GREEN_DEG) colr = C.lime;
      else if (this.assistOn) {
        const [a, b] = s.assistRange();
        if (Math.min(a, b) <= 0 && Math.max(a, b) >= 0) colr = C.gold;
        else if (err > 0) colr = C.red;
      } else if (err > 0) colr = C.red;
      const ang = s.targetAngle + (s.dive.rot * err * Math.PI) / 180;
      const len = 1.5;
      const [x0, y0] = toScreen(FRONT, st.x - Math.sin(ang) * len, st.y - Math.cos(ang) * len);
      const [x1, y1] = toScreen(FRONT, st.x + Math.sin(ang) * len, st.y + Math.cos(ang) * len);
      g.lineStyle(1, col(colr));
      g.lineBetween(Math.round(x0), Math.round(y0), Math.round(x1), Math.round(y1));
    }
  }

  private updateHud(dt: number): void {
    const g = this.hud;
    g.clear();
    if (this.labelTimer > 0) {
      this.labelTimer -= dt;
      if (this.labelTimer <= 0) this.label.set('');
    }
    if (this.syncLabelTimer > 0) {
      this.syncLabelTimer -= dt;
      if (this.syncLabelTimer <= 0) this.syncLabel.set('');
    }
    if (this.bigTimer > 0) {
      this.bigTimer -= dt;
      if (this.bigTimer <= 0) {
        this.bigText.setText('');
        this.bigShadow.setText('');
      }
    }
    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      g.fillStyle(col(C.white));
      g.fillRect(0, 0, WIDTH, HEIGHT);
    }
    // rhythm ribbon
    if (this.ribbonIcons.length) {
      g.fillStyle(col(C.black));
      g.fillRect(0, HEIGHT - 16, WIDTH, 16);
      g.fillStyle(col(C.slate));
      g.fillRect(0, HEIGHT - 16, WIDTH, 1);
      g.fillStyle(col(C.gold));
      g.fillRect(RIBBON_HIT_X - 6, HEIGHT - 15, 1, 15);
      g.fillRect(RIBBON_HIT_X + 5, HEIGHT - 15, 1, 15);
      const now = this.stage === 'intro' ? 0 : this.player.sim.t + this.acc;
      for (const ic of this.ribbonIcons) {
        const x = RIBBON_HIT_X + (ic.cue.t - now) * RIBBON_SPEED;
        const far = this.has('shortRibbon') ? RIBBON_HIT_X + 0.5 * RIBBON_SPEED : WIDTH + 8;
        ic.box.setVisible(x > RIBBON_HIT_X - 24 && x < far);
        ic.box.setX(Math.round(x));
      }
    }
    // training overlay: omega, I and predicted entry angle
    const s = this.player.sim;
    if (this.cfg.mode === 'training') {
      const w = (s.omega * 180) / Math.PI;
      const pred = s.phase === 'flight' ? s.predictEntryError() : 0;
      this.info.set(`ω ${Math.abs(w).toFixed(0).padStart(4)}°/s  I ${s.inertia.toFixed(2)}  kąt ${pred >= 0 ? '+' : ''}${pred.toFixed(0)}°`);
    } else if (!this.cfg.tv && !this.ribbonIcons.length && s.phase === 'flight') {
      const tw = s.dive.halfTwists ? `  śruby ${Math.floor(s.psi / Math.PI + 1e-6)}/${s.dive.halfTwists}` : '';
      this.info.set(tw);
    } else if (!this.ribbonIcons.length) {
      this.info.set('');
    }
    this.tv?.update(dt, s.t);
  }

  // ---------------------------------------------------------------- camera

  private placeCamera(snap: boolean, dt = 0): void {
    const cam = this.cameras.main;
    const s = this.player.sim;
    const st = this.player.curr;
    let tx: number;
    let ty: number;
    let zoom = 2;
    const tvShot = this.cfg.tv;
    if (s.phase === 'ready' || s.phase === 'charge' || s.phase === 'push') {
      tx = 1.2;
      ty = this.cfg.height + 0.4;
    } else if (s.phase === 'flight') {
      const ttc = s.timeToContact();
      if (ttc < 0.35 || st.y < 2.2) {
        tx = s.x;
        ty = Math.max(0.6, st.y - 0.6);
        zoom = 2;
      } else {
        zoom = 1;
        tx = st.x + 2.5;
        ty = st.y - (st.y > this.cfg.height ? 0.5 : 2.2);
      }
    } else {
      const [rx, ry] = this.player.ragdoll ? this.player.ragdoll.centre() : [st.x, st.y];
      tx = rx;
      ty = tvShot ? Math.min(-0.8, ry + 0.3) : Math.max(ry, -2.2) + 0.3;
      zoom = 2;
    }
    if (snap) {
      this.camX = tx;
      this.camY = ty;
      this.camZoom = zoom;
    } else {
      const k = 1 - Math.exp(-dt * (s.phase === 'flight' ? 9 : 5));
      this.camX += (tx - this.camX) * k;
      this.camY += (ty - this.camY) * k;
      if (zoom !== this.camZoom) this.camZoom = zoom;
    }
    cam.setZoom(this.camZoom);
    const [px, py] = toScreen(FRONT, this.camX, this.camY);
    cam.centerOn(Math.round(px), Math.round(py));
    void PPM;
  }

  // ---------------------------------------------------------------- results

  private finish(): void {
    if (this.stage !== 'end' || this.endTimer < 0.3) return;
    this.stage = 'intro';
    if (this.cfg.mode === 'replay') {
      if (this.cfg.returnTo) this.scene.start('Results', this.cfg.returnTo);
      else this.scene.start('Menu');
      return;
    }
    const dd = degreeOfDifficulty(this.dive, this.cfg.height);
    const seed = hashSeed(this.cfg.seed, this.dive.code, this.player.inputs.length);
    const replay: ReplayData = {
      v: 1,
      code: this.dive.code,
      height: this.cfg.height,
      zone: this.cfg.zoneWidth,
      seed: this.cfg.seed,
      assist: this.assistOn,
      arena: this.cfg.arena,
      inputs: this.player.inputs,
      outfit: getSave().outfit,
    };
    let result: DiveResult;
    if (this.partner) {
      replay.partner = this.cfg.partner ?? 'ola';
      replay.hep = HEP_T;
      replay.partnerInputs = this.partner.inputs;
      const j = judgeSynchro(record(this.player.sim), record(this.partner.sim), dd, seed);
      replay.score = j.score.total;
      result = { cfg: this.cfg, synchro: j, dd, replay, player: record(this.player.sim) };
    } else {
      const j = judgeIndividual(record(this.player.sim), dd, seed);
      replay.score = j.score.total;
      result = { cfg: this.cfg, solo: j, dd, replay, player: record(this.player.sim) };
    }
    this.scene.start('Results', result);
  }

  private leave(): void {
    if (this.cfg.mode === 'replay' && this.cfg.returnTo) this.scene.start('Results', this.cfg.returnTo);
    else if (this.cfg.mode === 'level') this.scene.start('Levels');
    else this.scene.start('Menu');
  }
}
