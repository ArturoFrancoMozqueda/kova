// Shared Tab-key focus trap used by the Dialog primitive and the few
// dialog-shaped surfaces that can't mount a Dialog (e.g. the register's
// sale-success overlay, which must stay in the DOM as the print-receipt root).

export const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

type TrapKeyEvent = Pick<KeyboardEvent, "key" | "shiftKey" | "preventDefault">;

// Keeps Tab / Shift+Tab cycling inside `container`. No-op for other keys.
export function trapTabKey(event: TrapKeyEvent, container: HTMLElement): void {
  if (event.key !== "Tab") return;

  const items = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  if (items.length === 0) {
    // No focusable child — keep focus on the container.
    event.preventDefault();
    container.focus();
    return;
  }

  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;

  if (event.shiftKey) {
    if (active === first || active === container || !container.contains(active)) {
      event.preventDefault();
      last.focus();
    }
  } else if (active === last || !container.contains(active)) {
    event.preventDefault();
    first.focus();
  }
}
