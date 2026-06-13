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

export type OfflineSaleQueueItem = {
  client_uuid: string;
  status: OfflineSaleStatus;
  sale: OfflineSaleDraft;
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
