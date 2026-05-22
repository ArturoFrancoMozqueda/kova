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
const updateSW = registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return;
    void registration.update();
    window.setInterval(() => {
      void registration.update();
    }, 60 * 60 * 1000);
  },
});

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
