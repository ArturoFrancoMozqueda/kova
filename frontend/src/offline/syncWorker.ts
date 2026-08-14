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

export function stopOfflineSync() {
  if (retryTimer) window.clearTimeout(retryTimer);
  retryTimer = null;
  retryTenant = null;
}

// This module is loaded only by authenticated offline surfaces. Once loaded,
// session changes synchronously tear down any tenant-specific backoff timer.
onActiveOfflineTenantChange(() => stopOfflineSync());

function scheduleRetryIn(tenantId: string, delayMs: number) {
  stopOfflineSync();
  retryTenant = tenantId;
  retryTimer = window.setTimeout(() => {
    retryTimer = null;
    const scheduledTenant = retryTenant;
    retryTenant = null;
    if (scheduledTenant && getActiveOfflineTenant() === scheduledTenant) {
      void triggerSync(scheduledTenant);
    }
  }, delayMs);
}

function scheduleRetry(tenantId: string, minAttemptCount: number) {
  scheduleRetryIn(tenantId, BACKOFF_MS[Math.min(minAttemptCount, BACKOFF_MS.length - 1)]);
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

      const exceeded = candidates.filter((entry) => entry.attempt_count >= MAX_ATTEMPTS);
      // Max-attempt rows are leased before transitioning so every mutation is
      // protected by the same tenant + lease ownership rule.
      if (exceeded.length > 0) {
        const claimed = await claimPendingOfflineSales(tenantId, workerId, SYNC_CHUNK_SIZE);
        for (const entry of claimed) {
          if (entry.attempt_count > MAX_ATTEMPTS) {
            await markOfflineSaleFailed(
              tenantId,
              entry.client_uuid,
              entry.lease_id!,
              "Max sync attempts exceeded",
            );
          } else {
            await syncOfflineSales(tenantId, [entry]);
          }
        }
        continue;
      }

      const claimed = await claimPendingOfflineSales(tenantId, workerId, SYNC_CHUNK_SIZE);
      if (claimed.length === 0) return;
      await syncOfflineSales(tenantId, claimed);
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
  }
}
