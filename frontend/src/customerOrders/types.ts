import type { Order, OrderCreatePayload } from "@/orders/types";

export type CustomerOrderStatus =
  | "new"
  | "confirmed"
  | "in_progress"
  | "ready"
  | "fulfilled"
  | "cancelled";

export type CustomerOrderPaymentStatus =
  | "unpaid"
  | "paid"
  | "partially_refunded"
  | "refunded"
  | "voided";

export type FulfillmentType = "pickup" | "delivery";
export type SourceChannel = "counter" | "phone_whatsapp" | "other";

export type CustomerOrderModifier = {
  id: string;
  modifier_group_id: string;
  modifier_group_name: string;
  modifier_option_id: string;
  modifier_option_name: string;
  price_delta_amount: string;
};

export type CustomerOrderItem = {
  id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price_amount: string;
  line_total_amount: string;
  note: string | null;
  modifier_option_ids: string[];
  modifiers: CustomerOrderModifier[];
};

export type CustomerOrder = {
  id: string;
  tenant_id: string;
  folio: string;
  status: CustomerOrderStatus;
  payment_status: CustomerOrderPaymentStatus;
  fulfillment_type: FulfillmentType;
  source_channel: SourceChannel;
  customer_name: string | null;
  customer_phone: string | null;
  delivery_address: string | null;
  delivery_reference: string | null;
  promised_at: string | null;
  note: string | null;
  subtotal_amount: string;
  total_amount: string;
  sale_order_id: string | null;
  version: number;
  stock_conflict: boolean;
  items: CustomerOrderItem[];
  confirmed_at: string | null;
  ready_at: string | null;
  fulfilled_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  cancellation_note: string | null;
  created_at: string;
  updated_at: string;
};

export type CustomerOrderListItem = Pick<
  CustomerOrder,
  | "id"
  | "folio"
  | "status"
  | "payment_status"
  | "fulfillment_type"
  | "customer_name"
  | "customer_phone"
  | "promised_at"
  | "total_amount"
  | "stock_conflict"
  | "created_at"
  | "updated_at"
>;

export type CustomerOrderListResponse = {
  items: CustomerOrderListItem[];
  total: number;
  limit: number;
  offset: number;
  status_counts: Record<CustomerOrderStatus, number>;
};

export type CustomerOrderItemInput = {
  id?: string;
  product_id: string;
  quantity: number;
  modifier_option_ids: string[];
  note?: string | null;
};

export type CustomerOrderInput = {
  fulfillment_type: FulfillmentType;
  source_channel: SourceChannel;
  customer_name?: string | null;
  customer_phone?: string | null;
  delivery_address?: string | null;
  delivery_reference?: string | null;
  promised_at?: string | null;
  note?: string | null;
  items: CustomerOrderItemInput[];
};

export type CustomerOrderFilters = {
  search?: string;
  status?: CustomerOrderStatus;
  payment_status?: CustomerOrderPaymentStatus;
  fulfillment_type?: FulfillmentType;
  promised_from?: string;
  promised_to?: string;
  limit?: number;
  offset?: number;
};

export type CustomerOrderCheckoutResponse = {
  customer_order: CustomerOrder;
  sale_order: Order;
};

export type CustomerOrderPayments = OrderCreatePayload["payments"];
