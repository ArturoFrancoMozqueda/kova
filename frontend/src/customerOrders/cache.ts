import { offlineDb } from "@/offline/db";
import type { CustomerOrder, CustomerOrderListResponse } from "./types";

export type CachedCustomerOrders = {
  tenant_id: string;
  branch_id?: string;
  cached_at: string;
  // Legacy cached_at could describe a different record; never infer freshness.
  list_cached_at?: string | null;
  detail_cached_at?: Record<string, string>;
  list: CustomerOrderListResponse;
  details: Record<string, CustomerOrder>;
};

export async function saveCustomerOrderList(
  tenantId: string,
  list: CustomerOrderListResponse,
  branchId = tenantId,
): Promise<void> {
  await offlineDb.transaction("rw", offlineDb.customer_orders_cache, async () => {
    const existing = await readCustomerOrderCache(tenantId, branchId);
    const cachedAt = new Date().toISOString();
    await offlineDb.customer_orders_cache.put({
      tenant_id: tenantId,
      branch_id: branchId,
      cached_at: cachedAt,
      list_cached_at: cachedAt,
      detail_cached_at: existing?.detail_cached_at ?? {},
      list,
      details: existing?.details ?? {},
    });
  });
}

export async function saveCustomerOrderDetail(
  tenantId: string,
  detail: CustomerOrder,
  branchId = tenantId,
): Promise<void> {
  await offlineDb.transaction("rw", offlineDb.customer_orders_cache, async () => {
    const existing = await readCustomerOrderCache(tenantId, branchId);
    const cachedAt = new Date().toISOString();
    await offlineDb.customer_orders_cache.put({
      tenant_id: tenantId,
      branch_id: branchId,
      cached_at: cachedAt,
      list_cached_at: existing?.list_cached_at ?? null,
      detail_cached_at: { ...(existing?.detail_cached_at ?? {}), [detail.id]: cachedAt },
      list: existing?.list ?? {
        items: [],
        total: 0,
        limit: 0,
        offset: 0,
        status_counts: {
          new: 0,
          confirmed: 0,
          in_progress: 0,
          ready: 0,
          fulfilled: 0,
          cancelled: 0,
        },
      },
      details: { ...(existing?.details ?? {}), [detail.id]: detail },
    });
  });
}

export async function readCustomerOrderCache(
  tenantId: string,
  branchId = tenantId,
): Promise<CachedCustomerOrders | undefined> {
  const cached = await offlineDb.customer_orders_cache.get(tenantId);
  return cached && (cached.branch_id ?? tenantId) === branchId
    ? cached
    : undefined;
}

export async function clearCustomerOrderCache(): Promise<void> {
  await offlineDb.customer_orders_cache.clear();
}
