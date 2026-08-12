import Dexie, { type EntityTable } from "dexie";
import type { CachedCatalog } from "./catalogCache";
import type { CachedCustomerOrders } from "@/customerOrders/cache";
import type { OfflineSaleQueueItem } from "./types";

export const offlineDb = new Dexie("pos_offline") as Dexie & {
  offline_sales: EntityTable<OfflineSaleQueueItem, "client_uuid">;
  catalog_cache: EntityTable<CachedCatalog, "tenant_id">;
  customer_orders_cache: EntityTable<CachedCustomerOrders, "tenant_id">;
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
