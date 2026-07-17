import { HEX_WIDTH, HEX_HEIGHT } from '../../shared/hexGrid';

// A couple pixels smaller than the true hex spacing so adjacent tiles
// keep a visible gap/border between them, matching how the old square
// tiles used TILE_SIZE - 2 for the same reason.
const HEX_RADIUS = HEX_WIDTH / 2 - 1;

// Flat-top hexagon vertices (two points on the horizontal axis, flat
// edges top and bottom) around (cx, cy) at the given circumradius.
function hexPoints(cx, cy, radius) {
  const points = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i);
    points.push({ x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
  }
  return points;
}

function drawBeveledHex(g, width, height, topColor, bottomColor, borderColor) {
  const cx = width / 2;
  const cy = height / 2;
  const bevelOffset = 3;

  g.fillStyle(bottomColor, 1);
  g.fillPoints(hexPoints(cx, cy, HEX_RADIUS), true);

  g.fillStyle(topColor, 1);
  g.fillPoints(hexPoints(cx, cy - bevelOffset, HEX_RADIUS - bevelOffset), true);

  g.fillStyle(0xffffff, 0.14);
  g.fillPoints(hexPoints(cx, cy - HEX_RADIUS * 0.35, HEX_RADIUS * 0.55), true);

  g.lineStyle(2, borderColor, 0.85);
  g.strokePoints(hexPoints(cx, cy, HEX_RADIUS - 1), true);
}

export function generateParticleTextures(scene) {
  if (!scene.textures.exists('particle_debris')) {
    const g = scene.add.graphics();
    g.fillStyle(0xffffff, 1);
    g.fillRect(0, 0, 6, 6);
    g.generateTexture('particle_debris', 6, 6);
    g.destroy();
  }

  if (!scene.textures.exists('particle_spark')) {
    const g = scene.add.graphics();
    g.fillStyle(0xffffff, 1);
    g.fillCircle(4, 4, 4);
    g.generateTexture('particle_spark', 8, 8);
    g.destroy();
  }
}

export function generateTileTextures(scene) {
  // Warm bronze/stone tones -- previously a cool navy/periwinkle-blue pair,
  // the same "generic cold UI" palette Theme.js's own panels moved away
  // from in favor of a warm ember family. The board is the single most
  // visible thing on screen during actual play, so leaving it on the old
  // cool palette while every HUD panel around it went warm was the biggest
  // remaining source of the app reading as visually unfinished/inconsistent.
  // tile_warning stays a hot coral-red -- already warm, and needs to read
  // as "danger" clearly against the new warmer solid tiles regardless.
  const defs = {
    tile_solid: { top: 0x6b5636, bottom: 0x2e2115, border: 0xd9a95f },
    tile_solid_b: { top: 0x5c4a2e, bottom: 0x281d10, border: 0xc79752 },
    tile_warning: { top: 0xff7a52, bottom: 0xa8321a, border: 0xffc9a0 },
  };

  Object.entries(defs).forEach(([key, { top, bottom, border }]) => {
    if (scene.textures.exists(key)) {
      return;
    }
    const g = scene.add.graphics();
    drawBeveledHex(g, HEX_WIDTH, HEX_HEIGHT, top, bottom, border);
    g.generateTexture(key, HEX_WIDTH, HEX_HEIGHT);
    g.destroy();
  });

  generateParticleTextures(scene);
}

export function generateBackgroundTexture(scene, key, width, height) {
  if (scene.textures.exists(key)) {
    return;
  }

  const canvasTexture = scene.textures.createCanvas(key, width, height);
  const ctx = canvasTexture.getContext();
  // Warm dark bronze fading to near-black -- was a cool navy blue, the same
  // mismatch as the tile textures above (see generateTileTextures' own
  // comment); this is what shows through every collapsed tile's hole, so it
  // needs to match the board's new warm palette, not the old cool one.
  const gradient = ctx.createRadialGradient(
    width / 2, height / 2, 0,
    width / 2, height / 2, Math.max(width, height) / 1.25
  );
  gradient.addColorStop(0, '#2e2015');
  gradient.addColorStop(1, '#0d0805');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  canvasTexture.refresh();
}
