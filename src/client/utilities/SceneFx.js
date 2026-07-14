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
