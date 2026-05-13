export type OfflineSaleStatus = "pending" | "syncing" | "synced" | "failed";

export type OfflinePaymentDraft = {
  method: "cash" | "bank_transfer" | "manual_card";
  amount: string;
  amount_tendered?: string;
  reference?: string;
};

export type OfflineSaleDraft = {
  items: Array<{ product_id: string; quantity: number }>;
  payments: OfflinePaymentDraft[];
};

export type OfflineSaleQueueItem = {
  client_uuid: string;
  status: OfflineSaleStatus;
  sale: OfflineSaleDraft;
  attempt_count: number;
  last_error?: string;
  synced_order_id?: string;
  created_at: string;
  updated_at: string;
};
