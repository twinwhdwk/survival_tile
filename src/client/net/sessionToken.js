// A stable per-browser identity that survives the page reload a reconnect
// triggers (see net/socket.js). socket.id changes on every reconnect, so it
// can't be what the server matches a returning player against — this token
// can. Stored in sessionStorage (not localStorage) so it lives exactly as
// long as the tab does: a genuine "new visit" in a fresh tab gets a fresh
// identity, but the reload we do on reconnect keeps the same one, which is
// exactly the lifetime a mid-round reclaim needs.
//
// sessionStorage can be unavailable (private-mode quirks, storage disabled),
// so this falls back to an in-memory value — reconnect reclaim then won't
// survive a reload for that user, but nothing breaks; they just get the
// normal disconnect behavior.
const STORAGE_KEY = 'survivalTileSessionToken';

let cachedToken = null;

function randomToken() {
  return `st_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function getSessionToken() {
  if (cachedToken) {
    return cachedToken;
  }
  try {
    let token = window.sessionStorage.getItem(STORAGE_KEY);
    if (!token) {
      token = randomToken();
      window.sessionStorage.setItem(STORAGE_KEY, token);
    }
    cachedToken = token;
  } catch (e) {
    // sessionStorage unavailable — fall back to a memory-only token.
    cachedToken = randomToken();
  }
  return cachedToken;
}
