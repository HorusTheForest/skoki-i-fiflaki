// Game-wide constants. The name lives here only, so it can be swapped in one place.

export const GAME_TITLE = 'SKOKI OLIMPIJSKIE';
export const GAME_SUBTITLE = 'SYNCHRO 10 M';
/** Olympic rings on the title screen and in the arena */
export const SHOW_RINGS = true;

export const WIDTH = 320;
export const HEIGHT = 180;
/** pixels per metre at camera zoom 1 */
export const PPM = 16;

/**
 * Optional Aseprite atlas replacing the procedural diver sprites. Export from
 * Aseprite with "Array" or "Hash" JSON and frames named like FRAME_NAMES in
 * src/render/sprites.ts, put both files in public/assets/ and set the base
 * name here, e.g. 'assets/diver'.
 */
export const ASEPRITE_ATLAS: string | null = null;

export const SAVE_KEY = 'skoki-olimpijskie-save';
