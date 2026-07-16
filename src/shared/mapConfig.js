// Center-to-corner radius of each hexagon tile. Pixel<->hex conversion,
// world dimensions, and neighbor math all live in hexGrid.js (which
// imports this) rather than here, to avoid a circular import back into
// this file.
export const HEX_SIZE = 24;
// Taller-than-wide (rather than the original 20x15 wide layout) so the
// resulting WORLD_WIDTH/WORLD_HEIGHT (see hexGrid.js) is close enough to a
// phone's own portrait aspect ratio that Phaser.Scale.FIT fills most of the
// screen without asking the player to physically rotate their device.
// Total tile count (280) is kept close to the original 300 on purpose --
// every balance constant tuned against "how many tiles are in play" (auto
// tile regen burst size, boundary MAX_ROW_INSET/MAX_COL_INSET, etc.) is
// derived from MAP_COLS/MAP_ROWS directly, so reshaping the rectangle
// without changing its area keeps that tuning valid without re-deriving it.
export const MAP_COLS = 14;
export const MAP_ROWS = 20;

export const TILE_STATE = {
  GONE: 0,
  SOLID: 1,
  WARNING: 2,
};

export const WARNING_DELAY_MS = 600;
export const COLLAPSE_DELAY_MS = 600;
