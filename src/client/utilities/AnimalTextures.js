import Phaser from 'phaser';
import { getAnimalSpec } from '../../shared/animals';

const SIZE = 44;
const CENTER = SIZE / 2;

function darken(color, amount) {
  const c = Phaser.Display.Color.IntegerToColor(color);
  return Phaser.Display.Color.GetColor(
    Math.max(0, c.red - amount),
    Math.max(0, c.green - amount),
    Math.max(0, c.blue - amount)
  );
}

function drawEars(g, earShape, earColor) {
  g.fillStyle(earColor, 1);

  switch (earShape) {
    case 'round':
      g.fillCircle(CENTER - 13, CENTER - 14, 8);
      g.fillCircle(CENTER + 13, CENTER - 14, 8);
      break;
    case 'pointy':
      g.fillTriangle(CENTER - 19, CENTER - 8, CENTER - 7, CENTER - 8, CENTER - 14, CENTER - 23);
      g.fillTriangle(CENTER + 19, CENTER - 8, CENTER + 7, CENTER - 8, CENTER + 14, CENTER - 23);
      break;
    case 'long':
      g.fillEllipse(CENTER - 12, CENTER - 21, 8, 20);
      g.fillEllipse(CENTER + 12, CENTER - 21, 8, 20);
      break;
    case 'small':
      g.fillCircle(CENTER - 10, CENTER - 12, 4);
      g.fillCircle(CENTER + 10, CENTER - 12, 4);
      break;
    case 'big':
      g.fillCircle(CENTER - 15, CENTER - 15, 10);
      g.fillCircle(CENTER + 15, CENTER - 15, 10);
      break;
    default:
      break;
  }
}

function drawTinyStar(g, x, y, r) {
  const points = [];
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? r : r / 2.2;
    const angle = Phaser.Math.DegToRad(i * 36 - 90);
    points.push(new Phaser.Geom.Point(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius));
  }
  g.fillStyle(0x1a1a1a, 1);
  g.fillPoints(points, true);
}

function drawEyes(g, eyeShape) {
  switch (eyeShape) {
    case 'round':
      g.fillStyle(0x1a1a1a, 1);
      g.fillCircle(CENTER - 6, CENTER - 2, 3.2);
      g.fillCircle(CENTER + 6, CENTER - 2, 3.2);
      g.fillStyle(0xffffff, 0.9);
      g.fillCircle(CENTER - 5, CENTER - 3, 1);
      g.fillCircle(CENTER + 7, CENTER - 3, 1);
      break;
    case 'sleepy':
      g.lineStyle(1.6, 0x1a1a1a, 1);
      g.beginPath();
      g.arc(CENTER - 6, CENTER - 2, 3, Phaser.Math.DegToRad(200), Phaser.Math.DegToRad(340));
      g.strokePath();
      g.beginPath();
      g.arc(CENTER + 6, CENTER - 2, 3, Phaser.Math.DegToRad(200), Phaser.Math.DegToRad(340));
      g.strokePath();
      break;
    case 'wink':
      g.fillStyle(0x1a1a1a, 1);
      g.fillCircle(CENTER - 6, CENTER - 2, 2.2);
      g.lineStyle(1.6, 0x1a1a1a, 1);
      g.beginPath();
      g.arc(CENTER + 6, CENTER - 2, 3, Phaser.Math.DegToRad(200), Phaser.Math.DegToRad(340));
      g.strokePath();
      break;
    case 'star':
      drawTinyStar(g, CENTER - 6, CENTER - 2, 3);
      drawTinyStar(g, CENTER + 6, CENTER - 2, 3);
      break;
    case 'dot':
    default:
      g.fillStyle(0x1a1a1a, 1);
      g.fillCircle(CENTER - 6, CENTER - 2, 2.2);
      g.fillCircle(CENTER + 6, CENTER - 2, 2.2);
      break;
  }
}

function drawMouth(g, mouthShape) {
  g.lineStyle(1.6, 0x1a1a1a, 1);

  switch (mouthShape) {
    case 'open':
      g.fillStyle(0x8b3a3a, 1);
      g.fillEllipse(CENTER, CENTER + 9, 5, 4);
      break;
    case 'flat':
      g.beginPath();
      g.moveTo(CENTER - 4, CENTER + 8);
      g.lineTo(CENTER + 4, CENTER + 8);
      g.strokePath();
      break;
    case 'fang':
      g.beginPath();
      g.arc(CENTER, CENTER + 6, 4, Phaser.Math.DegToRad(20), Phaser.Math.DegToRad(160));
      g.strokePath();
      g.fillStyle(0xffffff, 1);
      g.fillTriangle(CENTER - 3, CENTER + 8, CENTER - 1, CENTER + 8, CENTER - 2, CENTER + 11);
      g.fillTriangle(CENTER + 3, CENTER + 8, CENTER + 1, CENTER + 8, CENTER + 2, CENTER + 11);
      break;
    case 'smile':
    default:
      g.beginPath();
      g.arc(CENTER, CENTER + 5, 4, Phaser.Math.DegToRad(20), Phaser.Math.DegToRad(160));
      g.strokePath();
      break;
  }
}

