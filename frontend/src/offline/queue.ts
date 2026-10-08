import { LotQueueError, availableLots, lotStockKey, readLocalLots } from "./lotStock";
import { offlineDb } from "./db";
import type {
  OfflineReceiptSnapshot,
  OfflineSaleDraft,
  OfflineSaleQueueItem,
  OfflineSaleStatus,
  StoredOfflineSaleQueueItem,
} from "./types";

const nowIso = () => new Date().toISOString();
export const SYNC_LEASE_MS = 2 * 60_000;

function isOwnedRow(
  row: StoredOfflineSaleQueueItem | undefined,
  tenantId: string,
): row is OfflineSaleQueueItem {
  return Boolean(row?.tenant_id === tenantId && row.status !== "quarantined");
}

export function makeQueuedSale(
  tenantId: string,
  sale: OfflineSaleDraft,
  clientUuid: string = crypto.randomUUID(),
  shiftId?: string,
  receiptSnapshot?: OfflineReceiptSnapshot,
  branchId?: string,
): OfflineSaleQueueItem {
  if (!tenantId) throw new Error("An authenticated tenant is required to queue an offline sale");
  const now = nowIso();
  return {
    client_uuid: clientUuid,
    tenant_id: tenantId,
    ...(branchId ? { branch_id: branchId } : {}),
    status: "pending",
    sale,
    ...(shiftId ? { shift_id: shiftId } : {}),
    ...(receiptSnapshot ? { receipt_snapshot: receiptSnapshot } : {}),
    attempt_count: 0,
    created_at: now,
    updated_at: now,
  };
}

export async function queueOfflineSale(
  tenantId: string,
  sale: OfflineSaleDraft,
  shiftId?: string,
  receiptSnapshot?: OfflineReceiptSnapshot,
  branchId?: string,
): Promise<OfflineSaleQueueItem> {
  const item = makeQueuedSale(tenantId, sale, undefined, shiftId, receiptSnapshot, branchId);
  // `add` fails closed on the astronomically unlikely UUID collision instead
  // of overwriting a sale owned by another tenant.
  const parts = sale.items.flatMap(line => line.lot_allocations ?? []);
  if (parts.length) {
    await offlineDb.transaction("rw", offlineDb.offline_sales, offlineDb.lot_stock, async () => {
      const cache = await readLocalLots(tenantId, branchId ?? tenantId);
      if (!cache) throw new LotQueueError("Conéctate para cargar los lotes de esta sucursal antes de cobrar.");
      const wanted = new Map<string, number>();
      parts.forEach(part => wanted.set(part.lot_id, (wanted.get(part.lot_id) ?? 0) + part.quantity));
      const available = new Map(availableLots(cache).map(lot => [lot.id, lot.available_quantity]));
      for (const [lotId, quantity] of wanted) {
        if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > (available.get(lotId) ?? 0)) throw new LotQueueError("Las unidades del lote cambiaron en este dispositivo. Revisa los lotes antes de cobrar.");
      }
      await offlineDb.offline_sales.add(item);
      await offlineDb.lot_stock.put({ ...cache, key: lotStockKey(tenantId, branchId ?? tenantId), debits: [...cache.debits, { client_uuid: item.client_uuid, allocations: parts }] });
    });
  } else {
    await offlineDb.offline_sales.add(item);
  }
  return item;
}

async function updateClaimedSale(
  tenantId: string,
  clientUuid: string,
  leaseId: string,
  update: (existing: OfflineSaleQueueItem) => OfflineSaleQueueItem,
) {
  return offlineDb.transaction("rw", offlineDb.offline_sales, async () => {
    const existing = await offlineDb.offline_sales.get(clientUuid);
    if (!isOwnedRow(existing, tenantId) || existing.lease_id !== leaseId) return false;
    await offlineDb.offline_sales.put(update(existing));
    return true;
  });
}

