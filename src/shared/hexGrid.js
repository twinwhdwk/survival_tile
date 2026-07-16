import { MAP_COLS, MAP_ROWS, HEX_SIZE } from './mapConfig';

// Flat-top hexagons, "odd-q" vertical offset (odd columns shoved down by
// half a hex-height). Chosen so left/right neighbors sit on a clean
// horizontal line, matching how this game's wide map (see MAP_COLS/MAP_ROWS
// in mapConfig.js) already reads.
//
// All pixel<->hex math lives here, in one place shared by both the server
// (Room.js) and the client (GameScene.js) — if each hand-rolled its own
// version, the tiniest discrepancy would desync collision: a player could
// look fine locally while the server silently misreads their tile.
//
// `tileMap` itself stays the same [row][col] 2D array Room.js already
// uses everywhere; only "which hex is at this pixel" and "what are this
// hex's neighbors" change.

const SQRT3 = Math.sqrt(3);

export const HEX_WIDTH = HEX_SIZE * 2;
export const HEX_HEIGHT = HEX_SIZE * SQRT3;
const HORIZ_SPACING = HEX_SIZE * 1.5;
const VERT_SPACING = HEX_HEIGHT;

export const WORLD_WIDTH = Math.round(HORIZ_SPACING * (MAP_COLS - 1) + HEX_WIDTH);
export const WORLD_HEIGHT = Math.round(VERT_SPACING * (MAP_ROWS - 1) + HEX_HEIGHT + VERT_SPACING / 2);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// "Is this odd", safe for negative integers (plain `n % 2` returns -1 for
// odd negatives in JS, which breaks the parity comparisons below).
function parity(n) {
  return ((n % 2) + 2) % 2;
}

// Odd-q offset <-> axial conversions, kept internal and used both to
// place hexes on screen and to derive neighbors below — deriving
// hexNeighbors *from* these (rather than hand-typing a parity-based
// offset delta table) means its correctness follows directly from
// offsetToAxial/axialToOffset already round-tripping correctly.
function offsetToAxial(row, col) {
  const q = col;
  const r = row - (col - parity(col)) / 2;
  return { q, r };
}

function axialToOffset(q, r) {
  const col = q;
  const row = r + (q - parity(q)) / 2;
  return { row, col };
}

// Center pixel of a given (row, col) hex. Offset so the whole grid sits
// inside [0, WORLD_WIDTH] x [0, WORLD_HEIGHT], the same way the old
// square grid always centered tile (0,0) at (TILE_SIZE/2, TILE_SIZE/2)
// rather than (0,0).
export function hexToPixel(row, col) {
  const x = HEX_SIZE + HORIZ_SPACING * col;
  const y = HEX_HEIGHT / 2 + VERT_SPACING * row + (parity(col) ? VERT_SPACING / 2 : 0);
  return { x, y };
}

// Rounds fractional cube coordinates (q + r + s === 0) to the nearest
// integer hex, fixing up whichever component had the largest rounding
// error so the q+r+s===0 invariant is preserved. Standard hex-grid
// technique — without this, a point near a hex's edge can round to a
// {q,r,s} that isn't actually adjacent to anything sensible.
function cubeRound(q, r, s) {
  let rq = Math.round(q);
  let rr = Math.round(r);
  let rs = Math.round(s);

  const qDiff = Math.abs(rq - q);
  const rDiff = Math.abs(rr - r);
  const sDiff = Math.abs(rs - s);

  if (qDiff > rDiff && qDiff > sDiff) {
    rq = -rr - rs;
  } else if (rDiff > sDiff) {
    rr = -rq - rs;
  } else {
    rs = -rq - rr;
  }
  return { q: rq, r: rr };
}

// Pixel -> hex, via fractional axial coordinates + cube rounding so a
// point near a hex's edge resolves to the geometrically nearer hex
// instead of whatever a naive floor-division would pick. Clamped to the
// grid so an off-map pixel (e.g. a player pinned at the world edge)
// still resolves to a real, in-bounds tile.
export function pixelToHex(x, y) {
  const px = (x - HEX_SIZE) / HEX_SIZE;
  const py = (y - HEX_HEIGHT / 2) / HEX_SIZE;

  const qf = (2 / 3) * px;
  const rf = (-1 / 3) * px + (SQRT3 / 3) * py;
  const sf = -qf - rf;

  const { q, r } = cubeRound(qf, rf, sf);
  const { row, col } = axialToOffset(q, r);

  return {
    row: clamp(row, 0, MAP_ROWS - 1),
    col: clamp(col, 0, MAP_COLS - 1),
  };
}

const AXIAL_DIRECTIONS = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
];

// The 6 neighbors of (row, col), in-bounds only. Replaces the old
// 4-direction (up/down/left/right) neighbor lists used by the server's
// bot pathfinding. Each result also carries `dir` — its index into
// AXIAL_DIRECTIONS (0-5) — so callers can bias movement toward a
// remembered heading (see Room.js's bot pathing) instead of only
// knowing the destination coordinates.
export const DIRECTION_COUNT = AXIAL_DIRECTIONS.length;

export function hexNeighbors(row, col) {
  const { q, r } = offsetToAxial(row, col);
  const result = [];
  AXIAL_DIRECTIONS.forEach(({ q: dq, r: dr }, dir) => {
    const { row: nRow, col: nCol } = axialToOffset(q + dq, r + dr);
    if (nRow >= 0 && nRow < MAP_ROWS && nCol >= 0 && nCol < MAP_COLS) {
      result.push({ row: nRow, col: nCol, dir });
    }
  });
  return result;
}
