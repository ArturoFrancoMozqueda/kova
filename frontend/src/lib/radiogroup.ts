import type { KeyboardEvent } from "react";

type RadioOption<T> = { value: T; disabled?: boolean };

/**
 * ARIA radiogroup arrow-key navigation. Attach to the radiogroup container's
 * onKeyDown. Arrow/Home/End move the selection across enabled options (with
 * wraparound) and move DOM focus to follow it, as the APG pattern requires.
 *
 * Each radio button must expose `data-radio-value={String(value)}` so focus
 * can follow the selection without threading refs through every option.
 */
export function handleRadioGroupKeyDown<T>(
  e: KeyboardEvent<HTMLElement>,
  options: readonly RadioOption<T>[],
  current: T,
  onSelect: (value: T) => void,
): void {
  const NAV_KEYS = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"];
  if (!NAV_KEYS.includes(e.key)) return;

  const enabled = options.filter((o) => !o.disabled);
  if (enabled.length === 0) return;

  e.preventDefault();
  const idx = enabled.findIndex((o) => o.value === current);
  let next = idx < 0 ? 0 : idx;

  switch (e.key) {
    case "ArrowRight":
    case "ArrowDown":
      next = idx < 0 ? 0 : (idx + 1) % enabled.length;
      break;
    case "ArrowLeft":
    case "ArrowUp":
      next = idx < 0 ? enabled.length - 1 : (idx - 1 + enabled.length) % enabled.length;
      break;
    case "Home":
      next = 0;
      break;
    case "End":
      next = enabled.length - 1;
      break;
  }

  const nextValue = enabled[next].value;
  onSelect(nextValue);
  const el = e.currentTarget.querySelector<HTMLElement>(
    `[data-radio-value="${CSS.escape(String(nextValue))}"]`,
  );
  el?.focus();
}
