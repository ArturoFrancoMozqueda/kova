export type SalesSummary = {
  start_date: string;
  end_date: string;
  gross_sales: string;
  refund_total: string;
  net_sales: string;
  order_count: number;
  refund_count: number;
  void_count: number;
};

export type PaymentBreakdown = {
  start_date: string;
  end_date: string;
  payments: Array<{
    method: string;
    amount: string;
    payment_count: number;
  }>;
};

export type TopProducts = {
  start_date: string;
  end_date: string;
  products: Array<{
    product_id: string;
    product_name: string;
    quantity_sold: number;
    gross_sales: string;
  }>;
};

export type SalesByHourRow = {
  hour: number;
  net_sales: string;
  order_count: number;
};

export type SalesByEmployeeRow = {
  user_id: string | null;
  display_name: string;
  order_count: number;
  net_sales: string;
  refund_count: number;
};

export type RefundsByReasonRow = {
  reason: string;
  refund_count: number;
  refunded_amount: string;
};

export type BusinessStoryDaypartKey = "madrugada" | "manana" | "tarde" | "noche";

export type BusinessStoryReport = {
  summary: {
    start_date: string;
    end_date: string;
    timezone: string;
    net_sales: string;
    gross_sales: string;
    refund_total: string;
    completed_orders: number;
    average_ticket: string;
    refund_count: number;
    cancellation_count: number;
  };
  executive_summary: string;
  sales_by_day: Array<{
    date: string;
    net_sales: string;
    order_count: number;
    average_ticket: string;
    sales_share_pct: number;
  }>;
  sales_by_daypart: Array<{
    key: BusinessStoryDaypartKey;
    label: string;
    start_hour: number;
    end_hour: number;
    net_sales: string;
    order_count: number;
    average_ticket: string;
    sales_share_pct: number;
  }>;
  peak_hour: {
    hour: number;
    label: string;
    daypart_key: BusinessStoryDaypartKey;
    net_sales: string;
    order_count: number;
    sales_share_pct: number;
  } | null;
  top_product_by_sales: {
    product_id: string;
    product_name: string;
    quantity_sold: number;
    gross_sales: string;
    sales_share_pct: number;
  } | null;
  top_product_by_units: {
    product_id: string;
    product_name: string;
    quantity_sold: number;
    gross_sales: string;
    sales_share_pct: number;
  } | null;
  product_drivers: Array<{
    product_id: string;
    product_name: string;
    quantity_sold: number;
    gross_sales: string;
    sales_share_pct: number;
  }>;
  dominant_payment: {
    method: string;
    amount: string;
    payment_count: number;
    sales_share_pct: number;
  } | null;
  payment_mix: Array<{
    method: string;
    amount: string;
    payment_count: number;
    sales_share_pct: number;
  }>;
  operational_signals: Array<{
    type: "good_signal" | "risk" | "operational_improvement";
    title: string;
    detail: string;
  }>;
  recommended_actions: Array<{
    type: "opportunity" | "risk" | "good_signal" | "operational_improvement";
    title: string;
    detail: string;
  }>;
  product_trends?: {
    growing: ProductTrendRow[];
    declining: ProductTrendRow[];
    slow_movers: ProductTrendRow[];
  };
  restock_alerts?: RestockAlertRow[];
  sales_by_employee: SalesByEmployeeRow[];
  employee_contribution?: {
    top: EmployeeContributionRow | null;
    rows: EmployeeContributionRow[];
    even_distribution: boolean;
  };
  refunds_by_reason: RefundsByReasonRow[];
};

export type ProductTrendRow = {
  product_id: string;
  product_name: string;
  current_units: number;
  previous_units: number;
  delta_units: number;
  delta_pct: number;
  current_gross: string;
  previous_gross: string;
  trend: "growing" | "declining" | "stable" | "new" | "lost";
};

export type RestockAlertRow = {
  product_id: string;
  product_name: string;
  stock_on_hand: number;
  low_stock_threshold: number;
  units_per_day_7d: string;
  days_until_out: string | null;
  severity: "critical" | "warning";
  detail: string;
};

export type EmployeeContributionRow = {
  user_id: string | null;
  display_name: string;
  order_count: number;
  net_sales: string;
  refund_count: number;
  sales_share_pct: number;
};
