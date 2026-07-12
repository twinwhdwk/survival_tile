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
