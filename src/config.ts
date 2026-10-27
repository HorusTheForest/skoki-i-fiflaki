// Game-wide constants. The name lives here only, so it can be swapped in one place.

export const GAME_TITLE = 'SKOKI OLIMPIJSKIE';
export const GAME_SUBTITLE = 'SYNCHRO 10 M';
/** Olympic rings on the title screen and in the arena */
export const SHOW_RINGS = true;

/**
 * The game buffer follows the window: it is the screen size divided by a
 * whole number of device pixels per game pixel, chosen so the buffer is at
 * least UI_W x UI_H. Bigger windows show more of the hall, never blurrier
 * pixels. These are live bindings, updated by setViewSize().
 */
export let WIDTH = 640;
export let HEIGHT = 360;
/** menus and panels are laid out in this safe area, centred on screen */
export const UI_W = 640;
export const UI_H = 360;

/** device pixels per game pixel for a window, and the resulting buffer */
export function viewFor(cssW: number, cssH: number, dpr: number): { k: number; w: number; h: number } {
  const dw = Math.floor(cssW * dpr);
  const dh = Math.floor(cssH * dpr);
  const k = Math.max(1, Math.floor(Math.min(dw / UI_W, dh / UI_H)));
  return { k, w: Math.max(UI_W, Math.floor(dw / k)), h: Math.max(UI_H, Math.floor(dh / k)) };
}

export function setViewSize(w: number, h: number): void {
  WIDTH = w;
  HEIGHT = h;
}
/** pixels per metre at camera zoom 1 */
export const PPM = 32;

/**
 * Optional Aseprite atlas replacing the procedural diver sprites. Export from
 * Aseprite with "Array" or "Hash" JSON and frames named like FRAME_NAMES in
 * src/render/sprites.ts, put both files in public/assets/ and set the base
 * name here, e.g. 'assets/diver'.
 */
export const ASEPRITE_ATLAS: string | null = null;

export const SAVE_KEY = 'skoki-olimpijskie-save';
