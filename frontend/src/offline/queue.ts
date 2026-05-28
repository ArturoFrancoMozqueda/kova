import { offlineDb } from "./db";
import type { OfflineSaleDraft, OfflineSaleQueueItem, OfflineSaleStatus } from "./types";

const nowIso = () => new Date().toISOString();

export function makeQueuedSale(
  sale: OfflineSaleDraft,
  clientUuid = crypto.randomUUID()
): OfflineSaleQueueItem {
  const now = nowIso();
  return {
    client_uuid: clientUuid,
    status: "pending",
    sale,
    attempt_count: 0,
    created_at: now,
    updated_at: now,
  };
}

export async function queueOfflineSale(sale: OfflineSaleDraft): Promise<OfflineSaleQueueItem> {
  const item = makeQueuedSale(sale);
  await offlineDb.offline_sales.put(item);
  return item;
}

export async function markOfflineSaleStatus(
  clientUuid: string,
  status: OfflineSaleStatus,
  lastError?: string
) {
  const existing = await offlineDb.offline_sales.get(clientUuid);
  if (!existing) {
    return;
  }
  await offlineDb.offline_sales.put({
    ...existing,
    status,
    last_error: lastError,
    // Count each sync attempt (syncing transition), not failure transitions
    attempt_count: status === "syncing" ? existing.attempt_count + 1 : existing.attempt_count,
    updated_at: nowIso(),
  });
}

/** Roll back a "syncing" attempt without burning a retry, e.g. on 429. */
export async function rollbackOfflineSaleAttempt(clientUuid: string, lastError?: string) {
  const existing = await offlineDb.offline_sales.get(clientUuid);
  if (!existing) {
    return;
  }
  await offlineDb.offline_sales.put({
    ...existing,
    status: "pending",
    last_error: lastError,
    attempt_count: Math.max(0, existing.attempt_count - 1),
    updated_at: nowIso(),
  });
}

export async function markOfflineSaleSynced(clientUuid: string, orderId?: string) {
  const existing = await offlineDb.offline_sales.get(clientUuid);
  if (!existing) return;
  await offlineDb.offline_sales.put({
    ...existing,
    status: "synced",
    last_error: undefined,
    synced_order_id: orderId,
    updated_at: nowIso(),
  });
}

export async function markOfflineSaleFailed(clientUuid: string, error: string) {
  await markOfflineSaleStatus(clientUuid, "failed", error);
}

export async function retryDeadLetter(clientUuid: string) {
  const existing = await offlineDb.offline_sales.get(clientUuid);
  if (!existing) {
    return;
  }
  await offlineDb.offline_sales.put({
    ...existing,
    status: "pending",
    last_error: undefined,
    updated_at: nowIso(),
  });
}

export async function getDeadLetters() {
  return offlineDb.offline_sales.where("status").equals("failed").toArray();
}

export async function getPendingOfflineSales() {
  return offlineDb.offline_sales.where("status").anyOf("pending", "failed").toArray();
}
