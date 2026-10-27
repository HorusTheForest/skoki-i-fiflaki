// Unified input: keyboard, mouse, touch and gamepad mapped onto one ACTION
// button and four directions (all remappable). Produces the per-tick bitmask
// the simulation consumes, with short taps latched so that a press and
// release inside one frame is never lost.

import { IN } from '../physics/diver';
import { settings, type Bindable } from './save';

const BIT: Record<Bindable, number> = {
  action: IN.ACTION,
  up: IN.UP,
  down: IN.DOWN,
  left: IN.LEFT,
  right: IN.RIGHT,
  back: 32,
};
export const BACK = 32;
const BINDABLES: Bindable[] = ['action', 'up', 'down', 'left', 'right', 'back'];

export class Input {
  private keyHeld = 0;
  private pointerHeld = 0;
  private padHeld = 0;
  /** presses not yet seen by a consumer */
  private latchedSim = 0;
  /** menu presses in order, one consumed per frame, so fast sequences are not merged */
  private menuQueue: number[] = [];
  private activePointers = new Map<number, number>();
  private touchStart = new Map<number, { x: number; y: number; t: number }>();
  /** called with the KeyboardEvent.code of the next key (for remapping) */
  captureKey: ((code: string) => void) | null = null;
  lastDevice: 'keyboard' | 'touch' | 'mouse' | 'pad' = 'keyboard';
  private readonly el: HTMLElement;

  constructor(el: HTMLElement) {
    this.el = el;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    el.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  destroy(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.el.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
  }

  private bitForKey(code: string): number {
    const keys = settings().keys;
    let m = 0;
    for (const b of BINDABLES) if (keys[b].includes(code)) m |= BIT[b];
    return m;
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (this.captureKey) {
      e.preventDefault();
      const cb = this.captureKey;
      this.captureKey = null;
      cb(e.code);
      return;
    }
    const m = this.bitForKey(e.code);
    if (!m) return;
    e.preventDefault();
    this.lastDevice = 'keyboard';
    if (e.repeat) return;
    this.keyHeld |= m;
    this.latchedSim |= m;
    this.menuQueue.push(m);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    const m = this.bitForKey(e.code);
    this.keyHeld &= ~m;
  };

  private onBlur = () => {
    this.keyHeld = 0;
    this.pointerHeld = 0;
    this.activePointers.clear();
  };

  /** screen zones: edges are directions, the rest is ACTION (lower part = ACTION + ↓) */
  private zoneBits(e: PointerEvent): number {
    const r = this.el.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width;
    const fy = (e.clientY - r.top) / r.height;
    if (e.pointerType !== 'touch') return IN.ACTION;
    if (fx < 0.14) return IN.LEFT;
    if (fx > 0.86) return IN.RIGHT;
    return fy > 0.72 ? IN.ACTION | IN.DOWN : IN.ACTION;
  }

  /** last pointer position in game pixels (for menus) */
  pointer: { x: number; y: number; down: boolean; clicked: boolean } = { x: -1, y: -1, down: false, clicked: false };
  /** set by the game so pointer positions can be mapped to the 320x180 buffer */
  toGame: (clientX: number, clientY: number) => [number, number] = (x, y) => [x, y];

  private onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.lastDevice = e.pointerType === 'touch' ? 'touch' : 'mouse';
    const bits = this.zoneBits(e);
    this.activePointers.set(e.pointerId, bits);
    this.touchStart.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now() });
    this.recomputePointers();
    this.latchedSim |= bits;
    const [gx, gy] = this.toGame(e.clientX, e.clientY);
    this.pointer = { x: gx, y: gy, down: true, clicked: true };
  };

  private onPointerUp = (e: PointerEvent) => {
    const start = this.touchStart.get(e.pointerId);
    if (start && e.pointerType === 'touch') {
      // quick upward swipe = ↑ (half twist)
      const dy = e.clientY - start.y;
      const dt = performance.now() - start.t;
      if (dy < -30 && dt < 350) {
        this.latchedSim |= IN.UP;
        this.menuQueue.push(IN.UP);
      }
    }
    this.touchStart.delete(e.pointerId);
    this.activePointers.delete(e.pointerId);
    this.recomputePointers();
    this.pointer.down = this.activePointers.size > 0;
  };

  private recomputePointers() {
    let m = 0;
    for (const b of this.activePointers.values()) m |= b;
    this.pointerHeld = m;
  }

  /** poll gamepads; call once per frame */
  poll(): void {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    let m = 0;
    const map = settings().pad;
    for (const p of pads) {
      if (!p) continue;
      for (const b of BINDABLES) {
        if (map[b].some((i) => p.buttons[i]?.pressed)) m |= BIT[b];
      }
      const ax = p.axes[0] ?? 0;
      const ay = p.axes[1] ?? 0;
      if (ax < -0.5) m |= IN.LEFT;
      if (ax > 0.5) m |= IN.RIGHT;
      if (ay < -0.5) m |= IN.UP;
      if (ay > 0.5) m |= IN.DOWN;
    }
    const pressed = m & ~this.padHeld;
    if (pressed) {
      this.latchedSim |= pressed;
      this.menuQueue.push(pressed);
      this.lastDevice = 'pad';
    }
    this.padHeld = m;
  }

  held(): number {
    return this.keyHeld | this.pointerHeld | this.padHeld;
  }

  /** mask for one simulation tick: held buttons plus latched taps */
  simMask(): number {
    const m = (this.held() | this.latchedSim) & 31;
    this.latchedSim = 0;
    return m;
  }

  /** buttons pressed since the last call (menus); call once per frame */
  menuPressed(): number {
    return this.menuQueue.shift() ?? 0;
  }

  takeClick(): { x: number; y: number } | null {
    if (!this.pointer.clicked) return null;
    this.pointer.clicked = false;
    return { x: this.pointer.x, y: this.pointer.y };
  }

  clearLatches(): void {
    this.latchedSim = 0;
    this.menuQueue = [];
    this.pointer.clicked = false;
  }

  vibrate(ms: number, strength = 0.6): void {
    if (!settings().vibration) return;
    try {
      if (this.lastDevice === 'pad') {
        for (const p of navigator.getGamepads()) {
          const act = (p as Gamepad & { vibrationActuator?: { playEffect: (t: string, o: object) => void } })?.vibrationActuator;
          act?.playEffect('dual-rumble', { duration: ms, strongMagnitude: strength, weakMagnitude: strength });
        }
      } else if (navigator.vibrate) {
        navigator.vibrate(ms);
      }
    } catch {
      // vibration is optional
    }
  }
}

let instance: Input | null = null;
export function initInput(el: HTMLElement): Input {
  instance ??= new Input(el);
  return instance;
}
export function input(): Input {
  if (!instance) throw new Error('Input not initialised');
  return instance;
}
