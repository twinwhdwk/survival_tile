import SocketIO from 'socket.io-client';
import { FONT_BODY } from '../theme/Theme';
import { showToast } from '../utilities/Toast';

let socket = null;
let statusEl = null;

// A dropped WiFi connection or a server restart previously left the game
// looking frozen with zero feedback. This is a plain DOM overlay (not a
// Phaser scene) so it works no matter which scene is active.
function ensureStatusEl() {
  if (statusEl) {
    return statusEl;
  }

  const style = document.createElement('style');
  style.textContent = '@keyframes reconnectShimmer { 0% { background-position: 0% 0; } 100% { background-position: 200% 0; } }';
  document.head.appendChild(style);

  statusEl = document.createElement('div');
  statusEl.textContent = '연결이 끊겼습니다. 재접속 중...';
  statusEl.style.cssText = [
    'position:fixed', 'top:0', 'left:0', 'right:0',
    'background:linear-gradient(90deg,#ff5555,#ff9955,#ff5555)',
    'background-size:200% 100%',
    'animation:reconnectShimmer 1.5s linear infinite',
    'color:#ffffff', 'text-align:center',
    `font-family:${FONT_BODY}`, 'font-size:14px', 'font-weight:600',
    'padding:10px', 'z-index:9999',
    'transform:translateY(-100%)',
    'transition:transform 0.35s ease',
    'box-shadow:0 2px 10px rgba(0,0,0,0.4)',
  ].join(';');
  document.body.appendChild(statusEl);
  return statusEl;
}

export function getSocket() {
  if (!socket) {
    socket = new SocketIO();
    const el = ensureStatusEl();
    let hadDisconnected = false;

    // A dropped mid-game connection isn't the only way this banner earns
    // its keep -- if the very first connection attempt fails (server
    // cold-starting, briefly unreachable), 'disconnect' never fires at all
    // (there was nothing connected yet to disconnect from), so a player
    // loading the page during that window saw a perfectly normal-looking
    // login form with zero indication anything was wrong; clicking 참가하기
    // would just hang on "참가하는 중..." forever once join() went out over
    // a socket that was never actually connected. Reuses the same banner
    // (socket.io v2 keeps retrying connect_error attempts on its own by
    // default, same as it does for 'disconnect') rather than a second,
    // separate one.
    socket.on('connect_error', () => {
      el.style.transform = 'translateY(0)';
    });

    socket.on('disconnect', (reason) => {
      hadDisconnected = true;
      el.style.transform = 'translateY(0)';

      // Socket.io v2 deliberately does NOT auto-reconnect when the
      // *server* initiated the disconnect (reason 'io server disconnect')
      // -- that's what a forced kick (e.g. the admin's 초기화/clearLobby
      // reset) uses server-side. Without this, a kicked client's banner
      // would sit on "재접속 중..." forever since nothing ever retries the
      // connection for it to reload on.
      if (reason === 'io server disconnect') {
        socket.connect();
      }
    });
    socket.on('connect', () => {
      el.style.transform = 'translateY(-100%)';

      // A reconnect gets a brand new socket.id — the server no longer
      // recognizes it as the player it was mid-game, so whichever scene
      // was active is now stuck talking to a room/lobby entry that's gone.
      // Reload for a clean slate instead of leaving that scene silently
      // dead with the banner hidden (which would look like everything's
      // fine).
      if (hadDisconnected) {
        window.location.reload();
      }
    });

    // A backgrounded mobile tab can have its WebSocket silently killed by
    // the OS/browser without the 'disconnect'/'connect' handlers above ever
    // getting a chance to run -- both need the JS event loop actually
    // executing, which a backgrounded tab may not get for minutes at a
    // time. Without this, picking the phone back up just showed whatever
    // scene was frozen on screen when it went to sleep, with no indication
    // anything was wrong, and the only fix was manually pulling to refresh.
    // Reloading the instant the tab comes back to the foreground and finds
    // itself disconnected does that automatically.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !socket.connected) {
        window.location.reload();
      }
    });

    // resetServerState() (server.js) deliberately never disconnects the
    // admin who triggered it, and its lobby broadcast only visibly changes
    // anything for them if the lobby wasn't already empty -- meaning a
    // reset against an already-quiet lobby produced literally zero on-
    // screen feedback, reported in practice as the button "doing nothing".
    // Wired globally here (not per-scene) since resetServer often also
    // triggers an immediate scene transition (DashboardScene ->
    // ResultScene via 'tournamentEnded') that would tear down a per-scene
    // listener before this event -- emitted right alongside, same tick --
    // ever reached it.
    socket.on('resetServerDone', () => showToast('서버가 초기화되었습니다'));
  }
  return socket;
}
