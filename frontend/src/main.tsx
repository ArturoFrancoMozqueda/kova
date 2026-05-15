import React from "react";
import ReactDOM from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import "./observability/sentry";
import "./styles.css";

// Auto-update service worker silently — no prompt needed for a POS kiosk
const updateSW = registerSW({
  immediate: true,
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
