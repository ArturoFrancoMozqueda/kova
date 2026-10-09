import { offlineDb } from "./db";
import { getActiveOfflineTenant, onActiveOfflineTenantChange } from "./activeTenant";
import {
  claimPendingOfflineSales,
  markOfflineSaleFailed,
  recoverExpiredLeases,
} from "./queue";
import { RateLimitError, syncOfflineSales } from "./sync";

const MAX_ATTEMPTS = 5;
const BACKOFF_MS = [2_000, 8_000, 30_000, 60_000, 120_000];
const SYNC_CHUNK_SIZE = 100;
const workerId = crypto.randomUUID();

let syncingTenant: string | null = null;
let retryTimer: ReturnType<typeof window.setTimeout> | null = null;
let retryTenant: string | null = null;
let retryDeadline: number | null = null;
let activationTimer: ReturnType<typeof window.setTimeout> | null = null;

export function stopOfflineSync() {
  if (retryTimer) window.clearTimeout(retryTimer);
  if (activationTimer) window.clearTimeout(activationTimer);
  retryTimer = null;
  retryTenant = null;
  retryDeadline = null;
  activationTimer = null;
}

function scheduleActivationSync(tenantId: string) {
  if (activationTimer) window.clearTimeout(activationTimer);
  activationTimer = window.setTimeout(() => {
    activationTimer = null;
    if (getActiveOfflineTenant() === tenantId) void triggerSync(tenantId);
  }, 0);
}

// This module is loaded only by authenticated offline surfaces. Once loaded,
// session changes synchronously tear down any tenant-specific backoff timer.
// Publishing a new tenant also schedules a fresh sync: React runs child effects
// before parent effects, so Register can attempt triggerSync while AuthProvider
// has not published its tenant yet. The deferred retry closes that mount race.
onActiveOfflineTenantChange((tenantId) => {
  stopOfflineSync();
  if (tenantId) scheduleActivationSync(tenantId);
});

function scheduleRetryIn(tenantId: string, delayMs: number) {
  const deadline = Date.now() + delayMs;
  // Concurrent foreground failures can extend a cooldown, never shorten it.
  if (retryTimer && retryTenant === tenantId && retryDeadline !== null && retryDeadline >= deadline) return;
  stopOfflineSync();
  retryTenant = tenantId;
  retryDeadline = deadline;
  retryTimer = window.setTimeout(() => {
    retryTimer = null;
    const scheduledTenant = retryTenant;
    retryTenant = null;
    retryDeadline = null;
    if (scheduledTenant && getActiveOfflineTenant() === scheduledTenant) {
      void triggerSync(scheduledTenant);
    }
  }, delayMs);
}

function scheduleRetry(tenantId: string, minAttemptCount: number) {
  scheduleRetryIn(tenantId, BACKOFF_MS[Math.min(minAttemptCount, BACKOFF_MS.length - 1)]);
}

/** Foreground checkout also uses leased sync, so transient failures must hand
 * its durable pending sale back to the worker even if the browser stays online. */
export function scheduleOfflineSyncRetry(tenantId: string, error: unknown) {
  if (!tenantId || getActiveOfflineTenant() !== tenantId) return;
  scheduleRetryIn(tenantId, error instanceof RateLimitError ? error.retryAfterMs : BACKOFF_MS[0]);
}

export async function triggerSync(tenantId: string): Promise<void> {
  if (!tenantId || getActiveOfflineTenant() !== tenantId || syncingTenant) return;
  syncingTenant = tenantId;
  try {
    await recoverExpiredLeases(tenantId);
    while (getActiveOfflineTenant() === tenantId) {
      const candidates = await offlineDb.offline_sales
        .where("[tenant_id+status]")
        .equals([tenantId, "pending"])
        .limit(SYNC_CHUNK_SIZE)
        .toArray();
      if (candidates.length === 0) return;

      const claimed = await claimPendingOfflineSales(tenantId, workerId, SYNC_CHUNK_SIZE);
      if (claimed.length === 0) return;
      // Transition exhausted rows before sending the remaining batch together.
      // Sending leased rows one at a time strands the unsent rows in `syncing`
      // when an earlier request throws, preventing the retry timer from finding
      // them. syncOfflineSales releases every lease in the batch on failure.
      const retryable = [];
      for (const entry of claimed) {
        if (entry.attempt_count > MAX_ATTEMPTS) {
          await markOfflineSaleFailed(
            tenantId,
            entry.client_uuid,
            entry.lease_id!,
            "Max sync attempts exceeded",
          );
        } else {
          retryable.push(entry);
        }
      }
      if (retryable.length > 0) await syncOfflineSales(tenantId, retryable);
    }
  } catch (err) {
    if (getActiveOfflineTenant() !== tenantId) return;
    if (err instanceof RateLimitError) {
      scheduleRetryIn(tenantId, err.retryAfterMs);
      return;
    }
    const pending = await offlineDb.offline_sales
      .where("[tenant_id+status]")
      .equals([tenantId, "pending"])
      .toArray();
    if (pending.length > 0) {
      scheduleRetry(tenantId, Math.min(...pending.map((entry) => entry.attempt_count)));
    }
  } finally {
    syncingTenant = null;
    const activeTenant = getActiveOfflineTenant();
    // If the tenant changed while another worker was still unwinding, the
    // activation callback may have observed `syncingTenant` and returned.
    // Re-arm it after release so the new tenant cannot be stranded.
    if (activeTenant && activeTenant !== tenantId) scheduleActivationSync(activeTenant);
  }
}
