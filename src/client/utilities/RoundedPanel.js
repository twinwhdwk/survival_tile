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

export function drawRoundedPanel(graphics, centerX, centerY, width, height) {
  const x = centerX - width / 2;
  const y = centerY - height / 2;

  graphics.clear();
  graphics.fillStyle(COLORS.panelFill, COLORS.panelFillAlpha);
  graphics.fillRoundedRect(x, y, width, height, RADIUS);
  graphics.lineStyle(COLORS.panelBorderWidth, COLORS.panelBorder, COLORS.panelBorderAlpha);
  graphics.strokeRoundedRect(x, y, width, height, RADIUS);
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
