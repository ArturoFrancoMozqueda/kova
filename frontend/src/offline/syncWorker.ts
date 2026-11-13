import { offlineDb } from "./db";
import { getActiveOfflineTenant, onActiveOfflineTenantChange } from "./activeTenant";
import {
  claimPendingOfflineSales,
  markOfflineSaleFailed,
  recoverExpiredLeases,
} from "./queue";
import { BillingAccessError, RateLimitError, syncOfflineSales } from "./sync";
import { purgeSyncedSales } from "./storage";
import { setSyncIssue, SyncSessionError } from "./syncStatus";

// Attempts are only consumed by sends whose outcome stayed unknown for reasons
// other than the connection (an expired lease after a crashed tab, or a
// malformed acknowledgement). Network errors, timeouts, 5xx, 429 and
// batch-level 4xx roll their attempt back, so an outage never exhausts this.
const MAX_ATTEMPTS = 5;
// Transient failures retry indefinitely while online, capped at 2 minutes.
const BACKOFF_MS = [2_000, 8_000, 30_000, 60_000, 120_000];
// The backend processes a batch serially; small chunks keep each request well
// under the client timeout and free the leases sooner.
export const SYNC_CHUNK_SIZE = 25;
const PURGE_INTERVAL_MS = 60 * 60_000;
const EXHAUSTED_MESSAGE = "No pudimos confirmar esta venta tras varios intentos. Sigue guardada en este dispositivo; al reintentar no se duplicará.";
const workerId = crypto.randomUUID();
let transientFailures = 0;
let lastPurgeAt = 0;

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
  transientFailures = 0;
  setSyncIssue(null);
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

function nextBackoffMs() {
  const delay = BACKOFF_MS[Math.min(transientFailures, BACKOFF_MS.length - 1)];
  transientFailures += 1;
  return delay;
}

function noteSyncIssue(tenantId: string, error: unknown) {
  if (error instanceof SyncSessionError) setSyncIssue({ tenantId, kind: error.kind });
}

/** Keeps the local queue bounded; never touches unconfirmed or failed sales. */
async function purgeIfDue() {
  const now = Date.now();
  if (now - lastPurgeAt < PURGE_INTERVAL_MS) return;
  lastPurgeAt = now;
  try {
    await purgeSyncedSales();
  } catch {
    // Housekeeping only; a failed purge must never block a sync.
  }
}

/** Foreground checkout also uses leased sync, so transient failures must hand
 * its durable pending sale back to the worker even if the browser stays online. */
export function scheduleOfflineSyncRetry(tenantId: string, error: unknown) {
  if (error instanceof BillingAccessError) return;
  if (!tenantId || getActiveOfflineTenant() !== tenantId) return;
  noteSyncIssue(tenantId, error);
  scheduleRetryIn(tenantId, error instanceof RateLimitError ? error.retryAfterMs : BACKOFF_MS[0]);
}

export async function triggerSync(tenantId: string): Promise<void> {
  if (!tenantId || getActiveOfflineTenant() !== tenantId || syncingTenant || !navigator.onLine) return;
  syncingTenant = tenantId;
  try {
    await purgeIfDue();
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
            EXHAUSTED_MESSAGE,
            "SYNC_UNCONFIRMED",
          );
        } else {
          retryable.push(entry);
        }
      }
      if (retryable.length > 0) await syncOfflineSales(tenantId, retryable);
      // The server answered this chunk: the connection and session are fine.
      transientFailures = 0;
      setSyncIssue(null);
    }
  } catch (err) {
    if (err instanceof BillingAccessError) return;
    if (getActiveOfflineTenant() !== tenantId) return;
    if (err instanceof RateLimitError) {
      scheduleRetryIn(tenantId, err.retryAfterMs);
      return;
    }
    noteSyncIssue(tenantId, err);
    const pending = await offlineDb.offline_sales
      .where("[tenant_id+status]")
      .equals([tenantId, "pending"])
      .toArray();
    if (pending.length > 0) scheduleRetryIn(tenantId, nextBackoffMs());
  } finally {
    syncingTenant = null;
    const activeTenant = getActiveOfflineTenant();
    // If the tenant changed while another worker was still unwinding, the
    // activation callback may have observed `syncingTenant` and returned.
    // Re-arm it after release so the new tenant cannot be stranded.
    if (activeTenant && activeTenant !== tenantId) scheduleActivationSync(activeTenant);
  }
}