// A lion's mane radiates out from behind the head as a ring of soft, round
// puffs -- drawn before the head fill so the head circle (radius 15) covers
// each puff's inner half and only its outer curve shows, the same way real
// fur roots would be hidden under the skull. An earlier version drew this as
// a ring of sharp triangular spikes (a sunburst), which at this avatar's
// small size read as spiky/menacing rather than fluffy -- round puffs with
// no pointed tips anywhere read as fur regardless of scale. A later version
// alternated each puff's reach/radius for a "less mechanical" look, but at
// this size that read as lumpy/uneven rather than natural -- every puff is
// now the same size on the same ring, evenly spaced.
function drawMane(g, color) {
  const tuftCount = 14;
  const reach = 16;
  const radius = 4.5;
  g.fillStyle(color, 1);
  for (let i = 0; i < tuftCount; i++) {
    const angle = (Math.PI * 2 * i) / tuftCount;
    const x = CENTER + Math.cos(angle) * reach;
    const y = CENTER + Math.sin(angle) * reach;
    g.fillCircle(x, y, radius);
  }
}

// The base head+muzzle silhouette, keyed by species.headShape rather than
// every species sharing the same circle+oval -- see ANIMAL_SPECIES' own
// comment in animals.js for why this exists. 'round' reproduces the
// original single shape every species used to draw unconditionally.
// Returns whether a muzzle patch was drawn, so the caller knows whether the
// plain black nose dot still makes sense on top of it.
function drawHeadAndMuzzle(g, headShape, color, skipMuzzle) {
  g.fillStyle(color, 1);

  if (headShape === 'snout') {
    // Smaller, slightly raised skull with an elongated jaw below it -- reads
    // as a proper muzzle silhouette (crocodile/fox/tiger/horse/dog) instead
    // of the same round head as everything else. drawMouth()/the nose dot
    // below are shared, unparameterized code tuned for the *original* round
    // muzzle's center (CENTER + 6); an earlier version of this shape pushed
    // the muzzle down to CENTER + 10, which left every mouth shape floating
    // above the white patch instead of sitting on it. Keeping this jaw
    // anchored on the same CENTER + ~6-7 band (just stretched taller/wider
    // into a snout, not shifted to a new center) is what keeps mouths
    // landing correctly without needing to touch that shared code at all.
    g.fillCircle(CENTER, CENTER - 2, 13);
    g.fillEllipse(CENTER, CENTER + 7, 13, 12);
    if (!skipMuzzle) {
      g.fillStyle(0xffffff, 1);
      g.fillEllipse(CENTER, CENTER + 7, 11, 9);
    }
    return;
  }

  if (headShape === 'trunk') {
    // Slightly bigger head, no separate white muzzle patch -- the trunk
    // (drawn as this species' marker, after the nose/mouth pass) reads as
    // the face's main feature instead.
    g.fillCircle(CENTER, CENTER, 16);
    return;
  }

  // 'mane' still uses the plain round head/muzzle -- the mane itself is
  // drawn separately, before this, as its own ring around the outside.
  g.fillCircle(CENTER, CENTER, 15);
  if (!skipMuzzle) {
    g.fillStyle(0xffffff, 1);
    g.fillEllipse(CENTER, CENTER + 6, 15, 10);
  }
}

// Markers that need to render *underneath* the eyes (a patch of fur the
// eyes then sit on top of) rather than layered on last like every other
// species marker -- currently just panda's eye patches, which would
// otherwise paint straight over the eyes drawn after them.
function drawPreEyeMarker(g, speciesKey) {
  if (speciesKey === 'panda') {
    g.fillStyle(0x2a2a2a, 0.9);
    g.fillEllipse(CENTER - 6, CENTER - 3, 6.5, 8);
    g.fillEllipse(CENTER + 6, CENTER - 3, 6.5, 8);
  }
}

