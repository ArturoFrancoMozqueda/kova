// TS mirror of the --kova-dur-* scale in src/styles.css, for JS that has to wait
// out a CSS animation before unmounting a node. motion.test.ts parses styles.css
// and fails if the two ever drift, so this is a mirror rather than a second
// source of truth.
//
// Why a shared constant and not a transitionend/animationend listener: jsdom
// never fires animationend, so every Dialog test would hang on close; and the
// event does not fire at all if the node is display:none or the animation is
// interrupted, so a timeout fallback would be needed anyway — and then there
// are two mechanisms to keep in sync instead of one.
import { prefersReducedMotion } from "./usePrefersReducedMotion";

export const MOTION_MS = {
  press: 80,
  quick: 120,
  hover: 180,
  panel: 240,
  modal: 280,
  celebrate: 600,
  panelExit: 160,
  modalExit: 180,
} as const;

/**
 * 0 when the user opted out of motion, so an exit collapses instead of stalling.
 * Without this the CSS would finish in 0.01ms (the global reduced-motion reset)
 * while the JS still held the node for the full duration.
 */
export function exitDelayMs(ms: number): number {
  return prefersReducedMotion() ? 0 : ms;
}
