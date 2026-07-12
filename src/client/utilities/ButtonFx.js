import { playClick } from './SoundFx';
import { vibrateTap } from './Haptics';

export function applyButtonFx(button) {
  if (!button) {
    return;
  }

  button.style.transition = 'transform 0.15s ease, filter 0.15s ease, box-shadow 0.15s ease';
  button.style.boxShadow = '0 2px 0 rgba(0,0,0,0.35)';

  button.addEventListener('mouseenter', () => {
    if (button.disabled) {
      return;
    }
    button.style.filter = 'brightness(1.12)';
    button.style.transform = 'translateY(-2px)';
    button.style.boxShadow = '0 4px 8px rgba(0,0,0,0.4)';
  });

  button.addEventListener('mouseleave', () => {
    button.style.filter = 'none';
    button.style.transform = 'translateY(0)';
    button.style.boxShadow = '0 2px 0 rgba(0,0,0,0.35)';
  });

  button.addEventListener('mousedown', () => {
    if (button.disabled) {
      return;
    }
    button.style.transform = 'translateY(1px) scale(0.97)';
  });

  button.addEventListener('mouseup', () => {
    if (button.disabled) {
      return;
    }
    button.style.transform = 'translateY(-2px)';
  });

  // One shared spot for click feedback so every button in the app (login,
  // lobby, result) gets consistent audio/haptics for free rather than each
  // scene wiring its own.
  button.addEventListener('click', () => {
    if (button.disabled) {
      return;
    }
    playClick();
    vibrateTap();
  });
}
