export type OfflineSaleStatus = "pending" | "syncing" | "synced" | "failed" | "quarantined";

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
  paper_width_mm?: import("@/lib/receiptPaper").ReceiptPaperWidth;
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
  /**
   * Authenticated session tenant that owned the register when the sale was rung.
   * This value is supplied by AuthContext, never by a form or sale payload.
   * `client_uuid` remains the backend idempotency identity; tenant + UUID is the
   * logical local identity used for every queue read and mutation.
   */
  tenant_id: string;
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
  sync_owner?: string;
  lease_id?: string;
  sync_started_at?: string;
  last_error?: string;
  synced_order_id?: string;
  created_at: string;
  updated_at: string;
};

/** Rows written by PWA bundles before tenant ownership existed.
 *
 * Dexie v4 preserves them without inventing an owner and marks them as
 * quarantined. They are intentionally excluded from all normal queue queries;
 * a future guided recovery flow may export/reconcile them after proving their
 * tenant. Never cast these rows to OfflineSaleQueueItem.
 */
export type LegacyOfflineSaleQueueItem = Omit<OfflineSaleQueueItem, "tenant_id" | "status"> & {
  tenant_id?: undefined;
  status: "quarantined";
};

export type StoredOfflineSaleQueueItem = OfflineSaleQueueItem | LegacyOfflineSaleQueueItem;
