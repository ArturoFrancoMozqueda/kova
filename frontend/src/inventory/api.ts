import type { MovementResponse, StockItem } from "./types";

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

export function adjustStock(
  productId: string,
  quantityDelta: number,
  reason: string,
): Promise<MovementResponse> {
  return requestJson<MovementResponse>(`/api/v1/inventory/products/${productId}/adjustments`, {
    method: "POST",
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({ quantity_delta: quantityDelta, reason }),
  });
}

export function recordStockTake(
  productId: string,
  countedQuantity: number,
  reason: string,
): Promise<MovementResponse> {
  return requestJson<MovementResponse>(`/api/v1/inventory/products/${productId}/stock-take`, {
    method: "POST",
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({ counted_quantity: countedQuantity, reason }),
  });
}

export function updateLowStockThreshold(
  productId: string,
  lowStockThreshold: number | null,
): Promise<StockItem> {
  return requestJson<StockItem>(
    `/api/v1/inventory/products/${productId}/low-stock-threshold`,
    {
      method: "PATCH",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ low_stock_threshold: lowStockThreshold }),
    },
  );
}
