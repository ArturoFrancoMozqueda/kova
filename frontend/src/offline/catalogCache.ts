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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseCachedCatalog(value: unknown, tenantId: string): CachedCatalog | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.tenant_id === "string" && value.tenant_id !== tenantId) {
    return undefined;
  }
  if (!Array.isArray(value.products) || !Array.isArray(value.categories)) {
    return undefined;
  }

  return {
    tenant_id: typeof value.tenant_id === "string" ? value.tenant_id : tenantId,
    products: value.products as Product[],
    categories: value.categories as Category[],
    cached_at: typeof value.cached_at === "string" ? value.cached_at : "",
  };
}

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
  const value: unknown = await offlineDb.catalog_cache.get(tenantId);
  const cached = parseCachedCatalog(value, tenantId);
  if (!cached && value !== undefined) {
    await offlineDb.catalog_cache.delete(tenantId).catch(() => undefined);
  }
  return cached;
}

/** Wipe every tenant's cached catalog — call on logout / tenant switch. */
export async function clearCatalogCache(): Promise<void> {
  await offlineDb.catalog_cache.clear();
}
