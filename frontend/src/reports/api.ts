import type { PaymentBreakdown, SalesSummary, TopProducts } from "./types";

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

export function getSalesSummary(startDate: string, endDate: string): Promise<SalesSummary> {
  return requestJson<SalesSummary>(`/api/v1/reports/sales-summary${query(startDate, endDate)}`);
}

export function getPaymentBreakdown(
  startDate: string,
  endDate: string,
): Promise<PaymentBreakdown> {
  return requestJson<PaymentBreakdown>(
    `/api/v1/reports/payment-breakdown${query(startDate, endDate)}`,
  );
}

export function getTopProducts(startDate: string, endDate: string): Promise<TopProducts> {
  return requestJson<TopProducts>(`/api/v1/reports/top-products${query(startDate, endDate)}`);
}
