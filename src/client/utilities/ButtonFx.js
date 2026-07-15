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

  // A button going disabled while the mouse is still sitting over it (e.g.
  // clicking 참가하기 -- the cursor hasn't moved away yet -- or an admin
  // hovering 게임 시작 exactly as a tournament-phase broadcast disables it)
  // is a real, reachable case, not just a rare edge case: mouseenter above
  // already applied an *inline* filter/transform, and inline styles always
  // beat the stylesheet's `button:disabled { filter: grayscale(...) }` rule
  // for that same property regardless of the disabled state -- so the
  // button rendered brighter/lifted, the opposite of "this doesn't work
  // right now". Watching the attribute directly (rather than requiring
  // every disabling call site to remember to clear these) clears the
  // inline hover styles the instant disabled flips on, letting the
  // stylesheet's own disabled treatment show through cleanly.
  // Same specificity problem as the filter/transform reset above, but
  // permanent rather than hover-triggered: every button's `cursor:pointer`
  // is baked into its own inline style="..." at creation time (outside
  // this shared helper's control) and never touched again, so it silently
  // overrode the stylesheet's `button:disabled { cursor: not-allowed }`
  // rule for the button's *entire* disabled duration, not just a brief
  // hover-transition window -- a disabled button always kept showing a
  // hand cursor, misleadingly suggesting it was still clickable. Explicitly
  // toggling the inline value both ways (not removeProperty) is required
  // here since a plain <button> has no pointer cursor by default to fall
  // back to on re-enable.
  const disabledObserver = new MutationObserver(() => {
    if (button.disabled) {
      // removeProperty, not 'none' -- an inline `filter: none` is still an
      // inline style and would just as effectively mask the stylesheet's
      // `button:disabled { filter: grayscale(...) }` rule as the hover
      // brightness it's replacing. Actually clearing the property lets the
      // cascade fall through to that rule.
      button.style.removeProperty('filter');
      button.style.transform = 'translateY(0)';
      button.style.boxShadow = '0 2px 0 rgba(0,0,0,0.35)';
      button.style.cursor = 'not-allowed';
    } else {
      button.style.cursor = 'pointer';
    }
  });
  disabledObserver.observe(button, { attributes: true, attributeFilter: ['disabled'] });
}
