import { csrfHeaders } from "@/lib/csrf";

export type FiscalDraftFrequency = "daily" | "weekly" | "monthly";

export type FiscalDraftSettings = {
  frequency: FiscalDraftFrequency;
  weekly_close_day: number;
  monthly_close_day: number;
  auto_close_enabled: boolean;
  timezone: "America/Mexico_City";
  scheduler_status: "active";
};

export type FiscalDraftSettingsUpdate = Pick<
  FiscalDraftSettings,
  "frequency" | "weekly_close_day" | "monthly_close_day" | "auto_close_enabled"
>;

export type FiscalDraftPreview = {
  frequency: FiscalDraftFrequency;
  period_start: string;
  period_end: string;
  timezone: "America/Mexico_City";
  document_kind: "operational_draft";
  fiscal_status: "not_issued";
  gross_amount: string;
  discount_total_amount: string;
  tax_total_amount: string;
  total_amount: string;
  refund_total_amount: string;
  net_total_amount: string;
  order_count: number;
  excluded_individually_confirmed_count: number;
};

export type FiscalDraftBatch = FiscalDraftPreview & {
  id: string;
  status: "draft" | "closed";
  order_ids: string[];
  closed_at: string;
};

export type FiscalDraftBatchList = {
  items: FiscalDraftBatch[];
  total: number;
};

export class FiscalDraftApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...csrfHeaders(init?.method),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    throw new FiscalDraftApiError(await response.text(), response.status);
  }
  return (await response.json()) as T;
}

const BASE_URL = "/api/v1/fiscal/global-drafts";

export function getFiscalDraftSettings(): Promise<FiscalDraftSettings> {
  return requestJson<FiscalDraftSettings>(`${BASE_URL}/settings`);
}

export function saveFiscalDraftSettings(
  body: FiscalDraftSettingsUpdate,
): Promise<FiscalDraftSettings> {
  return requestJson<FiscalDraftSettings>(`${BASE_URL}/settings`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function previewFiscalDraft(periodEnd: string): Promise<FiscalDraftPreview> {
  const query = new URLSearchParams({ period_end: periodEnd });
  return requestJson<FiscalDraftPreview>(`${BASE_URL}/preview?${query.toString()}`);
}

export function closeFiscalDraft(
  periodEnd: string,
  idempotencyKey: string,
): Promise<FiscalDraftBatch> {
  return requestJson<FiscalDraftBatch>(`${BASE_URL}/close`, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ period_end: periodEnd }),
  });
}

export function listFiscalDraftBatches(): Promise<FiscalDraftBatchList> {
  return requestJson<FiscalDraftBatchList>(`${BASE_URL}/batches`);
}

export function getFiscalDraftBatch(batchId: string): Promise<FiscalDraftBatch> {
  return requestJson<FiscalDraftBatch>(`${BASE_URL}/batches/${batchId}`);
}
