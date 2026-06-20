import React from "react";
import ReactDOM from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import { forceReload, isReloadSafePath, safelyUpdateServiceWorker } from "./pwaUpdate";
import "./observability/sentry";
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
  safelyUpdateServiceWorker(() => updateSW(true));
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
