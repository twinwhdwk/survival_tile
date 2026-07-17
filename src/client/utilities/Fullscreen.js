// Fullscreen must be requested synchronously inside an active user
// gesture -- so this is called from LoginScene.submit(), right next to
// unlockAudio(), the very first tap in the whole app. This is the actual
// fix for Android Chrome's address bar staying pinned on a fixed,
// non-scrolling game page: the old "wait a second, then scrollTo(0, 1)"
// trick only ever collapsed the bar in response to a real touch-scroll,
// and stopped working once Chrome moved that behavior to the compositor
// thread -- a timer alone can't trigger it anymore. True Fullscreen hides
// the address bar (and the nav bar) directly, no scroll involved.
export function requestFullscreenIfPossible() {
  const el = document.documentElement;
  const request = el.requestFullscreen
    || el.webkitRequestFullscreen
    || el.mozRequestFullScreen
    || el.msRequestFullscreen;
  if (!request) {
    return;
  }
  try {
    // Silently a no-op wherever it's unsupported (iOS Safari only allows
    // this on <video>/<audio> elements) or the browser rejects it --
    // fullscreen is a nice-to-have polish, never worth blocking or
    // erroring the actual join flow over.
    const result = request.call(el);
    if (result && typeof result.catch === 'function') {
      result.catch(() => {});
    }
  } catch (err) {
    // ignore
  }
}
