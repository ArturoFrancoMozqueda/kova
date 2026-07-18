export type OfflineSaleStatus = "pending" | "syncing" | "synced" | "failed";

export type OfflinePaymentDraft = {
  method: "cash" | "bank_transfer" | "manual_card";
  amount: string;
  amount_tendered?: string;
  reference?: string;
};

export type OfflineSaleDraft = {
  items: Array<{
    product_id: string;
    quantity: number;
    modifier_option_ids?: string[];
  }>;
  payments: OfflinePaymentDraft[];
};

export type OfflineReceiptSnapshot = {
  business_name: string;
  created_at: string;
  items: Array<{
    product_name: string;
    quantity: number;
    unit_price_amount: string;
    line_total_amount: string;
    modifiers: Array<{
      modifier_group_name: string;
      modifier_option_name: string;
      price_delta_amount: string;
    }>;
  }>;
  subtotal_amount: string;
  total_amount: string;
  payments: Array<{
    method: OfflinePaymentDraft["method"];
    amount_amount: string;
  }>;
  total_tendered: string;
  total_change: string;
};

export type OfflineSaleQueueItem = {
  client_uuid: string;
  status: OfflineSaleStatus;
  sale: OfflineSaleDraft;
  // Local-only printable snapshot. Never included in the sync API payload.
  // Optional so queue rows written by older PWA bundles remain compatible.
  receipt_snapshot?: OfflineReceiptSnapshot;
  // Shift open on this device when the sale was rung, so the backend can
  // attribute its cash to the right drawer. Optional: omitted when no shift
  // was open or the shift state was unknown at ring time.
  shift_id?: string;
  attempt_count: number;
  last_error?: string;
  synced_order_id?: string;
  created_at: string;
  updated_at: string;
};
