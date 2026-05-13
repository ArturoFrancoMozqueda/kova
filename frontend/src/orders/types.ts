export type OrderItemModifier = {
  modifier_group_name: string;
  modifier_option_name: string;
  price_delta_amount: string;
};

export type OrderItem = {
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
};

export type Order = {
  id: string;
  tenant_id: string;
  status: "completed" | "voided";
  subtotal_amount: string;
  total_amount: string;
  items: OrderItem[];
  payments: Payment[];
};

export type OrderCreatePayload = {
  items: Array<{
    product_id: string;
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
};

export type ReceiptRefund = {
  id: string;
  reason: string;
  refunded_amount: string;
  created_at: string;
  items: ReceiptRefundItem[];
};

export type ReceiptVoid = {
  id: string;
  reason: string;
  created_at: string;
};

export type Receipt = {
  order_id: string;
  receipt_number: string;
  tenant_name: string;
  created_at: string;
  status: "completed" | "voided";
  items: Array<{
    product_name: string;
    quantity: number;
    unit_price_amount: string;
    line_total_amount: string;
  }>;
  subtotal_amount: string;
  total_amount: string;
  payments: Payment[];
  total_tendered: string;
  total_change: string;
  refunds: ReceiptRefund[];
  void: ReceiptVoid | null;
};

export type RefundPayload = {
  reason: string;
  items: Array<{ order_item_id: string; quantity: number }>;
};

export type OrderListItem = {
  id: string;
  status: string;
  subtotal_amount: string;
  total_amount: string;
  created_at: string;
};

export type OrderListResponse = {
  items: OrderListItem[];
  total: number;
  limit: number;
  offset: number;
};
