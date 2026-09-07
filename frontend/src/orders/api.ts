import { csrfHeaders } from "../lib/csrf";
import type {
  Order,
  OrderCreatePayload,
  OrderListResponse,
  Receipt,
  RefundPayload,
  ReceiptRefund,
  ReceiptVoid,
} from "./types";

export class ApiError extends Error {
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
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new ApiError(await response.text(), response.status);
  }
  return (await response.json()) as T;
}

export type OrderFilters = {
  status?: "completed" | "voided";
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
};

export function listOrders(filters: OrderFilters = {}): Promise<OrderListResponse> {
  const { limit = 50, offset = 0, status, startDate, endDate } = filters;
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (status) params.set("status", status);
  if (startDate) params.set("start_date", startDate);
  if (endDate) params.set("end_date", endDate);
  return requestJson<OrderListResponse>(`/api/v1/orders?${params.toString()}`);
}

export function getOrder(orderId: string): Promise<Order> {
  return requestJson<Order>(`/api/v1/orders/${orderId}`);
}

export function getReceipt(orderId: string): Promise<Receipt> {
  return requestJson<Receipt>(`/api/v1/orders/${orderId}/receipt`);
}

export function createOrder(payload: OrderCreatePayload): Promise<Order> {
  return requestJson<Order>("/api/v1/orders", {
    method: "POST",
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify(payload),
  });
}

export function createRefund(
  orderId: string,
  payload: RefundPayload,
  idempotencyKey: string,
): Promise<ReceiptRefund> {
  return requestJson<ReceiptRefund>(`/api/v1/orders/${orderId}/refunds`, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(payload),
  });
}

export function createVoid(orderId: string, reason: string): Promise<ReceiptVoid> {
  return requestJson<ReceiptVoid>(`/api/v1/orders/${orderId}/void`, {
    method: "POST",
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({ reason }),
  });
}
