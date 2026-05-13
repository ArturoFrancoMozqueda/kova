import { offlineDb } from "./db";
import { markOfflineSaleFailed } from "./queue";
import { syncOfflineSales } from "./sync";

const MAX_ATTEMPTS = 5;
const BACKOFF_MS = [2_000, 8_000, 30_000, 60_000, 120_000];

let isSyncing = false;
let retryTimer: ReturnType<typeof window.setTimeout> | null = null;

function scheduleRetry(minAttemptCount: number) {
  if (retryTimer) window.clearTimeout(retryTimer);
  const delay = BACKOFF_MS[Math.min(minAttemptCount, BACKOFF_MS.length - 1)];
  retryTimer = window.setTimeout(() => {
    retryTimer = null;
    void triggerSync();
  }, delay);
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
    await syncOfflineSales(retryable);
  } catch {
    // Network error — entries are back to "pending", schedule retry
    const stillPending = await offlineDb.offline_sales
      .where("status")
      .equals("pending")
      .toArray();
    if (stillPending.length > 0) {
      const minAttempts = Math.min(...stillPending.map((e) => e.attempt_count));
      scheduleRetry(minAttempts);
    }
  } finally {
    isSyncing = false;
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => void triggerSync());
}
