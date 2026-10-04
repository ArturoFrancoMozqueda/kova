import { csrfHeaders } from "../lib/csrf";
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
  const response = await fetch(url, {
    ...init,
    headers: {
      ...csrfHeaders(init?.method),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    throw new ApiError(await response.text(), response.status);
  }
  return (await response.json()) as T;
}

function idempotencyKey(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

// Short-lived cache for /billing/subscription within a verified identity. Multiple consumers
// (BillingBanner, dashboard checklist, billing view, trial chip) used to fetch
// independently on every navigation, producing 4+ requests per dashboard load.
const SUBSCRIPTION_TTL_MS = 60_000;
let subscriptionCache: {
  value: BillingSubscription;
  fetchedAt: number;
} | null = null;
let subscriptionInflight: Promise<BillingSubscription> | null = null;
let subscriptionIdentity: string | null = null;
let subscriptionEpoch = 0;

/** Cache identity comes only from the verified online AuthContext session. */
export function setBillingCacheIdentity(identity: { tenantId: string; userId: string; role?: string } | null): void {
  const next = identity ? JSON.stringify([identity.tenantId, identity.userId, identity.role]) : null;
  if (next === subscriptionIdentity) return;
  subscriptionIdentity = next;
  invalidateBillingSubscription();
}

function fetchBillingSubscription(): Promise<BillingSubscription> {
  return requestJson<BillingSubscription>("/api/v1/billing/subscription");
}

export function getBillingSubscription(
  options: { force?: boolean } = {},
): Promise<BillingSubscription> {
  if (options.force) invalidateBillingSubscription();
  const epoch = subscriptionEpoch;
  const cacheEnabled = subscriptionIdentity !== null;
  const now = Date.now();
  if (cacheEnabled && subscriptionCache && now - subscriptionCache.fetchedAt < SUBSCRIPTION_TTL_MS) {
    return Promise.resolve(subscriptionCache.value);
  }
  if (cacheEnabled && subscriptionInflight) return subscriptionInflight;
  const promise = fetchBillingSubscription()
    .then((value) => {
      if (epoch !== subscriptionEpoch) {
        throw new Error("La sesión o la suscripción cambiaron. Vuelve a cargar el estado del plan.");
      }
      if (cacheEnabled) subscriptionCache = { value, fetchedAt: Date.now() };
      return value;
    })
    .finally(() => {
      if (subscriptionInflight === promise) subscriptionInflight = null;
    });
  if (cacheEnabled) subscriptionInflight = promise;
  return promise;
}

export function invalidateBillingSubscription(): void {
  subscriptionEpoch += 1;
  subscriptionCache = null;
  subscriptionInflight = null;
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

// Self-heal a lost checkout webhook: the billing success page reconciles the
// Stripe session server-side so access activates without a manual refresh.
export function reconcileCheckout(sessionId: string): Promise<BillingSubscription> {
  invalidateBillingSubscription();
  return requestJson<BillingSubscription>("/api/v1/billing/checkout/reconcile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ checkout_session_id: sessionId }),
  });
}
