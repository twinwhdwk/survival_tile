// Every effect here is a synthesized Web Audio tone/noise burst, not a
// loaded audio file — same "no external assets" approach already used for
// textures (EffectTextures.js, AnimalTextures.js), so there's nothing to
// bundle, license, or fail to load.

let ctx = null;
let unlocked = false;

function getContext() {
  if (!ctx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      return null;
    }
    ctx = new AudioContextClass();
  }
  return ctx;
}

// Mobile browsers (and desktop Chrome's autoplay policy) refuse to produce
// sound from an AudioContext until it's resumed inside a real user gesture
// handler. Call this once, from the very first click in the app (the login
// screen's submit button), and every later scene's sounds just work with no
// further gesture needed — the context is a module-level singleton.
export function unlockAudio() {
  const audioCtx = getContext();
  if (!audioCtx || unlocked) {
    return;
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  unlocked = true;
}

function tone(freq, duration, { type = 'sine', volume = 0.2, delay = 0, endFreq = null } = {}) {
  const audioCtx = getContext();
  if (!audioCtx) {
    return;
  }
  const now = audioCtx.currentTime + delay;

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  if (endFreq) {
    osc.frequency.exponentialRampToValueAtTime(endFreq, now + duration);
  }

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(volume, now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  osc.connect(gain).connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + duration + 0.03);
}

function noiseBurst(duration, { volume = 0.2, delay = 0, filterFreq = 1200 } = {}) {
  const audioCtx = getContext();
  if (!audioCtx) {
    return;
  }
  const now = audioCtx.currentTime + delay;

  const bufferSize = Math.max(1, Math.floor(audioCtx.sampleRate * duration));
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
  }

  const noise = audioCtx.createBufferSource();
  noise.buffer = buffer;

  const filter = audioCtx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = filterFreq;

  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(volume, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  noise.connect(filter).connect(gain).connect(audioCtx.destination);
  noise.start(now);
}

// A burst of simultaneous tile collapses (a boundary ring burning, several
// bots stepping at once) would otherwise spawn one oscillator/buffer graph
// per tile within the same tick — throttling the frequent, low-stakes
// effects to one play per short window keeps that from piling up into
// stutter, while rarer/important effects (elimination, victory) stay
// unthrottled since they're never spammy on their own.
function throttle(fn, minIntervalMs) {
  let last = 0;
  return (...args) => {
    const now = Date.now();
    if (now - last < minIntervalMs) {
      return;
    }
    last = now;
    fn(...args);
  };
}

export const playClick = () => tone(520, 0.05, { type: 'square', volume: 0.08 });

// A short descending two-note buzz for a rejected action (bad password, join
// refused, empty nickname) -- every other significant feedback moment in the
// app already has a matching sound, but a rejected join previously had only
// the visual shake+red text, silent on speaker-off-by-default mobile joins.
export const playError = () => {
  tone(220, 0.1, { type: 'square', volume: 0.1 });
  tone(160, 0.14, { type: 'square', volume: 0.1, delay: 0.08 });
};

export const playWarning = throttle(() => tone(660, 0.09, { type: 'triangle', volume: 0.1 }), 90);

export const playCollapse = throttle(() => {
  noiseBurst(0.26, { volume: 0.2, filterFreq: 900 });
  tone(90, 0.18, { type: 'sine', volume: 0.14, endFreq: 40 });
}, 70);

export const playRevive = throttle(() => {
  tone(440, 0.12, { type: 'sine', volume: 0.14 });
  tone(660, 0.16, { type: 'sine', volume: 0.12, delay: 0.06 });
}, 70);

export function playEliminate() {
  tone(300, 0.35, { type: 'sawtooth', volume: 0.16, endFreq: 80 });
}

export function playOtherEliminate() {
  tone(220, 0.15, { type: 'triangle', volume: 0.07, endFreq: 120 });
}

export function playBoundaryAlarm() {
  tone(880, 0.14, { type: 'sawtooth', volume: 0.09, delay: 0 });
  tone(880, 0.14, { type: 'sawtooth', volume: 0.09, delay: 0.18 });
}

export function playCountdownTick(urgent) {
  tone(urgent ? 880 : 660, 0.08, { type: 'sine', volume: 0.1 });
}

export function playCountdownGo() {
  tone(523, 0.1, { type: 'sine', volume: 0.18 });
  tone(784, 0.22, { type: 'sine', volume: 0.18, delay: 0.09 });
}

export function playVictory() {
  [523, 659, 784, 1046, 1318].forEach((freq, i) => tone(freq, 0.28, { type: 'sine', volume: 0.15, delay: i * 0.11 }));
}
