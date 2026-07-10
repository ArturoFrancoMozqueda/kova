import { offlineDb } from "./db";
import { markOfflineSaleFailed } from "./queue";
import { RateLimitError, syncOfflineSales } from "./sync";

const MAX_ATTEMPTS = 5;
const BACKOFF_MS = [2_000, 8_000, 30_000, 60_000, 120_000];
// Keep request batches within the server-side per-request cap
// (MAX_OFFLINE_SALES_BATCH) so a large offline backlog syncs in chunks instead
// of being rejected wholesale. Must stay <= the backend cap.
const SYNC_CHUNK_SIZE = 100;

let isSyncing = false;
let retryTimer: ReturnType<typeof window.setTimeout> | null = null;

function scheduleRetryIn(delayMs: number) {
  if (retryTimer) window.clearTimeout(retryTimer);
  retryTimer = window.setTimeout(() => {
    retryTimer = null;
    void triggerSync();
  }, delayMs);
}

function scheduleRetry(minAttemptCount: number) {
  scheduleRetryIn(BACKOFF_MS[Math.min(minAttemptCount, BACKOFF_MS.length - 1)]);
}

export async function triggerSync(): Promise<void> {
  if (isSyncing) return;

  const all = await offlineDb.offline_sales.where("status").equals("pending").toArray();
  if (all.length === 0) return;

  // Permanently fail entries that exceeded max attempts
  const exceeded = all.filter((e) => e.attempt_count >= MAX_ATTEMPTS);
  for (const entry of exceeded) {
    await markOfflineSaleFailed(entry.client_uuid, "Max sync attempts exceeded");
  }

  const retryable = all.filter((e) => e.attempt_count < MAX_ATTEMPTS);
  if (retryable.length === 0) return;

  isSyncing = true;
  try {
    for (let i = 0; i < retryable.length; i += SYNC_CHUNK_SIZE) {
      // A RateLimitError (429) breaks the loop here so we don't keep sending
      // the remaining chunks into the rate limit.
      await syncOfflineSales(retryable.slice(i, i + SYNC_CHUNK_SIZE));
    }
  } catch (err) {
    if (err instanceof RateLimitError) {
      // Rate limited — items are back to "pending". Retry once after the
      // server-provided Retry-After window instead of backing off per-attempt.
      scheduleRetryIn(err.retryAfterMs);
    } else {
      // Network error — entries are back to "pending", schedule retry
      const stillPending = await offlineDb.offline_sales
        .where("status")
        .equals("pending")
        .toArray();
      if (stillPending.length > 0) {
        const minAttempts = Math.min(...stillPending.map((e) => e.attempt_count));
        scheduleRetry(minAttempts);
      }
    }
  } finally {
    isSyncing = false;
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => void triggerSync());
}
