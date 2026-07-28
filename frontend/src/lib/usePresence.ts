import { useEffect, useMemo, useRef, useState } from "react";
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

export interface KeyedPresence<T> {
  key: string;
  item: T;
  state: "present" | "exiting";
}

interface ExitingRow<T> {
  key: string;
  item: T;
  /** Position the row held before it left, so it collapses where it was. */
  index: number;
}

/**
 * List counterpart of usePresence, for rows that leave a collection rather than
 * a surface that toggles. Retains the last snapshot of a departed row, marked
 * `exiting`, at the position it held, then drops it after `exitMs`.
 *
 * A key that reappears inside the exit window cancels its exit — required by the
 * cart, where the undo toast can fire while the row is still collapsing.
 *
 * `items` must be referentially stable between unrelated re-renders (e.g. a
 * useMemo over the source state), since it drives the diff.
 */
export function usePresenceKeys<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  exitMs: number = MOTION_MS.panelExit,
): KeyedPresence<T>[] {
  const [exiting, setExiting] = useState<ExitingRow<T>[]>([]);
  const previous = useRef<readonly T[]>(items);
  const timers = useRef(new Map<string, number>());

  useEffect(() => {
    const previousItems = previous.current;
    previous.current = items;

    const presentKeys = new Set(items.map(keyOf));

    // Cancel the exit of anything that came back.
    for (const [key, timer] of timers.current) {
      if (!presentKeys.has(key)) continue;
      window.clearTimeout(timer);
      timers.current.delete(key);
    }
    setExiting((current) => current.filter((row) => !presentKeys.has(row.key)));

    const departed = previousItems
      .map((item, index) => ({ key: keyOf(item), item, index }))
      .filter((row) => !presentKeys.has(row.key) && !timers.current.has(row.key));
    if (departed.length === 0) return;

    setExiting((current) => [...current, ...departed]);
    const delay = exitDelayMs(exitMs);
    for (const row of departed) {
      timers.current.set(
        row.key,
        window.setTimeout(() => {
          timers.current.delete(row.key);
          setExiting((current) => current.filter((entry) => entry.key !== row.key));
        }, delay),
      );
    }
  }, [items, keyOf, exitMs]);

  useEffect(
    () => () => {
      timers.current.forEach((timer) => window.clearTimeout(timer));
      timers.current.clear();
    },
    [],
  );

  return useMemo(() => {
    const rows: KeyedPresence<T>[] = items.map((item) => ({
      key: keyOf(item),
      item,
      state: "present",
    }));
    const presentKeys = new Set(rows.map((row) => row.key));
    // Each remembered index was measured against the list as it stood when that
    // row left, so rows that left later were measured against a list already
    // missing the earlier ones. Re-inserting in ascending index order and
    // shifting by the ties already placed puts them all back where they were.
    let placed = 0;
    for (const row of [...exiting].sort((a, b) => a.index - b.index)) {
      if (presentKeys.has(row.key)) continue;
      rows.splice(Math.min(row.index + placed, rows.length), 0, {
        key: row.key,
        item: row.item,
        state: "exiting",
      });
      placed += 1;
    }
    return rows;
  }, [items, keyOf, exiting]);
}
