export const ZODIAC_ANIMALS = [
  { key: 'rat', label: '쥐' },
  { key: 'ox', label: '소' },
  { key: 'tiger', label: '호랑이' },
  { key: 'rabbit', label: '토끼' },
  { key: 'dragon', label: '용' },
  { key: 'snake', label: '뱀' },
  { key: 'horse', label: '말' },
  { key: 'goat', label: '양' },
  { key: 'monkey', label: '원숭이' },
  { key: 'rooster', label: '닭' },
  { key: 'dog', label: '개' },
  { key: 'pig', label: '돼지' },
];

export const EAR_SHAPES = ['round', 'pointy', 'long', 'small', 'big'];
export const EYE_SHAPES = ['dot', 'round', 'sleepy', 'wink', 'star'];
export const MOUTH_SHAPES = ['smile', 'open', 'flat', 'fang'];

export const BODY_COLORS = [
  0xf4a460, // sandy orange (fox/cat)
  0x8b5a2b, // brown (bear/dog)
  0xffffff, // white (bunny/panda)
  0xffc0cb, // pink (pig)
  0x9e9e9e, // gray (mouse/koala)
  0xffd700, // gold (lion/chick)
  0x9370db, // purple (fantasy)
  0x87ceeb, // sky blue (fantasy)
];

// Every character is one of the 12 zodiac animals, randomly combined with a
// body color, ear shape, eye shape, and mouth shape. The index encodes all
// five dimensions, so ANIMAL_COUNT is their product rather than a flat list —
// callers must generate textures lazily (one per actually-used index) rather
// than pre-generating the whole space.
export const ANIMAL_COUNT =
  ZODIAC_ANIMALS.length * BODY_COLORS.length * EAR_SHAPES.length * EYE_SHAPES.length * MOUTH_SHAPES.length;

export function getAnimalSpec(index) {
  const safeIndex = ((index % ANIMAL_COUNT) + ANIMAL_COUNT) % ANIMAL_COUNT;
  let remainder = safeIndex;

  const mouthShape = MOUTH_SHAPES[remainder % MOUTH_SHAPES.length];
  remainder = Math.floor(remainder / MOUTH_SHAPES.length);

  const eyeShape = EYE_SHAPES[remainder % EYE_SHAPES.length];
  remainder = Math.floor(remainder / EYE_SHAPES.length);

  const earShape = EAR_SHAPES[remainder % EAR_SHAPES.length];
  remainder = Math.floor(remainder / EAR_SHAPES.length);

  const color = BODY_COLORS[remainder % BODY_COLORS.length];
  remainder = Math.floor(remainder / BODY_COLORS.length);

  const zodiac = ZODIAC_ANIMALS[remainder % ZODIAC_ANIMALS.length];

  return { zodiac, color, earShape, eyeShape, mouthShape };
}
