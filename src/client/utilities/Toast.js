import { FONT_BODY } from '../theme/Theme';

// Plain DOM overlay (not a Phaser GameObject/add.dom()) -- pinned to the
// real viewport with position:fixed so it shows correctly regardless of
// which scene is active or how Phaser.Scale.FIT has letterboxed the
// canvas, same reasoning as the joystick (see GameScene.createJoystick())
// and the reconnect banner (net/socket.js). A brief, self-dismissing
// confirmation for actions (like 서버 초기화) that otherwise give the
// admin who triggered them zero visible feedback when nothing else on
// screen happens to change.
export function showToast(message) {
  const el = document.createElement('div');
  el.textContent = message;
  el.style.cssText = [
    'position:fixed', 'top:16px', 'left:50%',
    'transform:translate(-50%,-140%)',
    'background:#1c130df0', 'color:#ffd9a0',
    'border:1px solid #ffa94d88',
    `font-family:${FONT_BODY}`, 'font-size:14px', 'font-weight:600',
    'padding:10px 20px', 'border-radius:10px',
    'z-index:9998', 'pointer-events:none',
    'transition:transform 0.3s ease',
    'box-shadow:0 4px 14px rgba(0,0,0,0.4)',
  ].join(';');
  document.body.appendChild(el);

  requestAnimationFrame(() => {
    el.style.transform = 'translate(-50%,0)';
  });

  setTimeout(() => {
    el.style.transform = 'translate(-50%,-140%)';
    setTimeout(() => el.remove(), 350);
  }, 2200);
}
