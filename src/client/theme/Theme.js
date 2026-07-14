// Central design tokens for every scene. Previously each scene hardcoded its
// own font family string and near-identical panel colors independently,
// which drifted slightly out of sync (a plain navy fill + near-invisible
// white 0.08 hairline stroke) and read as generic/incomplete rather than
// part of the game's own "burning tile boundary" theme. Pulling everything
// through one module keeps every screen visually consistent and makes a
// future palette change a one-line edit instead of a many-file hunt.

// Display face: bold, blocky, poster-style Korean face for titles/headlines
// and other moments that should feel like game-show/tournament signage.
// Body face: a clean geometric Korean UI face with real weight range, for
// HUD readouts, labels, and anything read at a glance during play.
// Both ship as Google Fonts (see public/index.html) with the old system
// font kept as a final fallback for the rare case the webfont fails to load.
export const FONT_DISPLAY = "'Black Han Sans', 'Malgun Gothic', sans-serif";
export const FONT_BODY = "'Gothic A1', 'Malgun Gothic', sans-serif";

export const COLORS = {
  // Panel fill: a warm, near-black brown rather than the previous cold navy,
  // so HUD/dialog panels read as part of the same "ember" world as the fire
  // title and particle effects instead of a generic dark-mode admin panel.
  panelFill: 0x1c130d,
  panelFillAlpha: 0.68,
  // Amber border replaces the old near-invisible white hairline — visible
  // enough that every panel clearly reads as a panel, echoing the hex tile
  // bevel borders already used on the game board itself.
  panelBorder: 0xffa94d,
  panelBorderAlpha: 0.55,
  panelBorderWidth: 2,
  // A second, dimmer inner line just inside the main border, matching the
  // beveled highlight already drawn on every hex tile — ties HUD chrome to
  // the board's own material language instead of sitting apart from it.
  panelInnerLine: 0xffd9a0,
  panelInnerLineAlpha: 0.18,

  textPrimary: '#f5efe4',
  textMuted: '#a9a6c4',
  textEmber: '#ff8a4c',
  textGold: '#ffd700',
  textSilver: '#dcdcdc',
  textBronze: '#e0a458',
  textDanger: '#ff8888',
  textGood: '#7CFFA0',
  textInfo: '#8fd0ff',
};

export const TEXT_STROKE = '#1a0f07';
