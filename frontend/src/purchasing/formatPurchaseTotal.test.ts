import { expect, it } from "vitest";
import { formatPurchaseTotal } from "./formatPurchaseTotal";

it("preserves cents for large valid purchases and decimal quantities of money", () => {
  expect(formatPurchaseTotal([{ quantity: 3, unit_cost: "0.10" }])).toBe("$0.30");
  expect(formatPurchaseTotal([{ quantity: 2147483647, unit_cost: "9999999999.99" }])).toBe("$21,474,836,469,978,525,163.53");
});

it("does not show a misleading total while a cost is incomplete", () => {
  expect(formatPurchaseTotal([{ quantity: 2, unit_cost: "" }])).toBe("Completa las cantidades y los costos");
});
