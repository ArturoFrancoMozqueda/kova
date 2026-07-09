import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Category, Product } from "../catalog/types";

const catalogCacheStore = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
  clear: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("./db", () => ({
  offlineDb: {
    catalog_cache: catalogCacheStore,
  },
}));

import { readCatalogCache } from "./catalogCache";

const product: Product = {
  id: "product-1",
  tenant_id: "tenant-1",
  category_id: null,
  name: "Concha",
  description: null,
  sku: "PAN-001",
  price_amount: "50.00",
  track_inventory: false,
  low_stock_threshold: 0,
  image_url: null,
  image_position_x: 50,
  image_position_y: 50,
  image_zoom: 1,
  is_active: true,
  modifier_groups: [],
};

const category: Category = {
  id: "category-1",
  tenant_id: "tenant-1",
  name: "Pan dulce",
  description: null,
  sort_order: 0,
  is_active: true,
};

describe("readCatalogCache", () => {
  beforeEach(() => {
    catalogCacheStore.get.mockReset();
    catalogCacheStore.put.mockReset();
    catalogCacheStore.clear.mockReset();
    catalogCacheStore.delete.mockReset();
    catalogCacheStore.delete.mockResolvedValue(undefined);
  });

  it("returns a valid cached catalog", async () => {
    const cached = {
      tenant_id: "tenant-1",
      products: [product],
      categories: [category],
      cached_at: "2026-07-09T16:30:00.000Z",
    };
    catalogCacheStore.get.mockResolvedValue(cached);

    await expect(readCatalogCache("tenant-1")).resolves.toEqual(cached);
    expect(catalogCacheStore.delete).not.toHaveBeenCalled();
  });

  it("drops corrupt cache when products is not an array", async () => {
    catalogCacheStore.get.mockResolvedValue({
      tenant_id: "tenant-1",
      products: { data: [product] },
      categories: [category],
      cached_at: "2026-07-09T16:30:00.000Z",
    });

    await expect(readCatalogCache("tenant-1")).resolves.toBeUndefined();
    expect(catalogCacheStore.delete).toHaveBeenCalledWith("tenant-1");
  });

  it("drops corrupt cache when categories is not an array", async () => {
    catalogCacheStore.get.mockResolvedValue({
      tenant_id: "tenant-1",
      products: [product],
      categories: { data: [category] },
      cached_at: "2026-07-09T16:30:00.000Z",
    });

    await expect(readCatalogCache("tenant-1")).resolves.toBeUndefined();
    expect(catalogCacheStore.delete).toHaveBeenCalledWith("tenant-1");
  });
});
