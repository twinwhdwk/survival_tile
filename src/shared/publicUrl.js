// The short, memorable Firebase Hosting URL players should be told to visit.
// Firebase Hosting does a plain HTTP *redirect* to the real Cloud Run origin
// (see CLAUDE.md "Short URL" section) rather than proxying, so once a client
// has loaded the page, `window.location.origin` reflects the long `*.run.app`
// Cloud Run URL, not this one. Any on-screen "참가 주소" display should use
// this constant instead of `window.location.origin` so it always matches the
// address that was actually shared with participants.
export const PUBLIC_SITE_URL = 'https://fil2.web.app';
