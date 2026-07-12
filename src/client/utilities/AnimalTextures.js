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

function drawSpeciesMarker(g, zodiacKey, color) {
  const darkColor = darken(color, 60);
  const hornColor = 0xe8e0c8;

  switch (zodiacKey) {
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
      g.fillStyle(0xffe066, 1);
      g.fillTriangle(CENTER - 3, CENTER - 17, CENTER + 3, CENTER - 17, CENTER, CENTER - 25);
      g.fillStyle(darkColor, 0.7);
      g.fillCircle(CENTER - 11, CENTER + 2, 1.4);
      g.fillCircle(CENTER + 11, CENTER + 2, 1.4);
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
    default:
      break;
  }
}

function drawAnimalFace(g, spec) {
  const { zodiac, color, earShape, eyeShape, mouthShape } = spec;
  const earColor = darken(color, 40);

  drawEars(g, earShape, earColor);

  // head
  g.fillStyle(color, 1);
  g.fillCircle(CENTER, CENTER, 15);

  // muzzle (the pig marker draws its own snout instead)
  if (zodiac.key !== 'pig') {
    g.fillStyle(0xffffff, 1);
    g.fillEllipse(CENTER, CENTER + 6, 15, 10);
  }

  // blush
  g.fillStyle(0xff9aa2, 0.6);
  g.fillCircle(CENTER - 11, CENTER + 3, 3);
  g.fillCircle(CENTER + 11, CENTER + 3, 3);

  drawEyes(g, eyeShape);

  // nose (rooster/pig get their own beak/snout markers instead)
  if (zodiac.key !== 'rooster' && zodiac.key !== 'pig') {
    g.fillStyle(0x1a1a1a, 1);
    g.fillCircle(CENTER, CENTER + 4, 2);
  }

  drawMouth(g, mouthShape);
  drawSpeciesMarker(g, zodiac.key, color);
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
