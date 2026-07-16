// Center-to-corner radius of each hexagon tile. Pixel<->hex conversion,
// world dimensions, and neighbor math all live in hexGrid.js (which
// imports this) rather than here, to avoid a circular import back into
// this file.
export const HEX_SIZE = 24;
// Widened from the original 20x15 (aspect ~1.14, nearly square) to 26x12
// (aspect ~1.82) so the resulting WORLD_WIDTH/WORLD_HEIGHT (see hexGrid.js)
// actually fills a real landscape screen -- 1.14 left huge black bars on
// the sides of both a landscape phone (~2.16 aspect) and a 16:9 desktop
// monitor (~1.78 aspect) under Phaser.Scale.FIT. Total tile count (312) is
// kept close to the original 300 on purpose -- every balance constant
// tuned against "how many tiles are in play" (auto tile regen burst size,
// boundary MAX_ROW_INSET/MAX_COL_INSET, etc.) is derived from
// MAP_COLS/MAP_ROWS directly, so reshaping the rectangle without changing
// its area keeps that tuning valid without re-deriving it.
export const MAP_COLS = 26;
export const MAP_ROWS = 12;

export const TILE_STATE = {
  GONE: 0,
  SOLID: 1,
  WARNING: 2,
};

export const WARNING_DELAY_MS = 600;
export const COLLAPSE_DELAY_MS = 600;
