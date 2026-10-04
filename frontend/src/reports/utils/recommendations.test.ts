import { describe, expect, it } from "vitest";

import type { InventoryVelocityItem, StockItem } from "../../inventory/types";
import type { BusinessStoryReport } from "../types";
import { buildRecommendations, type RecommendationInput } from "./recommendations";

function makeStory(overrides: Partial<BusinessStoryReport> = {}): BusinessStoryReport {
  return {
    summary: {
      start_date: "2026-07-01",
      end_date: "2026-07-07",
      timezone: "America/Mexico_City",
      net_sales: "10000",
      gross_sales: "10000",
      refund_total: "0",
      completed_orders: 100,
      average_ticket: "100",
      refund_count: 0,
      cancellation_count: 0,
    },
    executive_summary: "",
    sales_by_day: [],
    sales_by_daypart: [],
    peak_hour: null,
    top_product_by_sales: null,
    top_product_by_units: null,
    product_drivers: [],
    dominant_payment: null,
    payment_mix: [],
    operational_signals: [],
    recommended_actions: [],
    sales_by_employee: [],
    refunds_by_reason: [],
    ...overrides,
  };
}

function emptyInput(story: BusinessStoryReport, previous: BusinessStoryReport | null): RecommendationInput {
  return {
    story,
    previousStory: previous,
    trackedIds: new Set<string>(),
    stockByProduct: new Map<string, StockItem>(),
    velocityByProduct: new Map<string, InventoryVelocityItem>(),
    rangeDays: 7,
  };
}

const ids = (input: RecommendationInput) => buildRecommendations(input).map((r) => r.id);