function drawSpeciesMarker(g, speciesKey, color) {
  const darkColor = darken(color, 60);
  const hornColor = 0xe8e0c8;

  switch (speciesKey) {
    case 'rat':
      g.lineStyle(1, 0x333333, 0.8);
      [-1, 1].forEach((side) => {
        for (let i = 0; i < 2; i++) {
          g.beginPath();
          g.moveTo(CENTER + side * 8, CENTER + 4 + i * 2);
          g.lineTo(CENTER + side * 16, CENTER + 1 + i * 3);
          g.strokePath();
        }
      });
      break;
    case 'ox':
      g.fillStyle(hornColor, 1);
      g.fillTriangle(CENTER - 10, CENTER - 18, CENTER - 4, CENTER - 18, CENTER - 8, CENTER - 26);
      g.fillTriangle(CENTER + 10, CENTER - 18, CENTER + 4, CENTER - 18, CENTER + 8, CENTER - 26);
      break;
    case 'tiger':
      g.lineStyle(2, darkColor, 0.85);
      g.beginPath(); g.moveTo(CENTER - 12, CENTER - 8); g.lineTo(CENTER - 6, CENTER - 11); g.strokePath();
      g.beginPath(); g.moveTo(CENTER + 12, CENTER - 8); g.lineTo(CENTER + 6, CENTER - 11); g.strokePath();
      g.beginPath(); g.moveTo(CENTER - 10, CENTER + 1); g.lineTo(CENTER - 4, CENTER - 1); g.strokePath();
      g.beginPath(); g.moveTo(CENTER + 10, CENTER + 1); g.lineTo(CENTER + 4, CENTER - 1); g.strokePath();
      break;
    case 'rabbit':
      g.fillStyle(0xffffff, 1);
      g.fillRect(CENTER - 3, CENTER + 7, 2.5, 4);
      g.fillRect(CENTER + 0.5, CENTER + 7, 2.5, 4);
      break;
    case 'dragon':
      // Bigger horn, a matching back-spike, and a forked tongue -- the
      // original version was a single small horn easy to mistake for the
      // ox's, since both still shared the exact same round head.
      g.fillStyle(0xffe066, 1);
      g.fillTriangle(CENTER - 4, CENTER - 17, CENTER + 4, CENTER - 17, CENTER, CENTER - 27);
      g.fillTriangle(CENTER + 9, CENTER - 13, CENTER + 14, CENTER - 13, CENTER + 11, CENTER - 20);
      g.fillStyle(darkColor, 0.7);
      g.fillCircle(CENTER - 11, CENTER + 2, 1.4);
      g.fillCircle(CENTER + 11, CENTER + 2, 1.4);
      g.fillStyle(0xff3355, 1);
      g.fillTriangle(CENTER - 2, CENTER + 10, CENTER + 2, CENTER + 10, CENTER - 3, CENTER + 15);
      g.fillTriangle(CENTER - 2, CENTER + 10, CENTER + 2, CENTER + 10, CENTER + 3, CENTER + 15);
      break;
    case 'snake':
      g.fillStyle(0xff3355, 1);
      g.fillTriangle(CENTER - 1.5, CENTER + 9, CENTER + 1.5, CENTER + 9, CENTER - 2.5, CENTER + 14);
      g.fillTriangle(CENTER - 1.5, CENTER + 9, CENTER + 1.5, CENTER + 9, CENTER + 2.5, CENTER + 14);
      break;
    case 'horse':
      g.fillStyle(darkColor, 1);
      for (let i = -1; i <= 1; i++) {
        g.fillTriangle(
          CENTER + i * 4 - 2, CENTER - 15,
          CENTER + i * 4 + 2, CENTER - 15,
          CENTER + i * 4, CENTER - 24
        );
      }
      break;
    case 'goat':
      g.fillStyle(hornColor, 1);
      g.fillCircle(CENTER - 8, CENTER - 20, 3);
      g.fillCircle(CENTER + 8, CENTER - 20, 3);
      g.fillTriangle(CENTER - 3, CENTER + 12, CENTER + 3, CENTER + 12, CENTER, CENTER + 18);
      break;
    case 'monkey':
      g.fillStyle(0xffe4c4, 0.9);
      g.fillEllipse(CENTER, CENTER + 4, 20, 16);
      break;
    case 'rooster':
      g.fillStyle(0xff3355, 1);
      g.fillTriangle(CENTER - 6, CENTER - 15, CENTER - 1, CENTER - 15, CENTER - 3.5, CENTER - 23);
      g.fillTriangle(CENTER, CENTER - 16, CENTER + 5, CENTER - 16, CENTER + 2.5, CENTER - 24);
      g.fillStyle(0xff9900, 1);
      g.fillTriangle(CENTER - 2, CENTER + 5, CENTER + 2, CENTER + 5, CENTER, CENTER + 9);
      break;
    case 'dog':
      g.fillStyle(darken(color, 30), 0.85);
      g.fillEllipse(CENTER + 10, CENTER + 3, 8, 10);
      break;
    case 'pig':
      g.fillStyle(0xffc0cb, 1);
      g.fillEllipse(CENTER, CENTER + 7, 11, 8);
      g.fillStyle(0x8b5a6b, 1);
      g.fillCircle(CENTER - 2.5, CENTER + 7, 1);
      g.fillCircle(CENTER + 2.5, CENTER + 7, 1);
      break;
    case 'crocodile':
      g.fillStyle(0xffffff, 1);
      [-1, 1].forEach((side) => {
        g.fillTriangle(
          CENTER + side * 4, CENTER + 8,
          CENTER + side * 4 + side * 2.5, CENTER + 8,
          CENTER + side * 5, CENTER + 12
        );
      });
      g.fillStyle(darken(color, 45), 0.7);
      g.fillCircle(CENTER - 9, CENTER - 8, 1.3);
      g.fillCircle(CENTER + 9, CENTER - 8, 1.3);
      g.fillCircle(CENTER, CENTER - 12, 1.3);
      break;
    case 'lion':
      // The mane itself is the headShape ring drawn before the head fill —
      // this is just a small chin tuft to finish the silhouette below it.
      g.fillStyle(darken(color, 15), 1);
      g.fillTriangle(CENTER - 3, CENTER + 12, CENTER + 3, CENTER + 12, CENTER, CENTER + 17);
      break;
    case 'bear':
      g.fillStyle(darken(color, 35), 1);
      g.fillCircle(CENTER, CENTER + 8, 3);
      break;
    case 'fox':
      g.fillStyle(0xffffff, 1);
      g.fillTriangle(CENTER - 13, CENTER - 16, CENTER - 7, CENTER - 16, CENTER - 10, CENTER - 9);
      g.fillTriangle(CENTER + 13, CENTER - 16, CENTER + 7, CENTER - 16, CENTER + 10, CENTER - 9);
      g.fillStyle(darken(color, 30), 1);
      g.fillCircle(CENTER, CENTER + 11, 1.6);
      break;
    case 'cat':
      g.lineStyle(1, 0x333333, 0.7);
      [-1, 1].forEach((side) => {
        for (let i = 0; i < 2; i++) {
          g.beginPath();
          g.moveTo(CENTER + side * 7, CENTER + 7 + i * 2);
          g.lineTo(CENTER + side * 15, CENTER + 5 + i * 3);
          g.strokePath();
        }
      });
      break;
    case 'panda':
      // Eye patches are drawn earlier, underneath the eyes -- see
      // drawPreEyeMarker(). Nothing further needed here.
      break;
    case 'elephant':
      g.fillStyle(color, 1);
      g.fillEllipse(CENTER, CENTER + 13, 5, 9);
      g.fillStyle(darken(color, 20), 1);
      g.fillEllipse(CENTER + 1, CENTER + 19, 4, 4);
      break;
    default:
      break;
  }
}

