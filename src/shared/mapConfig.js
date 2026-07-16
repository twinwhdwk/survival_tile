// Center-to-corner radius of each hexagon tile. Pixel<->hex conversion,
// world dimensions, and neighbor math all live in hexGrid.js (which
// imports this) rather than here, to avoid a circular import back into
// this file.
export const HEX_SIZE = 24;
// Phaser.Scale.FIT always normalizes the whole board to fill the same
// on-screen footprint regardless of tile count -- so a tile's *visual*
// size on a real screen is set entirely by how many tiles fit across that
// footprint, not by HEX_SIZE (raising HEX_SIZE alone while keeping the
// same tile count just renders at a higher internal resolution with zero
// visual size change, since FIT scales the bigger canvas back down to the
// same physical screen). To make every tile -- and everything sized in
// world-pixel terms alongside it (avatars, HUD text, panels) -- read as
// twice as large without touching a single one of those sizes by hand,
// both axes here are halved from 31x12, so half as many (2x bigger) tiles
// fit across the same footprint. Aspect ratio (~2.17) is preserved to
// keep the same landscape-phone screen fit this was last tuned for. Every
// balance constant tuned against "how many tiles are in play" (auto tile
// regen burst size, boundary MAX_ROW_INSET/MAX_COL_INSET, etc.) is derived
// from MAP_COLS/MAP_ROWS directly, so it scales automatically with tile
// count rather than needing to be re-derived by hand.
export const MAP_COLS = 16;
export const MAP_ROWS = 6;

export const TILE_STATE = {
  GONE: 0,
  SOLID: 1,
  WARNING: 2,
};

export const WARNING_DELAY_MS = 600;
export const COLLAPSE_DELAY_MS = 600;
