import type {
  BusinessStoryReport,
  PaymentBreakdown,
  RefundsByReasonRow,
  SalesByEmployeeRow,
  SalesByHourRow,
  SalesSummary,
  TopProducts,
} from "./types";

class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

async function requestJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new ApiError(await response.text(), response.status);
  }
  return (await response.json()) as T;
}

// Short-lived cache for read-only report endpoints within a verified identity.
// Multiple dashboards/widgets often request the same range simultaneously;
// the cache prevents repeated network round-trips within a short window.
const REPORT_TTL_MS = 45_000;
const reportCache = new Map<string, { value: unknown; fetchedAt: number }>();
const reportInflight = new Map<string, Promise<unknown>>();
let reportIdentity: string | null = null;
let reportEpoch = 0;

/** AuthContext owns this identity; never infer a tenant from persisted storage. */
export function setReportsCacheIdentity(identity: { tenantId: string; userId: string; role?: string } | null): void {
  const next = identity ? JSON.stringify([identity.tenantId, identity.userId, identity.role]) : null;
  if (next === reportIdentity) return;
  reportIdentity = next;
  invalidateReportsCache();
}

function cachedJson<T>(url: string): Promise<T> {
  const epoch = reportEpoch;
  // Without a verified identity, do not share or retain authenticated reads.
  const key = reportIdentity === null ? null : `${reportIdentity}:${url}`;
  const now = Date.now();
  const hit = key === null ? undefined : reportCache.get(key);
  if (hit && now - hit.fetchedAt < REPORT_TTL_MS) {
    return Promise.resolve(hit.value as T);
  }
  const inflight = key === null ? undefined : reportInflight.get(key) as Promise<T> | undefined;
  if (inflight) return inflight;
  const promise = requestJson<T>(url)
    .then((value) => {
      if (epoch !== reportEpoch) {
        throw new Error("La sesión o los datos del reporte cambiaron. Vuelve a cargar el reporte.");
      }
      if (key !== null) reportCache.set(key, { value, fetchedAt: Date.now() });
      return value;
    })
    .finally(() => {
      // An old request must not remove a newer request for the same key.
      if (key !== null && reportInflight.get(key) === promise) reportInflight.delete(key);
    });
  if (key !== null) reportInflight.set(key, promise);
  return promise;
}

export function invalidateReportsCache(): void {
  reportEpoch += 1;
  reportCache.clear();
  reportInflight.clear();
}

function query(startDate: string, endDate: string): string {
  const params = new URLSearchParams();
  if (startDate) {
    params.set("start_date", startDate);
  }
  if (endDate) {
    params.set("end_date", endDate);
  }
  const value = params.toString();
  return value ? `?${value}` : "";
}

function rangeQuery(startDate: string, endDate: string): string {
  const params = new URLSearchParams();
  if (startDate) {
    params.set("start_date", startDate);
  }
  if (endDate) {
    params.set("end_date", endDate);
  }
  const value = params.toString();
  return value ? `?${value}` : "";
}

export function getSalesSummary(startDate: string, endDate: string): Promise<SalesSummary> {
  return cachedJson<SalesSummary>(`/api/v1/reports/sales-summary${query(startDate, endDate)}`);
}

export function getBusinessStory(
  startDate: string,
  endDate: string,
): Promise<BusinessStoryReport> {
  return cachedJson<BusinessStoryReport>(
    `/api/v1/reports/business-story${rangeQuery(startDate, endDate)}`,
  );
}

export function getPaymentBreakdown(
  startDate: string,
  endDate: string,
): Promise<PaymentBreakdown> {
  return cachedJson<PaymentBreakdown>(
    `/api/v1/reports/payment-breakdown${query(startDate, endDate)}`,
  );
}

export function getTopProducts(
  startDate: string,
  endDate: string,
  limit?: number,
): Promise<TopProducts> {
  const base = query(startDate, endDate);
  const sep = base ? "&" : "?";
  const url =
    limit != null
      ? `/api/v1/reports/top-products${base}${sep}limit=${limit}`
      : `/api/v1/reports/top-products${base}`;
  return cachedJson<TopProducts>(url);
}

export function getSalesByHour(
  startDate: string,
  endDate: string,
): Promise<SalesByHourRow[]> {
  return cachedJson<SalesByHourRow[]>(
    `/api/v1/reports/sales-by-hour${rangeQuery(startDate, endDate)}`,
  );
}

export function getSalesByEmployee(
  startDate: string,
  endDate: string,
): Promise<SalesByEmployeeRow[]> {
  return cachedJson<SalesByEmployeeRow[]>(
    `/api/v1/reports/sales-by-employee${rangeQuery(startDate, endDate)}`,
  );
}

export function getRefundsByReason(
  startDate: string,
  endDate: string,
): Promise<RefundsByReasonRow[]> {
  return cachedJson<RefundsByReasonRow[]>(
    `/api/v1/reports/refunds-by-reason${rangeQuery(startDate, endDate)}`,
  );
}
