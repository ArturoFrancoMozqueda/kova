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
