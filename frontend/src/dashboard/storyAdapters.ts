import type {
  BusinessStoryReport,
  PaymentBreakdown,
  SalesSummary,
  TopProducts,
} from "@/reports/types";

// business-story already contains the sales summary, the payment mix and the
// product drivers the Panel used to fetch from three extra endpoints. These
// adapters reshape the story into those endpoints' exact response shapes so
// the Panel saves three requests (and the backend three aggregation passes)
// per load without touching any child component.

function toCents(value: string): number {
  return Math.round(Number(value) * 100);
}

function fromCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function summaryFromStory(story: BusinessStoryReport): SalesSummary {
  const { summary } = story;
  return {
    start_date: summary.start_date,
    end_date: summary.end_date,
    gross_sales: summary.gross_sales,
    refund_total: summary.refund_total,
    net_sales: summary.net_sales,
    order_count: summary.completed_orders,
    refund_count: summary.refund_count,
    void_count: summary.cancellation_count,
  };
}

export function paymentsFromStory(story: BusinessStoryReport): PaymentBreakdown {
  const payments = story.payment_mix.map((row) => ({
    method: row.method,
    amount: row.amount,
    refunded_amount: row.refunded_amount,
    net_amount: row.net_amount,
    payment_count: row.payment_count,
  }));
  // Same definitions as /reports/payment-breakdown: gross collected across
  // methods; refunds (including legacy method-less ones) come from the
  // summary; net reconciles the two.
  const grossCents = payments.reduce((total, row) => total + toCents(row.amount), 0);
  const refundCents = toCents(story.summary.refund_total);
  return {
    start_date: story.summary.start_date,
    end_date: story.summary.end_date,
    payments,
    gross_total: fromCents(grossCents),
    refund_total: story.summary.refund_total,
    net_total: fromCents(grossCents - refundCents),
  };
}

export function topProductsFromStory(story: BusinessStoryReport): TopProducts {
  // /reports/top-products orders by units (then gross) and defaults to 5;
  // product_drivers comes ordered by gross, so re-sort to keep the same list.
  const products = [...story.product_drivers]
    .sort(
      (a, b) =>
        b.quantity_sold - a.quantity_sold || toCents(b.gross_sales) - toCents(a.gross_sales),
    )
    .slice(0, 5)
    .map((row) => ({
      product_id: row.product_id,
      product_name: row.product_name,
      quantity_sold: row.quantity_sold,
      gross_sales: row.gross_sales,
    }));
  return {
    start_date: story.summary.start_date,
    end_date: story.summary.end_date,
    products,
  };
}
