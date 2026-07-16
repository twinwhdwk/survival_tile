// Center-to-corner radius of each hexagon tile. Pixel<->hex conversion,
// world dimensions, and neighbor math all live in hexGrid.js (which
// imports this) rather than here, to avoid a circular import back into
// this file.
export const HEX_SIZE = 24;
// Widened from the original 20x15 (aspect ~1.14, nearly square), first to
// 26x12 (~1.82) and then a further ~20% wider still to 31x12 (~2.17) so
// the resulting WORLD_WIDTH/WORLD_HEIGHT (see hexGrid.js) closely matches
// a landscape phone's own aspect ratio (~2.16) under Phaser.Scale.FIT,
// which now fills almost the entire screen with no black bars. A 16:9
// desktop monitor (~1.78 aspect) is comparatively narrower than that, so
// it now letterboxes a bit top/bottom instead of side/side -- an accepted
// tradeoff for prioritizing the phone experience. Every balance constant
// tuned against "how many tiles are in play" (auto tile regen burst size,
// boundary MAX_ROW_INSET/MAX_COL_INSET, etc.) is derived from
// MAP_COLS/MAP_ROWS directly, so it scales automatically with tile count
// rather than needing to be re-derived by hand.
export const MAP_COLS = 31;
export const MAP_ROWS = 12;

export const TILE_STATE = {
  GONE: 0,
  SOLID: 1,
  WARNING: 2,
};

export const WARNING_DELAY_MS = 600;
export const COLLAPSE_DELAY_MS = 600;
