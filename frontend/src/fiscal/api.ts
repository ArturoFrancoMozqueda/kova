import { csrfHeaders } from "@/lib/csrf";

export type FiscalDraftFrequency = "daily" | "weekly" | "monthly";

export type FiscalDraftSettings = {
  configured: boolean;
  frequency: FiscalDraftFrequency;
  weekly_close_day: number;
  monthly_close_day: number;
  auto_close_enabled: boolean;
  timezone: "America/Mexico_City";
  scheduler_status: "active";
};

export type FiscalDraftErrorCode =
  | "FISCAL_SETTINGS_REQUIRED"
  | "FISCAL_PERIOD_END_MISMATCH"
  | "FISCAL_PERIOD_NOT_COMPLETED";

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
  package_schema_version: string;
  tax_calculation_status: "not_calculated" | "calculated";
  gross_amount: string;
  discount_total_amount: string;
  tax_total_amount: string;
  total_amount: string;
  refund_total_amount: string;
  net_total_amount: string;
  adjustment_total_amount: string;
  adjusted_net_amount: string;
  adjustment_count: number;
  data_quality_warnings: string[];
  order_count: number;
  excluded_individually_confirmed_count: number;
};

export type FiscalDraftBatch = FiscalDraftPreview & {
  id: string;
  status: "draft" | "closed";
  order_ids: string[];
  closed_at: string;
  business_name_snapshot: string | null;
};

export type FiscalDraftBatchList = {
  items: FiscalDraftBatch[];
  total: number;
};

export class FiscalDraftApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: FiscalDraftErrorCode,
  ) {
    super(message);
  }
}

async function responseError(response: Response): Promise<FiscalDraftApiError> {
  const body = await response.text();
  try {
    const parsed = JSON.parse(body) as {
      detail?: string | { code?: FiscalDraftErrorCode; message?: string };
    };
    if (typeof parsed.detail === "object" && parsed.detail) {
      return new FiscalDraftApiError(
        parsed.detail.message ?? "Fiscal draft request failed",
        response.status,
        parsed.detail.code,
      );
    }
    return new FiscalDraftApiError(parsed.detail ?? body, response.status);
  } catch {
    return new FiscalDraftApiError(body, response.status);
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
    throw await responseError(response);
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

const ACCOUNTANT_REPORT_FALLBACK_FILENAME = "reporte-control-interno-kova.csv";
const ACCOUNTANT_PACKAGE_FALLBACK_FILENAME = "cierre-para-contador-kova.zip";

function safeDownloadBasename(
  candidate: string | undefined,
  extension: ".csv" | ".zip",
  fallback: string,
): string {
  const withoutLineBreaks = candidate?.replace(/[\r\n]/g, "");
  const basename = withoutLineBreaks?.split(/[\\/]/).at(-1)?.trim();
  return basename?.toLowerCase().endsWith(extension) ? basename : fallback;
}

function filenameFromContentDisposition(
  disposition: string,
  extension: ".csv" | ".zip",
  fallback: string,
): string {
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return safeDownloadBasename(
        decodeURIComponent(encoded.replace(/^"|"$/g, "")),
        extension,
        fallback,
      );
    } catch {
      // Fall through to the quoted filename or the safe product fallback.
    }
  }
  return safeDownloadBasename(
    disposition.match(/filename="([^"]+)"/i)?.[1],
    extension,
    fallback,
  );
}

async function downloadFiscalFile(
  url: string,
  extension: ".csv" | ".zip",
  fallback: string,
): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw await responseError(response);
  const blob = await response.blob();
  const filename = filenameFromContentDisposition(
    response.headers.get("Content-Disposition") ?? "",
    extension,
    fallback,
  );
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(objectUrl);
  return filename;
}

export async function downloadFiscalDraftAccountantReport(batchId: string): Promise<string> {
  return downloadFiscalFile(
    `${BASE_URL}/batches/${encodeURIComponent(batchId)}/accountant-report.csv`,
    ".csv",
    ACCOUNTANT_REPORT_FALLBACK_FILENAME,
  );
}

export async function downloadFiscalDraftAccountantPackage(batchId: string): Promise<string> {
  return downloadFiscalFile(
    `${BASE_URL}/batches/${encodeURIComponent(batchId)}/accountant-package.zip`,
    ".zip",
    ACCOUNTANT_PACKAGE_FALLBACK_FILENAME,
  );
}
