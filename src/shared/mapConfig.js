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
// same physical screen). The tile grid is one shared, server-authoritative
// board -- every viewer of a room (mobile players and an admin spectating
// from a PC) sees the exact same cells, so there's no way to give the
// admin a more detailed grid without every mobile player's tiles shrinking
// by the same amount too. 18x7 (up slightly from 16x6) is a compromise
// nudge in that direction, not a full reversion to the original 31x12.
// Aspect ratio (~2.12) stays close to a landscape phone's own (~2.16).
// Every balance constant tuned against "how many tiles are in play" (auto
// tile regen burst size, boundary MAX_ROW_INSET/MAX_COL_INSET, etc.) is
// derived from MAP_COLS/MAP_ROWS directly, so it scales automatically with
// tile count rather than needing to be re-derived by hand.
export const MAP_COLS = 18;
export const MAP_ROWS = 7;

export const TILE_STATE = {
  GONE: 0,
  SOLID: 1,
  WARNING: 2,
};

// Total time from stepping on a SOLID tile to it actually being gone is
// WARNING_DELAY_MS + COLLAPSE_DELAY_MS -- was 1200ms (600+600), bumped ~10%
// to 1320ms (660+660) per an operator request phrased as "if it's 2s, make
// it 2.2s" (it's actually 1.2s, not 2s -- applied that same ~10% ratio to
// the real value rather than the guessed one).
export const WARNING_DELAY_MS = 660;
export const COLLAPSE_DELAY_MS = 660;
