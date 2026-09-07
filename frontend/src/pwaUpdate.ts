const EXPECTED_SERVICE_WORKER_ERROR_PATTERNS = [
  /null\/nonexistent service worker registration/i,
  /service worker registration/i,
  /failed to update a serviceworker/i,
  /script .*\/sw\.js load failed/i,
  /operation has been aborted/i,
  /not found/i,
];

const STALE_ASSET_ERROR_PATTERNS = [
  /unable to preload css/i,
  /failed to fetch dynamically imported module/i,
  /importing a module script failed/i,
  /loading chunk \d+ failed/i,
  /chunkloaderror/i,
];

let reloading = false;

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error ?? "");
}

export function isExpectedServiceWorkerError(error: unknown): boolean {
  const message = errorMessage(error);
  return EXPECTED_SERVICE_WORKER_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

export function isStaleAssetError(error: unknown): boolean {
  const message = errorMessage(error);
  return STALE_ASSET_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

export function reportUnexpectedPwaError(error: unknown) {
  if (isExpectedServiceWorkerError(error)) return;
  console.error("PWA update failed:", error);
}

export function safelyUpdateServiceWorker(update: () => Promise<unknown>) {
  void update().catch(reportUnexpectedPwaError);
}

// Routes where a forced reload would destroy in-flight work. The register owns
// an unsaved cart; an order detail can own a refund intent whose idempotency key
// must survive an uncertain response. On those routes we defer activation and
// let the next safe navigation pick up the new bundle.
export function isReloadSafePath(pathname: string): boolean {
  if (pathname.startsWith("/register")) return false;
  if (/^\/orders\/[^/]+(?:\/|$)/.test(pathname)) return false;
  return true;
}

export function announcePwaUpdateAvailable() {
  window.dispatchEvent(new CustomEvent("pos:pwa-update-available"));
}

/**
 * Single entry point for actions that activate a new bundle or reload the
 * current one. Register and order detail are deliberately unsafe because they
 * can hold replay identities in memory until a sale/refund is reconciled.
 */
export function runPwaUpdateAtSafePoint(
  action: () => Promise<unknown> | unknown,
  pathname: string = window.location.pathname,
): boolean {
  if (!isReloadSafePath(pathname)) {
    announcePwaUpdateAvailable();
    return false;
  }
  try {
    void Promise.resolve(action()).catch(reportUnexpectedPwaError);
  } catch (error) {
    reportUnexpectedPwaError(error);
  }
  return true;
}

export function requestPwaReload(pathname: string = window.location.pathname): boolean {
  return runPwaUpdateAtSafePoint(forceReload, pathname);
}

export async function forceReload() {
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

export function resetPwaReloadStateForTests() {
  reloading = false;
}
