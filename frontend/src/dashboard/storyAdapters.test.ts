import { describe, expect, it } from "vitest";

import type { BusinessStoryReport } from "@/reports/types";
import { paymentsFromStory, summaryFromStory, topProductsFromStory } from "./storyAdapters";

function storyFixture(overrides?: Partial<BusinessStoryReport>): BusinessStoryReport {
  return {
    summary: {
      start_date: "2026-07-11",
      end_date: "2026-07-18",
      timezone: "America/Mexico_City",
      net_sales: "880.00",
      gross_sales: "1000.00",
      refund_total: "120.00",
      completed_orders: 24,
      average_ticket: "36.67",
      refund_count: 2,
      cancellation_count: 1,
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

describe("summaryFromStory", () => {
  it("maps the story summary to the sales-summary shape (field renames)", () => {
    expect(summaryFromStory(storyFixture())).toEqual({
      start_date: "2026-07-11",
      end_date: "2026-07-18",
      gross_sales: "1000.00",
      refund_total: "120.00",
      net_sales: "880.00",
      order_count: 24,
      refund_count: 2,
      void_count: 1,
    });
  });
});

describe("paymentsFromStory", () => {
  it("keeps the payment rows and derives the breakdown totals", () => {
    const story = storyFixture({
      payment_mix: [
        {
          method: "cash",
          amount: "700.00",
          refunded_amount: "100.00",
          net_amount: "600.00",
          payment_count: 15,
          sales_share_pct: 70,
        },
        {
          method: "card",
          amount: "300.00",
          refunded_amount: "0.00",
          net_amount: "300.00",
          payment_count: 9,
          sales_share_pct: 30,
        },
      ],
    });
    expect(paymentsFromStory(story)).toEqual({
      start_date: "2026-07-11",
      end_date: "2026-07-18",
      payments: [
        {
          method: "cash",
          amount: "700.00",
          refunded_amount: "100.00",
          net_amount: "600.00",
          payment_count: 15,
        },
        {
          method: "card",
          amount: "300.00",
          refunded_amount: "0.00",
          net_amount: "300.00",
          payment_count: 9,
        },
      ],
      gross_total: "1000.00",
      // refund_total comes from the summary so legacy method-less refunds
      // still reduce the net, matching /reports/payment-breakdown.
      refund_total: "120.00",
      net_total: "880.00",
    });
  });

  it("handles an empty mix", () => {
    const result = paymentsFromStory(storyFixture());
    expect(result.payments).toEqual([]);
    expect(result.gross_total).toBe("0.00");
    expect(result.net_total).toBe("-120.00");
  });
});

describe("topProductsFromStory", () => {
  it("re-sorts by units (then gross) and caps at 5, like /reports/top-products", () => {
    const driver = (name: string, units: number, gross: string) => ({
      product_id: name,
      product_name: name,
      quantity_sold: units,
      gross_sales: gross,
      sales_share_pct: 0,
    });
    const story = storyFixture({
      // product_drivers arrives sorted by gross; expensive-but-rare first.
      product_drivers: [
        driver("pastel", 2, "760.00"),
        driver("empate-caro", 5, "90.00"),
        driver("empate-barato", 5, "60.00"),
        driver("cafe", 12, "420.00"),
        driver("galleta", 9, "162.00"),
        driver("atole", 4, "112.00"),
        driver("baguette", 3, "126.00"),
      ],
    });
    expect(topProductsFromStory(story).products.map((p) => p.product_name)).toEqual([
      "cafe",
      "galleta",
      "empate-caro",
      "empate-barato",
      "atole",
    ]);
    expect(topProductsFromStory(story).products[0]).toEqual({
      product_id: "cafe",
      product_name: "cafe",
      quantity_sold: 12,
      gross_sales: "420.00",
    });
  });
});
