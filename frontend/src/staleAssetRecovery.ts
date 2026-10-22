import {
  forceReload,
  isReloadSafePath,
  isStaleAssetError,
  reportUnexpectedPwaError,
} from "./pwaUpdate";

const RECOVERY_KEY = "kova:stale-asset-recovery:v1";

/** Clear only deploy caches/registrations; cookies and offline business data survive. */
export async function reloadStaleAssets(): Promise<void> {
  try {
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(
        registrations.map((registration) => registration.unregister()),
      );
    }
  } catch {
    // A missing/unavailable registration must not prevent the network reload.
  }
  await forceReload();
}

/** Fatal render recovery only. Proactive PWA updates still defer on login/forms. */
export function recoverStaleAsset(
  error: unknown,
  pathname = window.location.pathname,
  build = __BUILD_HASH__,
): boolean {
  if (!isStaleAssetError(error) || !navigator.onLine) return false;
  const path = pathname.split(/[?#]/, 1)[0].replace(/\/$/, "") || "/";
  // The failed lazy auth route has already been unmounted by ErrorBoundary.
  // Keep all other form/POS/refund guards, including proactive auth updates.
  if (!isReloadSafePath(path) && path !== "/login") return false;
  try {
    // Per-tab, per-build marker survives reloads without retaining URLs or identity.
    // Without storage we cannot guarantee the bound, so keep the manual fallback.
    if (!build) return false;
    const key = `${RECOVERY_KEY}:${build}`;
    if (sessionStorage.getItem(key) === build) return false;
    sessionStorage.setItem(key, build);
  } catch {
    return false;
  }
  void reloadStaleAssets().catch(reportUnexpectedPwaError);
  return true;
}
