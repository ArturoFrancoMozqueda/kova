export type Quote = {
  id: string;
  folio: string;
  status: "draft" | "sent" | "accepted" | "expired" | "cancelled";
  customer_id: string;
  customer_name: string;
  expires_at: string;
  total_amount: string;
  version: number;
  customer_order_id: string | null;
  created_at: string;
  updated_at: string;
  items: {
    id: string;
    product_id: string;
    product_name: string;
    quantity: number;
    unit_price_amount: string;
    line_total_amount: string;
  }[];
};
export type QuotesPage = { items: Quote[]; total: number };
