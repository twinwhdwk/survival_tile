// navigator.vibrate is Android-Chrome-family only — iOS Safari has never
// implemented the Vibration API at all, and will simply not have the
// function present. Guarding on that means every call below is already
// safe to make unconditionally from anywhere without knowing the platform.
function vibrate(pattern) {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    navigator.vibrate(pattern);
  }
}

export function vibrateTap() {
  vibrate(10);
}

export function vibrateWarning() {
  vibrate(20);
}

export function vibrateEliminate() {
  vibrate([40, 60, 80]);
}

export function vibrateBossHit() {
  vibrate(25);
}

export function vibrateVictory() {
  vibrate([60, 40, 60, 40, 120]);
}

// A building rumble rather than one flat buzz, for the boss's tile-shatter
// skill — meant to land as "the boss just did something big," distinct
// from the single short tap of vibrateBossHit().
export function vibrateBossSkill() {
  vibrate([50, 30, 50, 30, 200]);
}
