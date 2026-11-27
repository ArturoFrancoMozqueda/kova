import { describe, expect, it } from "vitest";
import type { PurchaseItem } from "./api";
import { buildReceiveLines, openLines, receiveDifference } from "./receiveDifferences";

const line = (overrides: Partial<PurchaseItem> = {}): PurchaseItem => ({
  id: "item-1", product_id: "p-1", product_name: "Harina", quantity: 10, received_quantity: 4,
  unit_cost: "4.50", ...overrides,
});
const draft = (quantity: number, closeRemaining = false, reason = "") => ({ quantity, closeRemaining, reason });

describe("receiving differences", () => {
  it("classifies extra units and short closes against what is still pending", () => {
    expect(receiveDifference(line(), draft(6))).toBeNull();
    expect(receiveDifference(line(), draft(8))).toBe("over");
    expect(receiveDifference(line(), draft(3))).toBeNull();
    expect(receiveDifference(line(), draft(3, true))).toBe("short");
    expect(receiveDifference(line(), draft(6, true))).toBeNull();
  });

  it("sends the reason only with a difference and closes lines without new units", () => {
    const items = [line(), line({ id: "item-2", quantity: 5, received_quantity: 0 }), line({ id: "item-3" })];
    const { lines, missingReason } = buildReceiveLines(items, {
      "item-1": draft(8, false, "  Bonificación "),
      "item-2": draft(0, true, "Sin existencias"),
      "item-3": draft(0),
    });
    expect(missingReason).toBe(false);
    expect(lines).toEqual([
      { item_id: "item-1", quantity: 8, difference_reason: "Bonificación" },
      { item_id: "item-2", quantity: 0, close_remaining: true, difference_reason: "Sin existencias" },
    ]);
  });

  it("flags a difference that has no reason yet", () => {
    expect(buildReceiveLines([line()], { "item-1": draft(2, true, "  ") }).missingReason).toBe(true);
    expect(buildReceiveLines([line()], { "item-1": draft(2, false, "  ") }).missingReason).toBe(false);
  });

  it("does not offer closed or complete lines again", () => {
    expect(openLines([line({ closed_at: "2026-11-27T10:00:00Z" }), line({ received_quantity: 10 }), line()]).length).toBe(1);
  });
});
