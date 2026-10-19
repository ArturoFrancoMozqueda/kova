export type PreviewRow = {
  row_number: number;
  settled_at: string;
  gross_amount: string;
  fee_amount: string;
  net_amount: string;
  currency: "MXN";
  payment_method: "bank_transfer" | "manual_card";
  external_reference_masked: string;
  row_fingerprint: string;
};
export type ReconciliationPreview = {
  parser_version: number;
  content_sha256: string;
  rows: PreviewRow[];
  errors: { row_number: number; message: string }[];
};
export type SettlementMatch = {
  id: string;
  payment_id: string;
  order_id: string;
  matched_amount: string;
  status: "suggested" | "confirmed" | "rejected" | "reversed";
  version: number;
  reasons: string[];
};
export type SettlementEntry = {
  id: string;
  batch_id: string;
  settled_at: string;
  gross_amount: string;
  fee_amount: string;
  net_amount: string;
  currency: "MXN";
  payment_method: "bank_transfer" | "manual_card";
  external_reference_masked: string;
  status: "unmatched" | "partially_matched" | "matched";
  matched_amount: string;
  remaining_amount: string;
  matches: SettlementMatch[];
};
export type EntriesPage = { entries: SettlementEntry[]; has_more: boolean };
