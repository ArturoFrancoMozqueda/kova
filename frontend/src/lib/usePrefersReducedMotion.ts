// Single source of truth for prefers-reduced-motion across the app and the
// landing. The global CSS block in styles.css neutralizes CSS animations and
// transitions, but it cannot reach rAF loops or JS timers — those must ask here.
//
// Reactive: a matchMedia change listener means toggling the OS preference takes
// effect without a reload. Prerender-safe: during hydration React uses
// getServerSnapshot() === false, so the HTML from scripts/prerender.mjs always
// matches the first client render and the real value lands right after.
//
// jsdom in this repo does not implement matchMedia (see
// landing/showcase/KovaShowcase.test.tsx), so every path guards for its absence
// rather than assuming a MediaQueryList exists.
import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function mediaQueryList(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(QUERY);
}

/** Imperative read, for effects, event handlers and timers. */
export function prefersReducedMotion(): boolean {
  return mediaQueryList()?.matches ?? false;
}

function subscribe(onChange: () => void): () => void {
  const mql = mediaQueryList();
  if (!mql) return () => {};
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

/** Reactive hook. Returns false on the server and during hydration. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, prefersReducedMotion, () => false);
}
