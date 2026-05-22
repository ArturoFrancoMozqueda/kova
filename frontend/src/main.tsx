import React from "react";
import ReactDOM from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import "./observability/sentry";
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
// updatefound, reload on controller change.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("controllerchange", () => {
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