export async function markOfflineSaleStatus(
  tenantId: string,
  clientUuid: string,
  leaseId: string,
  status: OfflineSaleStatus,
  lastError?: string,
) {
  return updateClaimedSale(tenantId, clientUuid, leaseId, (existing) => ({
    ...existing,
    status,
    last_error: lastError,
    ...(status === "syncing" ? {} : { sync_owner: undefined, lease_id: undefined, sync_started_at: undefined }),
    updated_at: nowIso(),
  }));
}

/** Roll back a claimed attempt without burning a retry, e.g. on 429. */
export async function rollbackOfflineSaleAttempt(
  tenantId: string,
  clientUuid: string,
  leaseId: string,
  lastError?: string,
) {
  return updateClaimedSale(tenantId, clientUuid, leaseId, (existing) => ({
    ...existing,
    status: "pending",
    last_error: lastError,
    attempt_count: Math.max(0, existing.attempt_count - 1),
    sync_owner: undefined,
    lease_id: undefined,
    sync_started_at: undefined,
    updated_at: nowIso(),
  }));
}

export async function markOfflineSaleSynced(
  tenantId: string,
  clientUuid: string,
  leaseId: string,
  orderId?: string,
) {
  return updateClaimedSale(tenantId, clientUuid, leaseId, (existing) => ({
    ...existing,
    status: "synced",
    last_error: undefined,
    synced_order_id: orderId,
    sync_owner: undefined,
    lease_id: undefined,
    sync_started_at: undefined,
    updated_at: nowIso(),
  }));
}

export async function markOfflineSaleFailed(tenantId: string, clientUuid: string, leaseId: string, error: string, errorCode?: string) {
  return updateClaimedSale(tenantId, clientUuid, leaseId, existing => ({ ...existing, status: "failed", last_error: error, last_error_code: errorCode,
    sync_owner: undefined, lease_id: undefined, sync_started_at: undefined, updated_at: nowIso() }));
}

export async function retryDeadLetter(tenantId: string, clientUuid: string) {
  return offlineDb.transaction("rw", offlineDb.offline_sales, async () => {
    const existing = await offlineDb.offline_sales.get(clientUuid);
    if (!isOwnedRow(existing, tenantId) || existing.status !== "failed") return false;
    await offlineDb.offline_sales.put({
      ...existing,
      status: "pending",
      last_error: undefined,
      // A deliberate retry starts a fresh bounded retry budget while keeping
      // the original UUID, tenant ownership and sale payload intact.
      attempt_count: 0,
      sync_owner: undefined,
      lease_id: undefined,
      sync_started_at: undefined,
      updated_at: nowIso(),
    });
    return true;
  });
}

export async function getDeadLetters(tenantId: string) {
  return offlineDb.offline_sales
    .where("[tenant_id+status]")
    .equals([tenantId, "failed"])
    .toArray() as Promise<OfflineSaleQueueItem[]>;
}

export async function getPendingOfflineSales(tenantId: string) {
  return offlineDb.offline_sales
    .where("[tenant_id+status]")
    .anyOf([[tenantId, "pending"], [tenantId, "failed"]])
    .toArray() as Promise<OfflineSaleQueueItem[]>;
}

/** Permanently remove only legacy rows whose tenant ownership cannot be
 * proven. Normal pending/failed/synced sales are never part of this query. */
export function discardQuarantinedSales(): Promise<number> {
  return offlineDb.offline_sales.where("status").equals("quarantined").delete();
}

