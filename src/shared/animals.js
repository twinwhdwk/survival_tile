// headShape controls the base silhouette drawn in AnimalTextures.js, not
// just a small ornament on an identical head -- without it, every species
// shared the exact same circle head + oval muzzle and only differed by a
// tiny marker (horns, whiskers, stripes...), which read as "the same face
// with slightly different ears" rather than genuinely different animals.
// 'round' is the original look (kept for every original zodiac entry so
// they render unchanged); 'snout' gives a longer jaw (predators/long-faced
// animals), 'mane' draws a radiating mane behind the head (lion), 'trunk'
// swaps the muzzle for an elephant's trunk.
export const ANIMAL_SPECIES = [
  { key: 'rat', label: '쥐', headShape: 'round' },
  { key: 'ox', label: '소', headShape: 'round' },
  { key: 'tiger', label: '호랑이', headShape: 'snout' },
  { key: 'rabbit', label: '토끼', headShape: 'round' },
  { key: 'dragon', label: '용', headShape: 'round' },
  { key: 'snake', label: '뱀', headShape: 'round' },
  { key: 'horse', label: '말', headShape: 'snout' },
  { key: 'goat', label: '양', headShape: 'round' },
  { key: 'monkey', label: '원숭이', headShape: 'round' },
  { key: 'rooster', label: '닭', headShape: 'round' },
  { key: 'dog', label: '개', headShape: 'snout' },
  { key: 'pig', label: '돼지', headShape: 'round' },
  { key: 'crocodile', label: '악어', headShape: 'snout' },
  { key: 'lion', label: '사자', headShape: 'mane' },
  { key: 'bear', label: '곰', headShape: 'round' },
  { key: 'fox', label: '여우', headShape: 'snout' },
  { key: 'cat', label: '고양이', headShape: 'round' },
  { key: 'panda', label: '판다', headShape: 'round' },
  { key: 'elephant', label: '코끼리', headShape: 'trunk' },
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
  0x6b8e23, // olive green (crocodile/dragon)
  0xff7f50, // coral (fantasy/fox)
];

// Every character is one of ANIMAL_SPECIES, randomly combined with a body
// color, ear shape, eye shape, and mouth shape. The index encodes all five
// dimensions, so ANIMAL_COUNT is their product rather than a flat list —
// callers must generate textures lazily (one per actually-used index) rather
// than pre-generating the whole space.
export const ANIMAL_COUNT =
  ANIMAL_SPECIES.length * BODY_COLORS.length * EAR_SHAPES.length * EYE_SHAPES.length * MOUTH_SHAPES.length;

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

  const species = ANIMAL_SPECIES[remainder % ANIMAL_SPECIES.length];

  return { species, color, earShape, eyeShape, mouthShape };
}