describe("buildRecommendations", () => {
  it("fires R1 on a >=15% sales drop with a comparable previous period", () => {
    const story = makeStory({ summary: { ...makeStory().summary, net_sales: "8000" } });
    const previous = makeStory({ summary: { ...makeStory().summary, net_sales: "10000" } });
    expect(ids(emptyInput(story, previous))).toContain("R1");
  });

  it("does not fire R1 when the previous period is not comparable (too few orders)", () => {
    const story = makeStory({ summary: { ...makeStory().summary, net_sales: "8000" } });
    const previous = makeStory({
      summary: { ...makeStory().summary, net_sales: "10000", completed_orders: 2 },
    });
    expect(ids(emptyInput(story, previous))).not.toContain("R1");
  });

  it("does not claim products are untracked when the inventory request failed", () => {
    const story = makeStory({ product_drivers: [{
      product_id: "p1", product_name: "Leche", quantity_sold: 42,
      gross_sales: "1260", sales_share_pct: 30,
    }] });
    const input = { ...emptyInput(story, null), inventoryAvailable: false };
    expect(ids(input)).not.toContain("R5");
  });

  it("fires R2 for a top driver about to run out and skips R4 for it", () => {
    const story = makeStory({
      product_drivers: [
        { product_id: "p1", product_name: "Coca", quantity_sold: 42, gross_sales: "1260", sales_share_pct: 30 },
      ],
    });
    const input = emptyInput(story, null);
    input.trackedIds = new Set(["p1"]);
    input.stockByProduct = new Map([
      ["p1", { product_id: "p1", product_name: "Coca", sku: null, track_inventory: true, stock_on_hand: 6, reserved_quantity: 0, available_quantity: 6, low_stock_threshold: 10, is_low_stock: true }],
    ]);
    input.velocityByProduct = new Map([
      ["p1", { product_id: "p1", product_name: "Coca", units_per_day_7d: "6", days_until_out: "1", stock_on_hand: 6 }],
    ]);
    const result = ids(input);
    expect(result).toContain("R2");
    expect(result).not.toContain("R4");
  });

  it("fires R3 on a high refund rate but never on a single small refund", () => {
    const spike = makeStory({
      summary: { ...makeStory().summary, refund_total: "800", refund_count: 6, gross_sales: "10000" },
    });
    expect(ids(emptyInput(spike, null))).toContain("R3");

    const lone = makeStory({
      summary: { ...makeStory().summary, refund_total: "80", refund_count: 1, gross_sales: "10000" },
    });
    expect(ids(emptyInput(lone, null))).not.toContain("R3");
  });

  it("fires R6 only when cash dominates with enough transactions", () => {
    const cashHeavy = makeStory({
      payment_mix: [
        { method: "cash", amount: "8000", refunded_amount: "0", net_amount: "8000", payment_count: 80, sales_share_pct: 80 },
        { method: "manual_card", amount: "2000", refunded_amount: "0", net_amount: "2000", payment_count: 20, sales_share_pct: 20 },
      ],
    });
    expect(ids(emptyInput(cashHeavy, null))).toContain("R6");

    const cashLowVolume = makeStory({
      payment_mix: [{ method: "cash", amount: "800", refunded_amount: "0", net_amount: "800", payment_count: 5, sales_share_pct: 90 }],
    });
    expect(ids(emptyInput(cashLowVolume, null))).not.toContain("R6");
  });

  it("aggregates >=3 declining products into a single R7 card", () => {
    const declining = Array.from({ length: 3 }, (_, i) => ({
      product_id: `d${i}`,
      product_name: `Producto ${i}`,
      current_units: 2,
      previous_units: 20,
      delta_units: -18,
      delta_pct: -90,
      current_gross: "20",
      previous_gross: "200",
      trend: "declining" as const,
    }));
    const story = makeStory({ product_trends: { growing: [], declining, slow_movers: [] } });
    const result = buildRecommendations(emptyInput(story, null)).filter((r) => r.id === "R7");
    expect(result).toHaveLength(1);
    expect(result[0].subjectId).toBe("declining-multi");
  });

  it("aggregates R11 into one card when three or more new products start well", () => {
    const growing = ["p1", "p2", "p3", "p4"].map((id, index) => ({
      product_id: id,
      product_name: `Nuevo ${index + 1}`,
      current_units: 16 - index,
      previous_units: 0,
      delta_units: 16 - index,
      delta_pct: 100,
      current_gross: "400",
      previous_gross: "0",
      trend: "new" as const,
    }));
    const story = makeStory({ product_trends: { growing, declining: [], slow_movers: [] } });
    const result = buildRecommendations(emptyInput(story, null)).filter((r) => r.id === "R11");
    expect(result).toHaveLength(1);
    expect(result[0].subjectId).toBe("new-products-multi");
    expect(result[0].finding).toContain("4 productos nuevos");
  });

  it("keeps per-product R11 cards below the aggregation threshold", () => {
    const growing = ["p1", "p2"].map((id, index) => ({
      product_id: id,
      product_name: `Nuevo ${index + 1}`,
      current_units: 12,
      previous_units: 0,
      delta_units: 12,
      delta_pct: 100,
      current_gross: "300",
      previous_gross: "0",
      trend: "new" as const,
    }));
    const story = makeStory({ product_trends: { growing, declining: [], slow_movers: [] } });
    const result = buildRecommendations(emptyInput(story, null)).filter((r) => r.id === "R11");
    expect(result).toHaveLength(2);
  });

  it("fires R13 (clean ops) as a low-priority good signal", () => {
    const story = makeStory();
    const result = buildRecommendations(emptyInput(story, null));
    const clean = result.find((r) => r.id === "R13");
    expect(clean?.priority).toBe("baja");
    expect(clean?.tone).toBe("good_signal");
  });

  it("orders high priority before medium and low", () => {
    const story = makeStory({
      summary: { ...makeStory().summary, net_sales: "8000", refund_total: "800", refund_count: 6 },
      payment_mix: [{ method: "cash", amount: "8000", refunded_amount: "0", net_amount: "8000", payment_count: 80, sales_share_pct: 80 }],
    });
    const previous = makeStory({ summary: { ...makeStory().summary, net_sales: "10000" } });
    const result = buildRecommendations(emptyInput(story, previous));
    const priorities = result.map((r) => r.priority);
    const firstMedium = priorities.indexOf("media");
    const firstAlta = priorities.indexOf("alta");
    expect(firstAlta).toBeLessThan(firstMedium);
  });
});
