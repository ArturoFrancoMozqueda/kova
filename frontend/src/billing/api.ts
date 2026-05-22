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

// Stale-while-revalidate cache for /billing/subscription. Multiple consumers
// (BillingBanner, dashboard checklist, billing view, trial chip) used to fetch
// independently on every navigation, producing 4+ requests per dashboard load.
const SUBSCRIPTION_TTL_MS = 60_000;
let subscriptionCache: {
  value: BillingSubscription;
  fetchedAt: number;
} | null = null;
let subscriptionInflight: Promise<BillingSubscription> | null = null;

function fetchBillingSubscription(): Promise<BillingSubscription> {
  return requestJson<BillingSubscription>("/api/v1/billing/subscription");
}

export function getBillingSubscription(
  options: { force?: boolean } = {},
): Promise<BillingSubscription> {
  const now = Date.now();
  if (!options.force && subscriptionCache && now - subscriptionCache.fetchedAt < SUBSCRIPTION_TTL_MS) {
    return Promise.resolve(subscriptionCache.value);
  }
  if (subscriptionInflight) return subscriptionInflight;
  subscriptionInflight = fetchBillingSubscription()
    .then((value) => {
      subscriptionCache = { value, fetchedAt: Date.now() };
      return value;
    })
    .finally(() => {
      subscriptionInflight = null;
    });
  return subscriptionInflight;
}

export function invalidateBillingSubscription(): void {
  subscriptionCache = null;
}

export function startCheckout(): Promise<CheckoutSession> {
  return requestJson<CheckoutSession>("/api/v1/billing/checkout", {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey("checkout") },
  });
}

export function cancelSubscription(): Promise<BillingSubscription> {
  invalidateBillingSubscription();
  return requestJson<BillingSubscription>("/api/v1/billing/cancel", {
    method: "POST",
  });
}
