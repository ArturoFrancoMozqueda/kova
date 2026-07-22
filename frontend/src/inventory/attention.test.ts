import { describe, expect, it } from "vitest";
import { inventoryVelocityAttention, isActionableInventoryVelocity } from "./attention";
import type { InventoryVelocityItem } from "./types";

function velocity(days_until_out: string | null, stock_on_hand = 10): InventoryVelocityItem {
  return {
    product_id: "product-1",
    product_name: "Producto",
    units_per_day_7d: "1",
    days_until_out,
    stock_on_hand,
  };
}

describe("inventory attention", () => {
  it("ignores missing and long-horizon coverage", () => {
    expect(isActionableInventoryVelocity(velocity(null))).toBe(false);
    expect(isActionableInventoryVelocity(velocity("779"))).toBe(false);
    expect(isActionableInventoryVelocity(velocity("3094"))).toBe(false);
  });

  it("separates critical and weekly restock windows", () => {
    expect(inventoryVelocityAttention(velocity("3"))).toBe("critical");
    expect(inventoryVelocityAttention(velocity("6.2"))).toBe("restock");
    expect(inventoryVelocityAttention(velocity("8"))).toBeNull();
  });

  it("always treats depleted stock as critical", () => {
    expect(inventoryVelocityAttention(velocity(null, 0))).toBe("critical");
  });
});
