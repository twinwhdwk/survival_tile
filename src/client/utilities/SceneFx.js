import Phaser from 'phaser';

import { WORLD_WIDTH, WORLD_HEIGHT } from '../../shared/hexGrid';

// Shared ambient-mood effects reused across every pre/post-round scene
// (LoginScene, LobbyScene, DashboardScene, ResultScene) so the "burning
// boundary" theme carries through the whole flow consistently. These used
// to be copy-pasted verbatim into each scene, which meant a tweak to one
// (e.g. ember color/timing) silently didn't apply to the others unless
// someone remembered to update every copy — pulling them out here means
// there's exactly one place to change.

// Faint embers rising in the background, from the bottom of the screen up.
export function createAmbientEmbers(scene) {
  scene.add.particles('particle_spark').setDepth(-15).createEmitter({
    x: { min: 0, max: WORLD_WIDTH },
    y: WORLD_HEIGHT + 10,
    speedY: { min: -14, max: -6 },
    speedX: { min: -4, max: 4 },
    lifespan: { min: 5000, max: 8000 },
    scale: { start: 0.5, end: 0.1 },
    alpha: { start: 0.22, end: 0 },
    tint: [0xff8844, 0xff5533, 0xffcc55],
    frequency: 350,
    quantity: 1,
  });
}

// Recursive rather than a yoyo/repeat tween so each step lands on a fresh
// random alpha/scale/duration — a real flame jitters unevenly rather than
// breathing on a steady sine wave. `glow` is the additive-blended title
// text object sitting behind each scene's solid title text.
export function flickerTitleGlow(scene, glow) {
  const step = () => {
    scene.tweens.add({
      targets: glow,
      alpha: Phaser.Math.FloatBetween(0.25, 0.6),
      scale: Phaser.Math.FloatBetween(1.02, 1.16),
      duration: Phaser.Math.Between(90, 220),
      ease: 'Sine.easeInOut',
      onComplete: step,
    });
  };
  step();
}
