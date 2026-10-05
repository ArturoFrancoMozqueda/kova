import { offlineDb } from "@/offline/db";
import type { CustomerOrder, CustomerOrderListResponse } from "./types";

export type CachedCustomerOrders = {
  tenant_id: string;
  branch_id?: string;
  cached_at: string;
  list: CustomerOrderListResponse;
  details: Record<string, CustomerOrder>;
};

export async function saveCustomerOrderList(
  tenantId: string,
  list: CustomerOrderListResponse,
  branchId = tenantId,
): Promise<void> {
  const existing = await readCustomerOrderCache(tenantId, branchId);
  await offlineDb.customer_orders_cache.put({
    tenant_id: tenantId,
    branch_id: branchId,
    cached_at: new Date().toISOString(),
    list,
    details: existing?.details ?? {},
  });
}

export async function saveCustomerOrderDetail(
  tenantId: string,
  detail: CustomerOrder,
  branchId = tenantId,
): Promise<void> {
  const existing = await readCustomerOrderCache(tenantId, branchId);
  await offlineDb.customer_orders_cache.put({
    tenant_id: tenantId,
    branch_id: branchId,
    cached_at: new Date().toISOString(),
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
