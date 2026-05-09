import type { Order, Receipt, RefundPayload, ReceiptRefund, ReceiptVoid } from "./types";

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
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new ApiError(await response.text(), response.status);
  }
  return (await response.json()) as T;
}

export function getOrder(orderId: string): Promise<Order> {
  return requestJson<Order>(`/api/v1/orders/${orderId}`);
}

export function getReceipt(orderId: string): Promise<Receipt> {
  return requestJson<Receipt>(`/api/v1/orders/${orderId}/receipt`);
}

export function createRefund(orderId: string, payload: RefundPayload): Promise<ReceiptRefund> {
  return requestJson<ReceiptRefund>(`/api/v1/orders/${orderId}/refunds`, {
    method: "POST",
    headers: { "Idempotency-Key": crypto.randomUUID() },
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
