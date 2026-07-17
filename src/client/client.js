import Phaser from 'phaser';
import GameScene from './scenes/GameScene';
import LoginScene from './scenes/LoginScene';
import LobbyScene from './scenes/LobbyScene';
import ResultScene from './scenes/ResultScene';
import DashboardScene from './scenes/DashboardScene';
import { WORLD_WIDTH, WORLD_HEIGHT } from '../shared/hexGrid';
import {
  FONT_DISPLAY_FAMILY, FONT_DISPLAY_SAMPLE_TEXT, FONT_BODY_FAMILY, FONT_BODY_SAMPLE_TEXT,
} from './theme/Theme';

const config = {
  title:    '타일 서바이벌',
  parent:   'game',
  type:     Phaser.AUTO,
  input: {
    keyboard: true,
    mouse:    true,
    touch:    true,
    gamepad:  false,
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
  },
  render: {
    // This game draws everything (tiles, particles, text) as smooth
    // gradients/vector shapes, never blocky pixel-art sprites, so forcing
    // nearest-neighbor sampling here was actively wrong: it made the CSS
    // upscale from the small design canvas to the real screen size render
    // with `image-rendering: pixelated`, which is what made stroked text
    // and panel edges look chunky/"shadowed" instead of clean.
    pixelArt:   false,
    antialias:  true,
    antialiasGL: true,
    // NOTE: config.resolution is a documented no-op in this Phaser version
    // (3.23) -- Phaser.Scale.ScaleManager.setGameSize() hardcodes
    // `this.resolution = 1` unconditionally ("fixed at 1 on purpose...
    // changing it will break all user input. Wait for another release to
    // solve this issue" — see node_modules/phaser/src/scale/ScaleManager.js
    // around setGameSize()). A PC/large-screen-targeted resolution value
    // was tried here and verified (via canvas.width in a real headless
    // browser test) to have zero effect on the actual canvas backing-store
    // size — kept at a plain constant rather than a formula that silently
    // does nothing. A real per-device resolution boost would need a
    // different mechanism entirely (e.g. an oversized scale.width/height
    // combined with compensating camera zoom) — non-trivial and not
    // attempted here since it risks desyncing input coordinates across
    // every scene; left for a dedicated pass if this is worth pursuing.
    resolution: Math.min(window.devicePixelRatio || 1, 2),
  },
  // Matches the CSS body background and the outer edge of every scene's
  // own radial gradient (EffectTextures.js) rather than pure black, so
  // there's no visible seam anywhere -- canvas edges, CSS letterboxing,
  // and each scene's own background all agree on the same dark navy.
  backgroundColor: '0x090b18',
  dom: {
    createContainer: true,
  },
  scene: [ LoginScene, LobbyScene, GameScene, ResultScene, DashboardScene ],
};

// The display/body webfonts (see public/index.html) may still be downloading
// when the game would otherwise start; Phaser Text measures/renders with
// whatever font is active at creation time and does not re-measure later,
// so starting before the fonts are ready would silently fall back to the
// system font for the entire session. `document.fonts.ready` resolves once
// every requested @font-face has loaded (or failed), so this is a short,
// bounded wait rather than an open-ended one, with a timeout fallback in
// case a font fails to load at all so the game never hangs on a bad network.
//
// That timeout is exactly the gap that let mismatched text through in
// practice (spotty venue wifi, per the preloader's own comment, easily
// exceeds 1.5s for a webfont fetch): if the timeout wins the race, every
// Text object created before the real webfont finishes loading is
// permanently stuck rendering in the fallback ('Malgun Gothic') -- Phaser
// draws text to a static canvas texture once and never re-measures it on
// its own. Since Black Han Sans is a deliberately heavy poster face and the
// fallback is comparatively thin, this read as "some labels are bold, some
// are thin" rather than a clean swap. Fixed with a one-time self-heal: once
// the real `document.fonts.ready` eventually resolves (immediately, if it
// already won the race), walk every currently active scene's display list
// and call `updateText()` on any Text object found -- forcing a re-render
// with whatever font is actually loaded by then. A single pass is enough:
// any scene created after this fires is created after fonts are genuinely
// ready, so its own Text objects are correct from the start.
//
// document.fonts.ready alone still isn't the whole story for a CJK webfont
// like Black Han Sans: Google serves it as dozens of files, each covering
// only a narrow unicode-range slice of the Hangul block, and a slice is
// only fetched once something actually asks to render a character inside
// it. Canvas text doesn't "ask" the way DOM layout does -- Phaser's first
// draw of a not-yet-fetched character just paints the fallback immediately
// (no waiting) and triggers the fetch in the background for next time, so
// `document.fonts.ready` can resolve having never even requested a slice
// nothing had drawn yet. That let individual characters (e.g. "별" in
// "1라운드 조별 현황") render in the fallback font even on a fast
// connection, independent of the timeout race above entirely. Explicitly
// loading FONT_DISPLAY_SAMPLE_TEXT (every fixed FONT_DISPLAY string used
// anywhere in the game -- see Theme.js) forces every slice those specific
// characters need to be requested upfront, before any scene draws them.
function refreshTextFonts(game) {
  const visit = (list) => {
    list.forEach((child) => {
      if (typeof child.updateText === 'function') {
        child.updateText();
      }
      if (child.list) {
        visit(child.list);
      }
    });
  };
  game.scene.getScenes(true).forEach((scene) => {
    if (scene.children && scene.children.list) {
      visit(scene.children.list);
    }
  });
}

function startGame() {
  const game = new Phaser.Game(config);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => refreshTextFonts(game));
  }
}

if (document.fonts && document.fonts.load) {
  // Sizes here don't need to match any real Text style -- document.fonts.load
  // only cares which characters need which unicode-range slice, not the
  // pixel size they'll eventually render at.
  document.fonts.load(`24px '${FONT_DISPLAY_FAMILY}'`, FONT_DISPLAY_SAMPLE_TEXT).catch(() => {});
  document.fonts.load(`16px '${FONT_BODY_FAMILY}'`, FONT_BODY_SAMPLE_TEXT).catch(() => {});
}

if (document.fonts && document.fonts.ready) {
  Promise.race([
    document.fonts.ready,
    new Promise((resolve) => setTimeout(resolve, 1500)),
  ]).then(startGame);
} else {
  startGame();
}
