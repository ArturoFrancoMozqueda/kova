import { describe, expect, it } from "vitest";

import type { InventoryVelocityItem, StockItem } from "../../inventory/types";
import type { ProductTrendRow } from "../types";
import {
  calculateSafeGrowth,
  getInventoryStatus,
  salesByDayAverage,
  toneFromGrowth,
} from "./calculations";

describe("calculateSafeGrowth", () => {
  it("returns no-previous when previous is null", () => {
    expect(calculateSafeGrowth(100, null)).toEqual({ kind: "no-previous" });
  });

  it("returns new when previous is 0 and current is positive", () => {
    expect(calculateSafeGrowth(500, 0)).toEqual({ kind: "new" });
  });

  it("returns no-previous when both are 0", () => {
    expect(calculateSafeGrowth(0, 0)).toEqual({ kind: "no-previous" });
  });

  it("suppresses tiny-base percentages (the +4900% killer)", () => {
    // previous $10 → below the $500 money floor
    expect(calculateSafeGrowth(500, 10)).toEqual({ kind: "insufficient-base", from: 10, to: 500 });
  });

  it("respects a custom (count) min base", () => {
    expect(calculateSafeGrowth(9, 2, { minBase: 5 })).toEqual({
      kind: "insufficient-base",
      from: 2,
      to: 9,
    });
    // previous 6 clears the count floor of 5 → real percentage
    expect(calculateSafeGrowth(9, 6, { minBase: 5 })).toEqual({ kind: "pct", value: 50 });
  });

  it("returns flat when the rounded percentage is 0", () => {
    expect(calculateSafeGrowth(1000, 1000)).toEqual({ kind: "flat" });
  });

  it("computes normal up and down percentages", () => {
    expect(calculateSafeGrowth(1200, 1000)).toEqual({ kind: "pct", value: 20 });
    expect(calculateSafeGrowth(800, 1000)).toEqual({ kind: "pct", value: -20 });
  });

  it("caps extreme percentages to an absolute delta", () => {
    // previous clears the base floor but +900% is not representative
    expect(calculateSafeGrowth(10_000, 1_000)).toEqual({
      kind: "insufficient-base",
      from: 1_000,
      to: 10_000,
    });
  });

  it("derives tone from the growth result", () => {
    expect(toneFromGrowth({ kind: "pct", value: 12 })).toBe("up");
    expect(toneFromGrowth({ kind: "pct", value: -12 })).toBe("down");
    expect(toneFromGrowth({ kind: "flat" })).toBe("neutral");
    expect(toneFromGrowth({ kind: "new" })).toBe("up");
    expect(toneFromGrowth({ kind: "no-previous" })).toBe("neutral");
    expect(toneFromGrowth({ kind: "insufficient-base", from: 2, to: 9 })).toBe("up");
  });
});

describe("salesByDayAverage", () => {
  it("averages across all provided days, including zero-sales days", () => {
    const rows = [{ net_sales: "300" }, { net_sales: "0" }, { net_sales: "600" }];
    expect(salesByDayAverage(rows)).toBe(300);
  });

  it("returns 0 for an empty range", () => {
    expect(salesByDayAverage([])).toBe(0);
  });
});

function stock(overrides: Partial<StockItem> = {}): StockItem {
  return {
    product_id: "p1",
    product_name: "Café",
    sku: null,
    track_inventory: true,
    stock_on_hand: 20,
    low_stock_threshold: 5,
    is_low_stock: false,
    ...overrides,
  };
}

function velocity(overrides: Partial<InventoryVelocityItem> = {}): InventoryVelocityItem {
  return {
    product_id: "p1",
    product_name: "Café",
    units_per_day_7d: "2",
    days_until_out: "30",
    stock_on_hand: 20,
    ...overrides,
  };
}

function trendRow(overrides: Partial<ProductTrendRow> = {}): ProductTrendRow {
  return {
    product_id: "p1",
    product_name: "Café",
    current_units: 10,
    previous_units: 10,
    delta_units: 0,
    delta_pct: 0,
    current_gross: "100",
    previous_gross: "100",
    trend: "stable",
    ...overrides,
  };
}

describe("getInventoryStatus", () => {
  const base = { quantitySold: 10, salesSharePct: 5, driverCount: 8 };

  it("flags untracked products as sin-vincular with no stock verdict", () => {
    expect(
      getInventoryStatus({ ...base, tracked: false }),
    ).toEqual({ kind: "sin-vincular" });
  });

  it("prioritizes riesgo when out of stock with demand", () => {
    const status = getInventoryStatus({
      ...base,
      tracked: true,
      stock: stock({ stock_on_hand: 0 }),
      velocity: velocity({ stock_on_hand: 0, days_until_out: "0" }),
    });
    expect(status.kind).toBe("riesgo");
  });

  it("flags riesgo when days_until_out <= 3", () => {
    expect(
      getInventoryStatus({
        ...base,
        tracked: true,
        stock: stock({ stock_on_hand: 4 }),
        velocity: velocity({ days_until_out: "2" }),
      }).kind,
    ).toBe("riesgo");
  });

  it("lets low-stock win over a comfortable velocity", () => {
    expect(
      getInventoryStatus({
        ...base,
        tracked: true,
        stock: stock({ is_low_stock: true }),
        velocity: velocity({ days_until_out: "40" }),
      }).kind,
    ).toBe("reabastecer");
  });

  it("flags reabastecer when days_until_out <= 7", () => {
    expect(
      getInventoryStatus({
        ...base,
        tracked: true,
        stock: stock({ is_low_stock: false }),
        velocity: velocity({ days_until_out: "6" }),
      }).kind,
    ).toBe("reabastecer");
  });

  it("flags a star product by share", () => {
    expect(
      getInventoryStatus({
        tracked: true,
        stock: stock(),
        velocity: velocity(),
        quantitySold: 40,
        salesSharePct: 30,
        driverCount: 5,
      }).kind,
    ).toBe("estrella");
  });

  it("flags a declining product", () => {
    expect(
      getInventoryStatus({
        ...base,
        tracked: true,
        stock: stock(),
        velocity: velocity(),
        trend: trendRow({ trend: "declining", delta_pct: -40, previous_units: 20, current_units: 12 }),
      }).kind,
    ).toBe("en-caida");
  });

  it("flags a slow mover", () => {
    expect(
      getInventoryStatus({
        ...base,
        tracked: true,
        stock: stock(),
        velocity: velocity(),
        isSlowMover: true,
      }).kind,
    ).toBe("baja-rotacion");
  });

  it("falls back to estable for a healthy tracked product", () => {
    expect(
      getInventoryStatus({
        ...base,
        tracked: true,
        stock: stock(),
        velocity: velocity(),
      }).kind,
    ).toBe("estable");
  });
});
