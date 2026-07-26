import { useEffect, useRef, useState } from "react";
import { MOTION_MS, exitDelayMs } from "./motion";

export interface Presence {
  /** Render the node? Stays true through the exit animation. */
  mounted: boolean;
  /** Apply the exit classes? */
  exiting: boolean;
}

/**
 * CSS-only exit animations for anything that unmounts. Keeps the node in the DOM
 * for `exitMs` after `open` flips false, then drops it.
 *
 * Re-opening mid-exit cancels the timer and clears `exiting`, so rapid
 * open/close/open is interruptible instead of leaving a ghost behind. Under
 * prefers-reduced-motion the delay is 0, so the exit class never paints.
 */
export function usePresence(open: boolean, exitMs: number = MOTION_MS.panelExit): Presence {
  const [mounted, setMounted] = useState(open);
  const [exiting, setExiting] = useState(false);
  // Mirrors `mounted` for the effect, which must not depend on it: a `mounted`
  // dependency would re-run the effect when the exit timer lands and restart it.
  const mountedRef = useRef(open);
  const timer = useRef<number>();

  useEffect(() => {
    window.clearTimeout(timer.current);
    if (open) {
      mountedRef.current = true;
      setMounted(true);
      setExiting(false);
      return;
    }
    // Closed and never opened: nothing to animate out.
    if (!mountedRef.current) return;
    setExiting(true);
    timer.current = window.setTimeout(() => {
      mountedRef.current = false;
      setExiting(false);
      setMounted(false);
    }, exitDelayMs(exitMs));
    return () => window.clearTimeout(timer.current);
  }, [open, exitMs]);

  return { mounted, exiting };
}
