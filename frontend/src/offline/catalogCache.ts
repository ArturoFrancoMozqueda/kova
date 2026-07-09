import type { Category, Product } from "../catalog/types";
import { offlineDb } from "./db";

// Catalog snapshot persisted so the register can open and ring sales on a cold
// offline start. Keyed by tenant_id and cleared on logout so one tenant's
// catalog can never be read by another on a shared device.
export type CachedCatalog = {
  tenant_id: string;
  products: Product[];
  categories: Category[];
  cached_at: string;
};

export async function saveCatalogCache(
  tenantId: string,
  products: Product[],
  categories: Category[]
): Promise<void> {
  await offlineDb.catalog_cache.put({
    tenant_id: tenantId,
    products,
    categories,
    cached_at: new Date().toISOString(),
  });
}

export async function readCatalogCache(tenantId: string): Promise<CachedCatalog | undefined> {
  return offlineDb.catalog_cache.get(tenantId);
}

/** Wipe every tenant's cached catalog — call on logout / tenant switch. */
export async function clearCatalogCache(): Promise<void> {
  await offlineDb.catalog_cache.clear();
}
