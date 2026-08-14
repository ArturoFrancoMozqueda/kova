import { describe, expect, it } from "vitest";

import type { Product } from "@/catalog/types";
import { exactSkuMatches, skuSearchMatches } from "./skuSearch";

const product = (id: string, name: string, sku: string | null): Product => ({
  id,
  tenant_id: "tenant-1",
  category_id: null,
  name,
  description: null,
  sku,
  price_amount: "10.00",
  track_inventory: false,
  low_stock_threshold: null,
  image_url: null,
  image_position_x: 50,
  image_position_y: 50,
  image_zoom: 1,
  is_active: true,
  modifier_groups: [],
});

const products = [
  product("one", "Concha", "PAN-001"),
  product("two", "Pan integral", "PAN-002"),
];

describe("SKU scanner matching", () => {
  it("normalizes a keyboard-wedge scan without weakening exact SKU priority", () => {
    expect(exactSkuMatches(products, "  pan-001 ")).toEqual([products[0]]);
    expect(skuSearchMatches(products, "PAN-001")).toEqual([products[0]]);
  });

  it("returns every duplicate exact match instead of choosing an ambiguous product", () => {
    const duplicate = product("duplicate", "Concha grande", "pan-001");
    expect(skuSearchMatches([...products, duplicate], "PAN-001")).toEqual([
      products[0],
      duplicate,
    ]);
  });

  it("falls back to partial SKU or name matching and returns no matches safely", () => {
    expect(skuSearchMatches(products, "integral")).toEqual([products[1]]);
    expect(skuSearchMatches(products, "missing")).toEqual([]);
  });
});
