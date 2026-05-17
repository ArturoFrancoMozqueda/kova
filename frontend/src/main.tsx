import React from "react";
import ReactDOM from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import "./observability/sentry";
import "./styles.css";

// Check for service worker updates early; the user-facing prompt applies them safely.
const updateSW = registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return;
    void registration.update();
    window.setInterval(() => {
      void registration.update();
    }, 60 * 60 * 1000);
  },
  onNeedRefresh() {
    window.dispatchEvent(new CustomEvent("pos:pwa-update-available"));
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
