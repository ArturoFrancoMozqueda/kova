import { describe, expect, it } from "vitest";
import { formatPurchaseQuantity, formatStockQuantity, isSellable } from "./units";

describe("stock units", () => {
  it("formats base units for people", () => {
    expect(formatStockQuantity(3)).toBe("3 pza");
    expect(formatStockQuantity(750, "ml")).toBe("750 ml");
    expect(formatStockQuantity(1500, "ml")).toBe("1.5 L");
    expect(formatStockQuantity(2250, "g")).toBe("2.25 kg");
    expect(formatStockQuantity(-1200, "g")).toBe("-1.2 kg");
  });

  it("shows purchase units with their stock equivalent", () => {
    expect(formatPurchaseQuantity(2, "Litro", 1000, "ml")).toBe("2 × Litro (2 L)");
    expect(formatPurchaseQuantity(5, null, 1)).toBe("5 pza");
  });

  it("treats rows cached by older bundles as sellable", () => {
    expect(isSellable({})).toBe(true);
    expect(isSellable({ is_sellable: false })).toBe(false);
  });
});
