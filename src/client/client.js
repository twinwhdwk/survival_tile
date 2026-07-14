import Phaser from 'phaser';
import GameScene from './scenes/GameScene';
import LoginScene from './scenes/LoginScene';
import LobbyScene from './scenes/LobbyScene';
import ResultScene from './scenes/ResultScene';
import DashboardScene from './scenes/DashboardScene';
import { WORLD_WIDTH, WORLD_HEIGHT } from '../shared/hexGrid';

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
    // Renders the internal drawing buffer at device pixel density so hex
    // bevels, gradients, and text all stay sharp on high-DPI screens
    // instead of just the CSS canvas being stretched. Text objects default
    // their own `resolution` to 0 ("inherit the Game Config's resolution"
    // — see Phaser.GameObjects.TextStyle's own docs), so this one setting
    // is enough on its own; no per-TextStyle override is needed.
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
function startGame() {
  new Phaser.Game(config);
}

if (document.fonts && document.fonts.ready) {
  Promise.race([
    document.fonts.ready,
    new Promise((resolve) => setTimeout(resolve, 1500)),
  ]).then(startGame);
} else {
  startGame();
}