function drawAnimalFace(g, spec) {
  const { species, color, earShape, eyeShape, mouthShape } = spec;
  const earColor = darken(color, 40);
  const headShape = species.headShape || 'round';
  // pig/elephant draw their own snout/trunk in drawSpeciesMarker instead of
  // the plain white muzzle oval every other species gets.
  const skipMuzzle = species.key === 'pig' || headShape === 'trunk';

  if (headShape === 'mane') {
    drawMane(g, darken(color, 20));
  }

  drawEars(g, earShape, earColor);

  drawHeadAndMuzzle(g, headShape, color, skipMuzzle);

  drawPreEyeMarker(g, species.key);

  // blush
  g.fillStyle(0xff9aa2, 0.6);
  g.fillCircle(CENTER - 11, CENTER + 3, 3);
  g.fillCircle(CENTER + 11, CENTER + 3, 3);

  drawEyes(g, eyeShape);

  // nose (rooster/pig/elephant get their own beak/snout/trunk markers instead)
  if (species.key !== 'rooster' && species.key !== 'pig' && species.key !== 'elephant') {
    g.fillStyle(0x1a1a1a, 1);
    g.fillCircle(CENTER, CENTER + 4, 2);
  }

  drawMouth(g, mouthShape);
  drawSpeciesMarker(g, species.key, color);
}

export function ensureAnimalTexture(scene, index) {
  const key = `animal_${index}`;
  if (scene.textures.exists(key)) {
    return key;
  }

  const graphics = scene.add.graphics();
  drawAnimalFace(graphics, getAnimalSpec(index));
  graphics.generateTexture(key, SIZE, SIZE);
  graphics.destroy();

  return key;
}
