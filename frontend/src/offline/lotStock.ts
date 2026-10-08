import { offlineDb } from "./db";
import { readLotSnapshot, type Lot, type LotAllocation, type LotSnapshot } from "@/inventory/lots";

export class LotQueueError extends Error {}

export type LotDebit = { client_uuid: string; allocations: LotAllocation[] };
export type CachedLotStock = { key: string; tenant_id: string; branch_id: string; snapshot: LotSnapshot; debits: LotDebit[] };
export const lotStockKey = (tenantId: string, branchId: string) => `${tenantId}:${branchId}`;

export function availableLots(cache: CachedLotStock): Lot[] {
  const consumed = new Map<string, number>();
  cache.debits.forEach(debit => debit.allocations.forEach(part => consumed.set(part.lot_id, (consumed.get(part.lot_id) ?? 0) + part.quantity)));
  return cache.snapshot.lots.map(lot => ({ ...lot, available_quantity: Math.max(0, lot.available_quantity - (consumed.get(lot.id) ?? 0)) }));
}
export async function readLocalLots(tenantId: string, branchId: string) {
  const cached = await offlineDb.lot_stock.get(lotStockKey(tenantId, branchId));
  return cached?.tenant_id === tenantId && cached.branch_id === branchId ? cached : undefined;
}
export async function refreshLocalLots(tenantId: string, branchId: string) {
  const before = await readLocalLots(tenantId, branchId);
  const queued = await offlineDb.offline_sales.where("tenant_id").equals(tenantId).toArray();
  const pending = queued.filter(row => row.status !== "quarantined" && row.status !== "synced" && (row.branch_id ?? tenantId) === branchId);
  const known = new Map((before?.debits ?? []).map(debit => [debit.client_uuid, debit]));
  for (const row of pending) {
    const allocations = [...row.sale.items.flatMap(item => item.lot_allocations ?? []), ...Object.values(row.lot_reconciliation ?? {}).flat()];
    if (allocations.length && !known.has(row.client_uuid)) known.set(row.client_uuid, { client_uuid: row.client_uuid, allocations });
  }
  if (known.size > 1000) throw new Error("Sincroniza las ventas pendientes antes de actualizar los lotes.");
  const snapshot = await readLotSnapshot([...known.keys()]);
  if (snapshot.branch_id !== branchId) throw new Error("La sucursal cambió. Vuelve a cargar sus lotes.");
  return offlineDb.transaction("rw", offlineDb.lot_stock, async () => {
    const latest = await readLocalLots(tenantId, branchId);
    if (latest && latest.snapshot.captured_at > snapshot.captured_at) return latest;
    const allDebits = new Map([...known.values(), ...(latest?.debits ?? [])].map(debit => [debit.client_uuid, debit]));
    const applied = new Set(snapshot.applied_client_uuids);
    const cache: CachedLotStock = { key: lotStockKey(tenantId, branchId), tenant_id: tenantId, branch_id: branchId, snapshot,
      debits: [...allDebits.values()].filter(debit => !applied.has(debit.client_uuid)) };
    await offlineDb.lot_stock.put(cache);
    return cache;
  });
}
