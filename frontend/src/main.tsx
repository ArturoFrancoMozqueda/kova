import React from "react";
import ReactDOM from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App, { PRERENDERED_ROUTES } from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import { forceReload, isReloadSafePath, safelyUpdateServiceWorker } from "./pwaUpdate";
// Self-hosted Inter (variable). Bundled by Vite and precached by the PWA
// (workbox globPatterns includes woff2), so the brand font works offline too.
import "@fontsource-variable/inter";
import "./styles.css";

// One-shot version probe at boot. Fetches the deploy-time version.json
// (NetworkOnly via the SW runtime route) and compares to the hash baked into
// this bundle. If they differ, the user is running stale JS served by the
// previous SW — unregister it, wipe caches, and reload.
async function checkVersionAndReloadIfStale() {
  try {
    const res = await fetch("/version.json", { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { hash?: string };
    if (!data?.hash || data.hash === __BUILD_HASH__) return;
    if (!isReloadSafePath(window.location.pathname)) return;
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    void forceReload();
  } catch {
    // network errors are non-fatal — we'll just check again next boot
  }
}
void checkVersionAndReloadIfStale();

/* ── Service worker ──────────────────────────────────────────────────────── */

// Marketing/legal/auth pages a first-time visitor lands on. Registering the SW
// there immediately makes every casual visitor precache the entire POS app
// (~1.5 MB of chunks and fonts), competing with the landing's own resources.
// Mirror of vite.config.ts navigateFallbackDenylist + the legal/showcase
// routes: keep the two lists in sync.
const PUBLIC_VISITOR_PATHS = [
  "/login",
  "/signup",
  "/verify-email",
  "/accept-invite",
  "/forgot-password",
  "/reset-password",
  "/privacy",
  "/terms",
  "/seguridad",
  "/cookies",
  "/kova-showcase-video",
];

function normalizePath(pathname: string): string {
  return pathname !== "/" && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

function isPublicVisitorPath(pathname: string): boolean {
  const path = normalizePath(pathname);
  return path === "/" || PUBLIC_VISITOR_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}

let swStarted = false;
function startServiceWorker() {
  if (swStarted) return;
  swStarted = true;

  const updateSW = registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      const checkForUpdate = () => {
        safelyUpdateServiceWorker(() => registration.update());
      };
      checkForUpdate();
      window.setInterval(checkForUpdate, 60 * 60 * 1000);
      // Force reload as soon as a new SW finishes installing, instead of waiting
      // for the user to navigate.
      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener("statechange", () => {
          if (installing.state === "installed" && navigator.serviceWorker.controller) {
            void forceReload();
          }
        });
      });
    },
  });

  window.addEventListener("pos:pwa-apply-update", () => {
    safelyUpdateServiceWorker(() => updateSW(true));
  });
}

// App routes register immediately (offline-first POS depends on the SW).
// Public marketing routes defer registration until the visitor interacts or
// the browser goes idle, so the app precache never competes with the landing's
// first paint. Any navigation into the app implies an interaction first, so
// the SW is always registered by the time it matters.
function scheduleServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (!isPublicVisitorPath(window.location.pathname)) {
    startServiceWorker();
    return;
  }

  const start = () => {
    window.removeEventListener("pointerdown", start);
    window.removeEventListener("keydown", start);
    startServiceWorker();
  };
  window.addEventListener("pointerdown", start, { once: true });
  window.addEventListener("keydown", start, { once: true });
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(start, { timeout: 8000 });
  } else {
    window.setTimeout(start, 8000);
  }
}
scheduleServiceWorker();

// Fallback: if the new SW activates via clientsClaim before we hooked
// updatefound, reload on controller change. Only fire when an existing
// controller is being replaced — not on the first install of a fresh page,
// which would cause an unexpected reload loop in tests and on first visit.
if ("serviceWorker" in navigator) {
  const hadInitialController = navigator.serviceWorker.controller !== null;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadInitialController) return;
    void forceReload();
  });
}

/* ── Error reporting ─────────────────────────────────────────────────────── */

// Sentry is deliberately NOT imported statically: @sentry/react adds ~90 KB to
// the eager vendor chunk. Importing the module runs its top-level init; errors
// raised before then are queued by observability/errorReporting.ts (which
// loads the same module on demand).
if (import.meta.env.VITE_SENTRY_DSN) {
  const initSentry = () => void import("./observability/sentry");
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(initSentry, { timeout: 5000 });
  } else {
    window.setTimeout(initSentry, 5000);
  }
}

/* ── React boot: hydrate prerendered HTML, client-render everything else ─── */

const app = (
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

const rootEl = document.getElementById("root")!;
const preloadRoute = PRERENDERED_ROUTES[normalizePath(window.location.pathname)];

if (preloadRoute && rootEl.hasChildNodes()) {
  // scripts/prerender.mjs shipped this page with real HTML. Load the route's
  // chunk first (lazyWithPreload → the route won't suspend), then hydrate, so
  // the prerendered content is adopted in place instead of being wiped and
  // re-rendered through the Suspense fallback.
  preloadRoute().then(
    () => ReactDOM.hydrateRoot(rootEl, app),
    () => ReactDOM.createRoot(rootEl).render(app),
  );
} else {
  ReactDOM.createRoot(rootEl).render(app);
}
