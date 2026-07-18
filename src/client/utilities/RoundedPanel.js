import { COLORS } from '../theme/Theme';

// Phaser's Rectangle GameObject has no corner-radius option, and its flat
// square corners read as an unstyled debug box against everything else in
// the game's soft, rounded visual language (DOM buttons/inputs at 8-10px
// radius, hex tile bevels, particle glow). Graphics has no persistent
// .setSize() the way Rectangle does, so this clears + redraws the panel
// each time it needs to change size, using text.getBounds() (not .width,
// which undercounts emoji glyphs) so the panel snugly wraps what's
// actually drawn.
const RADIUS = 10;

// Lower-level draw with overridable colors/radius, for the rare panel that
// isn't the standard ember fill+border (e.g. a highlighted "this is you"
// roster cell) or that's too small for the default radius to look right.
export function drawRoundedRect(graphics, centerX, centerY, width, height, {
  radius = RADIUS,
  fillColor = COLORS.panelFill,
  fillAlpha = COLORS.panelFillAlpha,
  strokeWidth = COLORS.panelBorderWidth,
  strokeColor = COLORS.panelBorder,
  strokeAlpha = COLORS.panelBorderAlpha,
} = {}) {
  const x = centerX - width / 2;
  const y = centerY - height / 2;

  graphics.clear();

  // Soft drop shadow -- a slightly offset, darker duplicate of the panel's
  // own silhouette underneath the fill, so every panel reads as sitting
  // just above the scene instead of pasted flat onto it. Same flat-offset
  // language as every DOM button's own box-shadow (ButtonFx.js) rather
  // than a new one-off effect, and drawn through this one shared function
  // so it applies uniformly everywhere a real panel is drawn. Skipped below
  // a fill opacity of 0.3: fillAlpha: 0 callers (e.g. DashboardScene's card
  // border) are a decorative outline-only overlay with no fill to look
  // elevated at all, and a thin, mostly-transparent tint (e.g. ResultScene's
  // 0.12-alpha "this is my rank" highlight bar) would otherwise get a
  // shadow more visually prominent than the highlight itself -- backwards
  // for something meant to read as a soft glow, not a physical panel.
  if (fillAlpha >= 0.3) {
    graphics.fillStyle(0x000000, 0.28);
    graphics.fillRoundedRect(x + 2, y + 3, width, height, radius);
  }

  graphics.fillStyle(fillColor, fillAlpha);
  graphics.fillRoundedRect(x, y, width, height, radius);
  graphics.lineStyle(strokeWidth, strokeColor, strokeAlpha);
  graphics.strokeRoundedRect(x, y, width, height, radius);

  // A second, dimmer inset line just inside the main border -- ties every
  // panel to the same beveled-highlight material language already drawn on
  // every hex tile (see EffectTextures.js's drawBeveledHex) instead of
  // sitting apart from it. These COLORS.panelInnerLine* tokens existed in
  // Theme.js already (with exactly this description) but nothing actually
  // drew them. Skipped on panels too small for a 3px inset to read as
  // anything but noise, and on a per-corner radius object (e.g. a header
  // strip rounded on only its top two corners) -- `radius - inset` below
  // assumes a plain number.
  if (typeof radius === 'number' && width > 30 && height > 24) {
    const inset = 3;
    graphics.lineStyle(1, COLORS.panelInnerLine, COLORS.panelInnerLineAlpha);
    graphics.strokeRoundedRect(x + inset, y + inset, width - inset * 2, height - inset * 2, Math.max(radius - inset, 2));
  }
}

export function drawRoundedPanel(graphics, centerX, centerY, width, height) {
  drawRoundedRect(graphics, centerX, centerY, width, height);
}

// getBounds() reflects the text object's *current* transform, so this is
// only safe to call while the text is at scale=1 — some titles (LoginScene,
// ResultScene) start at a smaller entrance-tween scale, and measuring
// mid-tween would size the panel for that shrunk pose instead of the
// settled text. Callers with that scale animation size their panel before
// applying the scale, not after.
export function fitTitlePanel(graphics, centerX, centerY, height, text, paddingX) {
  const bounds = text.getBounds();
  drawRoundedPanel(graphics, centerX, centerY, bounds.width + paddingX, height);
}

// Same idea as fitTitlePanel, but for GameScene's small HUD chips (timer,
// score, player count, ...), which anchor at a corner/edge rather than
// their own center (matching the Rectangle .setOrigin() convention they
// had before) — (anchorX, anchorY) is the fixed on-screen point,
// (originX, originY) says which fraction of the panel that point
// represents, same numbers as the .setOrigin() call would have used.
export function fitAnchoredRoundedPanel(graphics, anchorX, anchorY, originX, originY, height, text, paddingX, extraOptions = {}) {
  const bounds = text.getBounds();
  const width = bounds.width + paddingX;
  const centerX = anchorX + width * (0.5 - originX);
  const centerY = anchorY + height * (0.5 - originY);
  drawRoundedRect(graphics, centerX, centerY, width, height, { radius: 6, ...extraOptions });
}
