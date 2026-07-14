import Phaser from 'phaser';
import GameScene from './scenes/GameScene';
import LoginScene from './scenes/LoginScene';
import LobbyScene from './scenes/LobbyScene';
import ResultScene from './scenes/ResultScene';
import DashboardScene from './scenes/DashboardScene';
import { WORLD_WIDTH, WORLD_HEIGHT } from '../shared/hexGrid';

// Every Text object in this game renders soft gradients, hex bevels, and
// stroked labels — none of it is pixel-art sprite work — so the internal
// canvas texture should be created at a higher pixel density than the
// design resolution (732x644) it's laid out at. Phaser's Text/TextStyle
// defaults `resolution` to 0 ("inherit the Game Config's resolution",
// which itself defaults to 1), producing soft/aliased edges once the small
// design canvas is scaled up by Scale.FIT to fill an actual screen. This
// patches the shared TextStyle default once, before any scene creates a
// Text object, so every screen benefits without touching 30+ call sites.
const TEXT_RESOLUTION = Math.min(window.devicePixelRatio || 1, 3);
const originalSetStyle = Phaser.GameObjects.Components.TextStyle.prototype.setStyle;
Phaser.GameObjects.Components.TextStyle.prototype.setStyle = function setStyleWithResolution(style, updateText, setDefaults) {
  const merged = Object.assign({ resolution: TEXT_RESOLUTION }, style);
  return originalSetStyle.call(this, merged, updateText, setDefaults);
};

const config = {
  title:    'Phaser 3 Multiplayer Game',
  version:  '0.0.1',
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
    // Renders the internal drawing buffer at device pixel density so
    // hex bevels, gradients, and (combined with the TextStyle patch above)
    // text all stay sharp on high-DPI screens instead of just the CSS
    // canvas being stretched.
    resolution: Math.min(window.devicePixelRatio || 1, 2),
  },
  backgroundColor: '0x000000',
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
