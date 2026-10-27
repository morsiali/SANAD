// Display preferences for this device: text size and motion. Kept in the browser only (they are about the screen,
// not the person's care data) and applied to the whole page.
export type TextSize = 'normal' | 'large' | 'larger';
export type Motion = 'system' | 'reduce';
export interface Display {
  text: TextSize;
  motion: Motion;
}

const KEY = 'sanad.display.v1';
const DEFAULT: Display = { text: 'normal', motion: 'system' };

export function readDisplay(): Display {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Display> | null;
    return {
      text: v?.text === 'large' || v?.text === 'larger' ? v.text : 'normal',
      motion: v?.motion === 'reduce' ? 'reduce' : 'system',
    };
  } catch {
    return DEFAULT;
  }
}

export function applyDisplay(d: Display = readDisplay()) {
  const el = document.documentElement;
  el.dataset.text = d.text;
  el.dataset.motion = d.motion;
}

export function saveDisplay(d: Display) {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    /* storage unavailable: still applies for this visit */
  }
  applyDisplay(d);
}

/** True when animations should be avoided (system setting or the person's choice). */
export function prefersLessMotion(): boolean {
  if (document.documentElement.dataset.motion === 'reduce') return true;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
