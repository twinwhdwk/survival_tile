// Center-to-corner radius of each hexagon tile. Pixel<->hex conversion,
// world dimensions, and neighbor math all live in hexGrid.js (which
// imports this) rather than here, to avoid a circular import back into
// this file.
export const HEX_SIZE = 24;
export const MAP_COLS = 20;
export const MAP_ROWS = 15;

export const TILE_STATE = {
  GONE: 0,
  SOLID: 1,
  WARNING: 2,
};

export const WARNING_DELAY_MS = 600;
export const COLLAPSE_DELAY_MS = 600;
