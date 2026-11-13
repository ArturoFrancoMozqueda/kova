import { offlineDb } from "./db";

/** Synced rows are only a local copy of a server-confirmed sale. */
export const SYNCED_RETENTION_MS = 7 * 24 * 60 * 60_000;

/**
 * Deletes only `synced` rows last touched before the retention window.
 * Pending, syncing, failed and quarantined rows are never part of this query:
 * an unconfirmed or rejected sale must never disappear on its own.
 */
export async function purgeSyncedSales(
  olderThanMs: number = SYNCED_RETENTION_MS,
  nowMs: number = Date.now(),
): Promise<number> {
  const cutoff = new Date(nowMs - olderThanMs).toISOString();
  return offlineDb.offline_sales
    .where("status")
    .equals("synced")
    .and((row) => row.status === "synced" && row.updated_at <= cutoff)
    .delete();
}

let persistenceRequested = false;

/**
 * Best-effort request so the browser does not evict the offline queue under
 * storage pressure. Asked once per page load; failures and unsupported
 * browsers are ignored because the queue still works without it.
 */
export function requestPersistentStorage(): void {
  if (persistenceRequested) return;
  persistenceRequested = true;
  try {
    const storage = typeof navigator !== "undefined" ? navigator.storage : undefined;
    if (!storage || typeof storage.persist !== "function") return;
    const alreadyPersisted = typeof storage.persisted === "function"
      ? storage.persisted()
      : Promise.resolve(false);
    void alreadyPersisted
      .then((persisted) => (persisted ? true : storage.persist()))
      .catch(() => undefined);
  } catch {
    // Storage persistence is an optimization; never block a sale on it.
  }
}

/** Test hook: lets each test observe the one-time request again. */
export function resetPersistentStorageRequestForTests() {
  persistenceRequested = false;
}

/** Dexie wraps the DOM quota error; look through `inner`/`cause` too. */
export function isQuotaExceededError(error: unknown): boolean {
  let candidate: unknown = error;
  for (let depth = 0; depth < 4 && candidate && typeof candidate === "object"; depth += 1) {
    const { name, code } = candidate as { name?: unknown; code?: unknown };
    if (name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED" || code === 22) return true;
    const next = candidate as { inner?: unknown; cause?: unknown };
    candidate = next.inner ?? next.cause;
  }
  return false;
}
