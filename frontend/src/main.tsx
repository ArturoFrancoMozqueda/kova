import React from "react";
import ReactDOM from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import "./observability/sentry";
// Self-hosted Inter (variable). Bundled by Vite and precached by the PWA
// (workbox globPatterns includes woff2), so the brand font works offline too.
import "@fontsource-variable/inter";
import "./styles.css";

// autoUpdate mode: new service workers skip waiting and claim clients
// immediately, so updated assets apply on the next navigation without a manual
// prompt. Marketing/auth routes ("/", "/login", "/signup", "/verify-email",
// "/billing") are denylisted from the SW navigation fallback in vite.config.ts,
// so returning users always get fresh landing/pricing copy from the network.
let reloading = false;
async function forceReload() {
  if (reloading) return;
  reloading = true;
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    // best-effort cache wipe; reload anyway
  }
  window.location.reload();
}

// Routes where a forced reload would destroy in-flight work (e.g. an open
// cart in the register). On those, we skip the reload and let the next safe
// navigation pick up the new bundle.
function isReloadSafePath(pathname: string): boolean {
  if (pathname.startsWith("/register")) return false;
  return true;
}

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

const updateSW = registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return;
    const checkForUpdate = () => {
      void registration.update();
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

window.addEventListener("pos:pwa-apply-update", () => {
  void updateSW(true);
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
