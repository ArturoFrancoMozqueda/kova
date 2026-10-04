import { csrfHeaders } from "../lib/csrf";
import type {
  InventoryVelocityItem,
  MovementHistoryResponse,
  MovementResponse,
  StockItem,
} from "./types";

class ApiError extends Error {
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

export function listStock(): Promise<StockItem[]> {
  return requestJson<StockItem[]>("/api/v1/inventory/stock");
}

export function listLowStock(): Promise<StockItem[]> {
  return requestJson<StockItem[]>("/api/v1/inventory/low-stock");
}

export function listVelocity(): Promise<InventoryVelocityItem[]> {
  return requestJson<InventoryVelocityItem[]>("/api/v1/inventory/velocity");
}

export function adjustStock(
  productId: string,
  quantityDelta: number,
  reason: string,
  reasonCode?: string | null,
  idempotencyKey: string = crypto.randomUUID(),
): Promise<MovementResponse> {
  return requestJson<MovementResponse>(`/api/v1/inventory/products/${productId}/adjustments`, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ quantity_delta: quantityDelta, reason, reason_code: reasonCode }),
  });
}

export function recordStockTake(
  productId: string,
  countedQuantity: number,
  reason: string,
  idempotencyKey: string = crypto.randomUUID(),
): Promise<MovementResponse> {
  return requestJson<MovementResponse>(`/api/v1/inventory/products/${productId}/stock-take`, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ counted_quantity: countedQuantity, reason }),
  });
}

export function listMovements(
  productId: string,
  limit = 20,
  offset = 0,
): Promise<MovementHistoryResponse> {
  return requestJson<MovementHistoryResponse>(
    `/api/v1/inventory/products/${productId}/movements?limit=${limit}&offset=${offset}`,
  );
}

export function updateLowStockThreshold(
  productId: string,
  lowStockThreshold: number | null,
  idempotencyKey: string = crypto.randomUUID(),
): Promise<StockItem> {
  return requestJson<StockItem>(
    `/api/v1/inventory/products/${productId}/low-stock-threshold`,
    {
      method: "PATCH",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ low_stock_threshold: lowStockThreshold }),
    },
  );
}
