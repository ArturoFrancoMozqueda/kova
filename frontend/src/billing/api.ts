import type { BillingSubscription, CheckoutSession } from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new ApiError(await response.text(), response.status);
  }
  return (await response.json()) as T;
}

function idempotencyKey(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function getBillingSubscription(): Promise<BillingSubscription> {
  return requestJson<BillingSubscription>("/api/v1/billing/subscription");
}

export function startCheckout(): Promise<CheckoutSession> {
  return requestJson<CheckoutSession>("/api/v1/billing/checkout", {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey("checkout") },
  });
}

export function cancelSubscription(): Promise<BillingSubscription> {
  return requestJson<BillingSubscription>("/api/v1/billing/cancel", {
    method: "POST",
  });
}