/** Reclaims only expired leases belonging to this tenant. */
export async function recoverExpiredLeases(tenantId: string, nowMs = Date.now()) {
  const syncing = await offlineDb.offline_sales
    .where("[tenant_id+status]")
    .equals([tenantId, "syncing"])
    .toArray() as OfflineSaleQueueItem[];
  const expired = syncing.filter((row) => {
    const started = row.sync_started_at ? Date.parse(row.sync_started_at) : Number.NaN;
    return !Number.isFinite(started) || started + SYNC_LEASE_MS <= nowMs;
  });
  await offlineDb.transaction("rw", offlineDb.offline_sales, async () => {
    for (const candidate of expired) {
      const current = await offlineDb.offline_sales.get(candidate.client_uuid);
      if (
        isOwnedRow(current, tenantId) &&
        current.status === "syncing" &&
        current.lease_id === candidate.lease_id
      ) {
        await offlineDb.offline_sales.put({
          ...current,
          status: "pending",
          sync_owner: undefined,
          lease_id: undefined,
          sync_started_at: undefined,
          last_error: "Sincronización interrumpida; se reintentará.",
          updated_at: nowIso(),
        });
      }
    }
  });
  return expired.length;
}

/** Atomically leases a bounded pending batch so two tabs cannot send it together. */
export async function claimPendingOfflineSales(
  tenantId: string,
  ownerId: string,
  limit: number,
): Promise<OfflineSaleQueueItem[]> {
  await recoverExpiredLeases(tenantId);
  return offlineDb.transaction("rw", offlineDb.offline_sales, async () => {
    const candidates = await offlineDb.offline_sales
      .where("[tenant_id+status]")
      .equals([tenantId, "pending"])
      .limit(limit)
      .toArray() as OfflineSaleQueueItem[];
    const claimed: OfflineSaleQueueItem[] = [];
    for (const candidate of candidates) {
      const current = await offlineDb.offline_sales.get(candidate.client_uuid);
      if (!isOwnedRow(current, tenantId) || current.status !== "pending") continue;
      const leaseId = crypto.randomUUID();
      const updated: OfflineSaleQueueItem = {
        ...current,
        status: "syncing",
        sync_owner: ownerId,
        lease_id: leaseId,
        sync_started_at: nowIso(),
        attempt_count: current.attempt_count + 1,
        updated_at: nowIso(),
      };
      await offlineDb.offline_sales.put(updated);
      claimed.push(updated);
    }
    return claimed;
  });
}

/** Claims one known row for the foreground checkout path. */
export async function claimOfflineSale(
  tenantId: string,
  clientUuid: string,
  ownerId: string,
): Promise<OfflineSaleQueueItem | null> {
  return offlineDb.transaction("rw", offlineDb.offline_sales, async () => {
    const current = await offlineDb.offline_sales.get(clientUuid);
    if (!isOwnedRow(current, tenantId) || current.status !== "pending") return null;
    const updated: OfflineSaleQueueItem = {
      ...current,
      status: "syncing",
      sync_owner: ownerId,
      lease_id: crypto.randomUUID(),
      sync_started_at: nowIso(),
      attempt_count: current.attempt_count + 1,
      updated_at: nowIso(),
    };
    await offlineDb.offline_sales.put(updated);
    return updated;
  });
}

/** An explicit review supplements legacy sales; it never rewrites the original. */
export async function reconcileLegacyLots(tenantId: string, clientUuid: string, parts: Record<string, import("@/inventory/lots").LotAllocation[]>) {
  return offlineDb.transaction("rw", offlineDb.offline_sales, async () => {
    const row = await offlineDb.offline_sales.get(clientUuid);
    if (!isOwnedRow(row, tenantId) || row.status !== "failed") throw new Error("La venta cambió. Actualiza la cola antes de conciliar.");
    for (const [productId, allocations] of Object.entries(parts)) {
      const lines = row.sale.items.filter(item => item.product_id === productId);
      if (!lines.length || lines.some(item => item.lot_allocations !== undefined)) throw new Error("Los lotes cobrados no pueden sustituirse.");
      if (allocations.reduce((sum, part) => sum + part.quantity, 0) !== lines.reduce((sum, item) => sum + item.quantity, 0)) throw new Error("Asigna exactamente las unidades cobradas.");
    }
    await offlineDb.offline_sales.put({ ...row, lot_reconciliation: parts, updated_at: nowIso() });
  });
}
