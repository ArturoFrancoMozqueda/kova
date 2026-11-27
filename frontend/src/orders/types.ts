export type OrderItemModifier = {
  modifier_group_name: string;
  modifier_option_name: string;
  price_delta_amount: string;
};

export type LoyaltyRewardSnapshot = { id: string; title: string; points_cost: number; discount_amount: string };

export type OrderItem = {
  lot_tracked?: boolean;
  /** Reads of a saved sale say whether checkout took this line out of stock. */
  stock_consumed?: boolean | null;
  lot_allocations?: (import("@/inventory/lots").LotAllocation & { code?: string })[];
  id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price_amount: string;
  line_total_amount: string;
  modifiers: OrderItemModifier[];
};

export type Payment = {
  id?: string;
  method: "cash" | "bank_transfer" | "manual_card";
  amount_amount: string;
  amount_tendered_amount: string | null;
  change_due_amount: string;
  reference: string | null;
  /** Collected earlier as a customer order deposit and applied to this sale. */
  deposit_applied?: boolean;
};

export type Order = {
  customer_id?: string | null;
  loyalty_reward?: LoyaltyRewardSnapshot | null;
  id: string;
  tenant_id: string;
  branch_id?: string;
  status: "completed" | "voided";
  discount_amount?: string;
  tax_rate?: string;
  tax_amount?: string;
  subtotal_amount: string;
  total_amount: string;
  items: OrderItem[];
  payments: Payment[];
};

export type OrderCreatePayload = {
  customer_id?: string;
  discount_amount?: string;
  tax_rate?: string;
  items: Array<{
    product_id: string;
    unit_price_amount?: string;
    quantity: number;
  }>;
  payments: Array<{
    method: "cash" | "bank_transfer" | "manual_card";
    amount: string;
    amount_tendered?: string | null;
    reference?: string | null;
  }>;
};

export type ReceiptRefundItem = {
  order_item_id: string;
  quantity: number;
  unit_price_amount: string;
  line_total_amount: string;
  /** Units put back in stock; null for refunds recorded before this was kept. */
  restocked_quantity?: number | null;
};

export type ReceiptRefund = {
  id: string;
  reason: string;
  refunded_amount: string;
  created_at: string;
  items: ReceiptRefundItem[];
  payments?: RefundPaymentAllocation[];
};

export type ReceiptVoid = {
  id: string;
  reason: string;
  created_at: string;
};

export type Receipt = {
  loyalty_reward?: LoyaltyRewardSnapshot | null;
  order_id: string;
  receipt_number: string;
  /** Daily number to call the customer when the order is ready. */
  prep_number?: number | null;
  tenant_name: string;
  paper_width_mm?: import("@/lib/receiptPaper").ReceiptPaperWidth;
  created_at: string;
  status: "completed" | "voided";
  items: Array<{
    product_name: string;
    quantity: number;
    unit_price_amount: string;
    line_total_amount: string;
    modifiers: OrderItemModifier[];
  }>;
  discount_amount?: string;
  tax_rate?: string;
  tax_amount?: string;
  subtotal_amount: string;
  total_amount: string;
  payments: Payment[];
  total_tendered: string;
  total_change: string;
  refunds: ReceiptRefund[];
  void: ReceiptVoid | null;
};

export type RefundPaymentAllocation = {
  method: "cash" | "bank_transfer" | "manual_card";
  amount: string;
};

export type RefundPayload = {
  reason: string;
  refund_payment_method?: "cash" | "bank_transfer" | "manual_card";
  refund_payments?: RefundPaymentAllocation[];
  /** `restock` is omitted for lines without stock, keeping older payloads intact. */
  items: Array<{ order_item_id: string; quantity: number; restock?: boolean }>;
};

export type OrderListItem = {
  id: string;
  status: string;
  discount_amount?: string;
  tax_rate?: string;
  tax_amount?: string;
  subtotal_amount: string;
  total_amount: string;
  created_at: string;
  /** Ticket folio (last eight characters of the receipt), as printed. */
  receipt_number?: string;
  customer_name?: string | null;
};

export type OrderListResponse = {
  items: OrderListItem[];
  total: number;
  limit: number;
  offset: number;
};
