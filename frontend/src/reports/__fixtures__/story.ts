import type { BusinessStoryReport } from "../types";

/** Minimal but valid BusinessStoryReport for component tests. Override any slice
 * via `overrides`; nested objects should be spread by the caller as needed. */
export function makeStory(overrides: Partial<BusinessStoryReport> = {}): BusinessStoryReport {
  const base: BusinessStoryReport = {
    summary: {
      start_date: "2026-07-01",
      end_date: "2026-07-07",
      timezone: "America/Mexico_City",
      net_sales: "10000",
      gross_sales: "10500",
      refund_total: "500",
      completed_orders: 100,
      average_ticket: "100",
      refund_count: 0,
      cancellation_count: 0,
    },
    executive_summary: "",
    sales_by_day: [
      { date: "2026-07-01", net_sales: "1200", order_count: 12, average_ticket: "100", sales_share_pct: 12 },
      { date: "2026-07-05", net_sales: "4210", order_count: 40, average_ticket: "105", sales_share_pct: 42 },
    ],
    sales_by_daypart: [
      { key: "manana", label: "Mañana", start_hour: 6, end_hour: 11, net_sales: "3000", order_count: 30, average_ticket: "100", sales_share_pct: 30 },
      { key: "tarde", label: "Tarde", start_hour: 12, end_hour: 17, net_sales: "5000", order_count: 50, average_ticket: "100", sales_share_pct: 50 },
      { key: "noche", label: "Noche", start_hour: 18, end_hour: 23, net_sales: "2000", order_count: 20, average_ticket: "100", sales_share_pct: 20 },
    ],
    peak_hour: { hour: 13, label: "13:00–14:00", daypart_key: "tarde", net_sales: "2500", order_count: 25, sales_share_pct: 25 },
    top_product_by_sales: { product_id: "p1", product_name: "Latte mediano", quantity_sold: 40, gross_sales: "4000", sales_share_pct: 40 },
    top_product_by_units: null,
    product_drivers: [
      { product_id: "p1", product_name: "Latte mediano", quantity_sold: 40, gross_sales: "4000", sales_share_pct: 40 },
    ],
    dominant_payment: { method: "cash", amount: "6700", payment_count: 67, sales_share_pct: 67 },
    payment_mix: [
      { method: "cash", amount: "6700", payment_count: 67, sales_share_pct: 67 },
      { method: "card", amount: "3300", payment_count: 33, sales_share_pct: 33 },
    ],
    operational_signals: [],
    recommended_actions: [],
    sales_by_employee: [],
    refunds_by_reason: [],
  };
  return { ...base, ...overrides };
}
