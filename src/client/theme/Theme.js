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

// Google serves Black Han Sans (and most CJK webfonts) as dozens of small
// files, each covering only a narrow unicode-range slice of the Hangul
// syllable block -- necessary given how many glyphs a Korean font needs,
// but it means the browser only fetches the specific slice covering
// whatever characters a page actually asks to render, on demand. Canvas
// text (all of this game's UI, via Phaser) doesn't "ask" the way DOM text
// does: if the slice for a given character hasn't arrived yet, Phaser's
// Text draws that one character in the fallback font immediately and never
// retries, rather than waiting -- so a single Text object can end up with
// one oddly-thin fallback glyph sitting inside otherwise-bold Black Han
// Sans (e.g. "1라운드 조별 현황"'s "별", which this exact text sample below
// exists to catch). client.js explicitly calls document.fonts.load() with
// this string before the game starts, forcing every unicode-range slice
// these specific characters need to be fetched upfront, rather than
// relying on whatever slice Phaser's own draws happen to trigger on their
// own schedule. Keep this in sync with every fixed (non-nickname) string
// styled with FONT_DISPLAY across every scene -- a new title/banner string
// added without a matching entry here is exposed to the same bug.
export const FONT_DISPLAY_FAMILY = 'Black Han Sans';
// Shared event banner shown big at the very top of both LoginScene and
// LobbyScene — one constant so the two screens can't drift out of sync.
export const EVENT_BANNER_TEXT = 'FIL2 소확행 EVENT';
export const FONT_DISPLAY_SAMPLE_TEXT = [
  EVENT_BANNER_TEXT,
  '🔥 타일 서바이벌 🔥',
  '🔥 대기실',
  '라운드 조별 현황',
  '시작!',
  '보스전 시작!',
  '협력해서 보스를 물리치세요!',
  '생존하라!',
  '타일이 무너지기 전에 버티세요',
  '⚡ 라스트 스탠드!',
  '유령들이 훨씬 빠르게 타일을 복구합니다',
  '💫 부활 게이지 가득!',
  '유령 부활!',
  '경계가 불타오릅니다!',
  '중앙으로 대피하세요!',
  '보스를 물리쳤습니다! 🎉',
  '⚠️ 보스의 대지 붕괴!',
  '라운드 종료! 다음 라운드를 준비하는 중...',
  '생존!',
  '탈락했습니다.',
  '토너먼트 결과',
].join(' ');

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
