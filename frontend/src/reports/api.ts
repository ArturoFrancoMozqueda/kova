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
  return requestJson<SalesSummary>(`/api/v1/reports/sales-summary${query(startDate, endDate)}`);
}

export function getBusinessStory(
  startDate: string,
  endDate: string,
): Promise<BusinessStoryReport> {
  return requestJson<BusinessStoryReport>(
    `/api/v1/reports/business-story${rangeQuery(startDate, endDate)}`,
  );
}

export function getPaymentBreakdown(
  startDate: string,
  endDate: string,
): Promise<PaymentBreakdown> {
  return requestJson<PaymentBreakdown>(
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
  return requestJson<TopProducts>(url);
}

export function getSalesByHour(
  startDate: string,
  endDate: string,
): Promise<SalesByHourRow[]> {
  return requestJson<SalesByHourRow[]>(
    `/api/v1/reports/sales-by-hour${rangeQuery(startDate, endDate)}`,
  );
}

export function getSalesByEmployee(
  startDate: string,
  endDate: string,
): Promise<SalesByEmployeeRow[]> {
  return requestJson<SalesByEmployeeRow[]>(
    `/api/v1/reports/sales-by-employee${rangeQuery(startDate, endDate)}`,
  );
}

export function getRefundsByReason(
  startDate: string,
  endDate: string,
): Promise<RefundsByReasonRow[]> {
  return requestJson<RefundsByReasonRow[]>(
    `/api/v1/reports/refunds-by-reason${rangeQuery(startDate, endDate)}`,
  );
}
