import { csrfHeaders } from "@/lib/csrf";
import type {
  CustomerOrder,
  CustomerOrderCheckoutResponse,
  CustomerOrderFilters,
  CustomerOrderInput,
  CustomerOrderListResponse,
  CustomerOrderPayments,
  CustomerOrderStatus,
} from "./types";

export class CustomerOrderApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly detail?: unknown,
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
    let detail: unknown;
    try {
      detail = await response.json();
    } catch {
      detail = await response.text();
    }
    throw new CustomerOrderApiError("No se pudo completar la operación", response.status, detail);
  }
  return (await response.json()) as T;
}

function mutation<T>(url: string, body: unknown, method = "POST", idempotencyKey: string = crypto.randomUUID()): Promise<T> {
  return requestJson<T>(url, {
    method,
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(body),
  });
}

export function listCustomerOrders(
  filters: CustomerOrderFilters = {},
): Promise<CustomerOrderListResponse> {
  const params = new URLSearchParams({
    limit: String(filters.limit ?? 50),
    offset: String(filters.offset ?? 0),
  });
  for (const key of [
    "search",
    "status",
    "payment_status",
    "fulfillment_type",
    "promised_from",
    "promised_to",
  ] as const) {
    const value = filters[key];
    if (value) params.set(key, value);
  }
  return requestJson<CustomerOrderListResponse>(`/api/v1/customer-orders?${params.toString()}`);
}

export function getCustomerOrder(id: string): Promise<CustomerOrder> {
  return requestJson<CustomerOrder>(`/api/v1/customer-orders/${id}`);
}

export function createCustomerOrder(body: CustomerOrderInput): Promise<CustomerOrder> {
  return mutation<CustomerOrder>("/api/v1/customer-orders", body);
}

export function updateCustomerOrder(
  id: string,
  body: CustomerOrderInput & { version: number },
): Promise<CustomerOrder> {
  return mutation<CustomerOrder>(`/api/v1/customer-orders/${id}`, body, "PATCH");
}

export function confirmCustomerOrder(id: string, version: number): Promise<CustomerOrder> {
  return mutation<CustomerOrder>(`/api/v1/customer-orders/${id}/confirm`, { version });
}

export function changeCustomerOrderStatus(
  id: string,
  version: number,
  status: CustomerOrderStatus,
): Promise<CustomerOrder> {
  return mutation<CustomerOrder>(`/api/v1/customer-orders/${id}/status`, { version, status });
}

export function cancelCustomerOrder(
  id: string,
  version: number,
  reason: "customer_request" | "out_of_stock" | "duplicate" | "other",
  note?: string,
): Promise<CustomerOrder> {
  return mutation<CustomerOrder>(`/api/v1/customer-orders/${id}/cancel`, {
    version,
    reason,
    note: note || undefined,
  });
}

export function checkoutCustomerOrder(
  id: string,
  version: number,
  payments: CustomerOrderPayments,
  idempotencyKey?: string,
): Promise<CustomerOrderCheckoutResponse> {
  return mutation<CustomerOrderCheckoutResponse>(`/api/v1/customer-orders/${id}/checkout`, {
    version,
    payments,
  }, "POST", idempotencyKey);
}
