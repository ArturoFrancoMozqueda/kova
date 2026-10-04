import { describe, expect, it } from "vitest";

import { buildRestockPlan, inventoryProductLink, restockDecision } from "./restockPlan";
import type { InventoryVelocityItem, StockItem } from "./types";

const stock: StockItem = {
  product_id: "p1", product_name: "Leche", sku: null, track_inventory: true,
  stock_on_hand: 10, reserved_quantity: 4, available_quantity: 6,
  low_stock_threshold: 3, is_low_stock: false,
};
const velocity: InventoryVelocityItem = {
  product_id: "p1", product_name: "Leche", stock_on_hand: 10,
  units_per_day_7d: "2.00", days_until_out: "5.0",
};

describe("restock decisions", () => {
  it("subtracts available stock, not stock reserved for orders", () => {
    expect(restockDecision(stock, velocity, 7)).toMatchObject({
      available: 6, reserved: 4, targetUnits: 14, suggestedUnits: 8, coverageDays: 3,
    });
    expect(restockDecision(stock, velocity, 3).suggestedUnits).toBe(0);
    expect(restockDecision(stock, velocity, 14).suggestedUnits).toBe(22);
  });

  it("rounds fractional demand up to whole inventory units", () => {
    expect(restockDecision(stock, { ...velocity, units_per_day_7d: "2.01" }, 7))
      .toMatchObject({ targetUnits: 15, suggestedUnits: 9 });
  });

  it.each([undefined, "0", "-2", "NaN", "Infinity", "", " "])(
    "never fabricates demand from an unusable rate: %s", (rate) => {
      const result = restockDecision(stock,
        rate === undefined ? undefined : { ...velocity, units_per_day_7d: rate }, 7);
      expect(result.unitsPerDay).toBeNull();
      expect(result.suggestedUnits).toBeNull();
    },
  );

  it("requires a count for negative or inconsistent inventory instead of recommending a purchase", () => {
    expect(restockDecision({ ...stock, stock_on_hand: -2, available_quantity: 0 }, velocity, 7)
      .suggestedUnits).toBeNull();
    expect(restockDecision({ ...stock, available_quantity: 10 }, velocity, 7)
      .suggestedUnits).toBeNull();
    expect(restockDecision({ ...stock, reserved_quantity: NaN }, velocity, 7)
      .suggestedUnits).toBeNull();
  });

  it("does not turn an overflowing estimate into a purchase quantity", () => {
    expect(restockDecision(stock, { ...velocity, units_per_day_7d: "1e308" }, 14)
      .suggestedUnits).toBeNull();
  });

  it("plans for every tracked product, including products outside report top sellers", () => {
    const other = { ...stock, product_id: "p2", product_name: "Vasos", available_quantity: 0,
      stock_on_hand: 0, reserved_quantity: 0, is_low_stock: true };
    const plan = buildRestockPlan([stock, other, { ...stock, product_id: "untracked", track_inventory: false }],
      [velocity, { ...velocity, product_id: "p2", units_per_day_7d: "1" }], 7);
    expect(plan.items.map((item) => item.productId)).toEqual(["p2", "p1"]);
    expect(plan.trackedCount).toBe(2);
    expect(plan.unknownCount).toBe(0);
  });

  it("keeps low-stock products with no demand for review and counts unknown healthy products", () => {
    const plan = buildRestockPlan([stock, { ...stock, product_id: "p2", is_low_stock: true }], [], 7);
    expect(plan.unknownCount).toBe(2);
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0].suggestedUnits).toBeNull();
  });

  it("does not recommend buying when the chosen horizon is already covered", () => {
    expect(buildRestockPlan([stock], [velocity], 3).items).toEqual([]);
  });

  it("encodes the product identifier without adding unintended navigation parameters", () => {
    const link = new URL(inventoryProductLink("p&filter=low"), "https://example.test");
    expect(link.searchParams.get("product")).toBe("p&filter=low");
    expect(link.searchParams.has("filter")).toBe(false);
  });
});
