import Dexie, { type EntityTable } from "dexie";
import type { CachedCatalog } from "./catalogCache";
import type { CachedCustomerOrders } from "@/customerOrders/cache";
import type { OfflineAccessSnapshot, StoredOfflineSaleQueueItem } from "./types";

export const offlineDb = new Dexie("pos_offline") as Dexie & {
  offline_sales: EntityTable<StoredOfflineSaleQueueItem, "client_uuid">;
  catalog_cache: EntityTable<CachedCatalog, "tenant_id">;
  customer_orders_cache: EntityTable<CachedCustomerOrders, "tenant_id">;
  offline_access: EntityTable<OfflineAccessSnapshot, "id">;
};

offlineDb.version(1).stores({
  offline_sales: "client_uuid,status,updated_at",
});

// v2 adds the cold-offline catalog cache. offline_sales is redeclared
// unchanged so Dexie keeps the existing queue store across the upgrade.
offlineDb.version(2).stores({
  offline_sales: "client_uuid,status,updated_at",
  catalog_cache: "tenant_id",
});

offlineDb.version(3).stores({
  offline_sales: "client_uuid,status,updated_at",
  catalog_cache: "tenant_id",
  customer_orders_cache: "tenant_id,cached_at",
});

// v4 introduces tenant-scoped queue indexes and recoverable sync leases. The
// primary key deliberately remains client_uuid because it is the idempotency
// identity already understood by the API. Existing rows have no trustworthy
// tenant source, so the migration preserves them in-place and quarantines them;
// assigning them to whichever user next signs in would risk a cross-tenant sale.
offlineDb.version(4).stores({
  offline_sales:
    "client_uuid,tenant_id,status,updated_at,[tenant_id+status],[tenant_id+updated_at],lease_id",
  catalog_cache: "tenant_id",
  customer_orders_cache: "tenant_id,cached_at",
}).upgrade(async (transaction) => {
  await transaction.table("offline_sales").toCollection().modify((row) => {
    if (!row.tenant_id) {
      row.status = "quarantined";
      row.last_error = "Venta de una versión anterior: requiere recuperación guiada.";
      delete row.sync_owner;
      delete row.lease_id;
      delete row.sync_started_at;
    }
  });
});

// v5 stores only a short-lived, non-credential identity snapshot. It lets a
// prepared register reopen its local catalog when the session endpoint is
// unreachable, while every server mutation remains blocked until revalidated.
offlineDb.version(5).stores({
  offline_sales:
    "client_uuid,tenant_id,status,updated_at,[tenant_id+status],[tenant_id+updated_at],lease_id",
  catalog_cache: "tenant_id",
  customer_orders_cache: "tenant_id,cached_at",
  offline_access: "id,tenant_id,expires_at",
});
