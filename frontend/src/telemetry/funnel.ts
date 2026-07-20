import { csrfHeaders } from "../lib/csrf";

const QUEUE_KEY = "kova:funnel-events";
const CLIENT_ID_KEY = "kova:funnel-client-id";
const FIRST_TOUCH_KEY = "kova:funnel-first-touch";
const CTA_SPECIFICITY_EXPERIMENT_KEY = "kova:experiment:exp_01_cta_specificity";

type FunnelEvent = {
  event_name: string;
  client_event_id: string;
  properties: Record<string, unknown>;
};

type FirstTouch = {
  source: string;
  medium: string;
  campaign: string;
};

export type SignupValidationField = "business" | "email" | "password" | "terms" | "form";
export type SignupValidationReason =
  | "required"
  | "invalid_format"
  | "too_short"
  | "too_long"
  | "weak_password"
  | "not_accepted"
  | "server_validation";
export type SaleValidationField =
  | "cart"
  | "cash_tendered"
  | "payment_total"
  | "open_shift"
  | "permission";
export type SaleValidationReason =
  | "empty_cart"
  | "insufficient_cash"
  | "split_mismatch"
  | "cash_requires_shift"
  | "permission_denied";
export type CheckoutState =
  | "available"
  | "trialing"
  | "active"
  | "past_due"
  | "incomplete"
  | "canceled"
  | "unpaid"
  | "return_success_pending"
  | "return_success_active"
  | "return_cancel";
export type CroExperiment = "exp_01_cta_specificity";
export type ExperimentVariant = "control" | "treatment";

const DIRECT_ATTRIBUTION: FirstTouch = {
  source: "direct",
  medium: "none",
  campaign: "not_set",
};
const CAMPAIGN_VALUE_PATTERN = /^[a-z0-9][a-z0-9._~-]{0,79}$/;
const EMAIL_LIKE_PATTERN = /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/i;
const FORBIDDEN_PROPERTY_KEY_PATTERN =
  /(^|_)(email|name|phone|password|amount|tenant_id|user_id|order_id|subscription_id|query|url)($|_)/i;

let fallbackClientId: string | null = null;

function newClientId(): string {
  if (!fallbackClientId) fallbackClientId = crypto.randomUUID();
  return fallbackClientId;
}

export function clientId(): string {
  try {
    const existing = window.localStorage.getItem(CLIENT_ID_KEY);
    if (existing) return existing;
    const next = crypto.randomUUID();
    window.localStorage.setItem(CLIENT_ID_KEY, next);
    return next;
  } catch {
    return newClientId();
  }
}

export function hasFunnelClientId(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return Boolean(window.localStorage.getItem(CLIENT_ID_KEY));
  } catch {
    return false;
  }
}

function experimentVariantForClient(value: string): ExperimentVariant {
  // FNV-1a keeps the split deterministic without sending another identifier.
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 2 === 0 ? "control" : "treatment";
}

/**
 * Assign EXP-01 only on the first anonymous mobile visit. Existing clients are
 * deliberately excluded; once assigned, a client keeps the same variant.
 */
export function assignCtaSpecificityExperiment(
  eligible: boolean,
  newVisitor = !hasFunnelClientId(),
): ExperimentVariant | null {
  if (typeof window === "undefined" || !eligible || window.innerWidth >= 768) return null;

  try {
    const assigned = window.localStorage.getItem(CTA_SPECIFICITY_EXPERIMENT_KEY);
    if (assigned === "control" || assigned === "treatment") return assigned;

    if (!newVisitor) return null;

    const variant = experimentVariantForClient(clientId());
    window.localStorage.setItem(CTA_SPECIFICITY_EXPERIMENT_KEY, variant);
    return variant;
  } catch {
    // Storage-restricted browsers may participate for this page load only.
    return experimentVariantForClient(clientId());
  }
}

function campaignValue(value: string | null, fallback: string): string {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "-");
  if (
    !CAMPAIGN_VALUE_PATTERN.test(normalized) ||
    EMAIL_LIKE_PATTERN.test(value) ||
    value.includes("?") ||
    value.includes("&") ||
    value.includes("=")
  ) {
    return fallback;
  }
  return normalized;
}

function isFirstTouch(value: unknown): value is FirstTouch {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return [candidate.source, candidate.medium, candidate.campaign].every(
    (item) => typeof item === "string" && CAMPAIGN_VALUE_PATTERN.test(item),
  );
}

function firstTouch(): FirstTouch {
  try {
    const stored = window.localStorage.getItem(FIRST_TOUCH_KEY);
    if (stored) {
      const parsed: unknown = JSON.parse(stored);
      if (isFirstTouch(parsed)) return parsed;
    }
    const params = new URLSearchParams(window.location.search);
    const next = {
      source: campaignValue(params.get("utm_source"), DIRECT_ATTRIBUTION.source),
      medium: campaignValue(params.get("utm_medium"), DIRECT_ATTRIBUTION.medium),
      campaign: campaignValue(params.get("utm_campaign"), DIRECT_ATTRIBUTION.campaign),
    };
    window.localStorage.setItem(FIRST_TOUCH_KEY, JSON.stringify(next));
    return next;
  } catch {
    return DIRECT_ATTRIBUTION;
  }
}

function deviceContext(): { device_class: "mobile" | "tablet" | "desktop"; viewport_bucket: string } {
  const width = window.innerWidth;
  if (width < 768) {
    return {
      device_class: "mobile",
      viewport_bucket: width < 360 ? "mobile_320" : "mobile_390",
    };
  }
  if (width < 1024) return { device_class: "tablet", viewport_bucket: "tablet" };
  return {
    device_class: "desktop",
    viewport_bucket: width < 1440 ? "desktop" : "desktop_wide",
  };
}

function safeProperties(properties: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(properties).filter(([key, value]) => {
      if (FORBIDDEN_PROPERTY_KEY_PATTERN.test(key)) return false;
      if (typeof value === "string" && EMAIL_LIKE_PATTERN.test(value)) return false;
      return value === null || ["string", "number", "boolean"].includes(typeof value);
    }),
  );
}

function commonProperties(properties: Record<string, unknown>): Record<string, unknown> {
  return {
    ...safeProperties(properties),
    client_id: clientId(),
    path: window.location.pathname,
    ...deviceContext(),
    ...firstTouch(),
  };
}

function readQueue(): FunnelEvent[] {
  try {
    const raw = window.localStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as FunnelEvent[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(events: FunnelEvent[]) {
  try {
    window.localStorage.setItem(QUEUE_KEY, JSON.stringify(events.slice(-30)));
  } catch {
    /* best effort only */
  }
}

function eventId(name: string): string {
  return `${name}:${Date.now()}:${crypto.randomUUID()}`;
}

export function queueFunnelEvent(event_name: string, properties: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  const event: FunnelEvent = {
    event_name,
    client_event_id: eventId(event_name),
    properties: commonProperties(properties),
  };
  writeQueue([...readQueue(), event]);
}

export async function trackFunnelEvent(event_name: string, properties: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  const event: FunnelEvent = {
    event_name,
    client_event_id: eventId(event_name),
    properties: commonProperties(properties),
  };
  const sent = await sendEvent(event);
  if (!sent) writeQueue([...readQueue(), event]);
}

export async function flushFunnelEvents() {
  if (typeof window === "undefined") return;
  const queue = readQueue();
  if (queue.length === 0) return;
  const remaining: FunnelEvent[] = [];
  for (const event of queue) {
    const sent = await sendEvent(event);
    if (!sent) remaining.push(event);
  }
  writeQueue(remaining);
}

export function trackFunnelEventOnce(
  key: string,
  event_name: string,
  properties: Record<string, unknown> = {},
) {
  if (typeof window === "undefined") return;
  const storageKey = `kova:funnel-once:${key}`;
  try {
    if (window.localStorage.getItem(storageKey)) return;
    window.localStorage.setItem(storageKey, "1");
  } catch {
    return;
  }
  void trackFunnelEvent(event_name, properties);
}

// Anonymous / pre-authentication path. Requests are intentionally cookieless;
// the same pseudonymous client_id is copied into authenticated events later.
const anonymousFiredThisLoad = new Set<string>();

export async function trackAnonymousEvent(
  event_name: string,
  properties: Record<string, unknown> = {},
): Promise<void> {
  if (typeof window === "undefined") return;
  const context = commonProperties(properties);
  const body = {
    event_name,
    client_event_id: eventId(event_name),
    client_id: context.client_id,
    properties: Object.fromEntries(
      Object.entries(context).filter(([key]) => key !== "client_id"),
    ),
  };
  try {
    await fetch("/api/v1/telemetry/events/anonymous", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "omit",
      keepalive: true,
      body: JSON.stringify(body),
    });
  } catch {
    /* best effort only — pre-auth analytics must never break the landing */
  }
}

export function trackAnonymousEventOnce(
  key: string,
  event_name: string,
  properties: Record<string, unknown> = {},
) {
  if (typeof window === "undefined") return;
  if (anonymousFiredThisLoad.has(key)) return;
  anonymousFiredThisLoad.add(key);
  void trackAnonymousEvent(event_name, properties);
}

export function trackSignupValidationFailed(
  field: SignupValidationField,
  reason_code: SignupValidationReason,
) {
  return trackAnonymousEvent("signup_validation_failed", { field, reason_code });
}

export function trackSaleValidationBlocked(
  field: SaleValidationField,
  reason_code: SaleValidationReason,
) {
  return trackFunnelEvent("sale_validation_blocked", { field, reason_code });
}

export function trackCheckoutStateViewed(state: CheckoutState) {
  return trackFunnelEvent("checkout_state_viewed", { state });
}

export function trackExperimentExposed(
  experiment_id: CroExperiment,
  variant: ExperimentVariant,
  cta: string,
) {
  return trackAnonymousEventOnce(
    `experiment:${experiment_id}`,
    "experiment_exposed",
    { experiment_id, variant, cta },
  );
}

async function sendEvent(event: FunnelEvent): Promise<boolean> {
  try {
    const response = await fetch("/api/v1/telemetry/events", {
      method: "POST",
      headers: { "content-type": "application/json", ...csrfHeaders("POST") },
      credentials: "same-origin",
      keepalive: true,
      body: JSON.stringify(event),
    });
    return response.ok;
  } catch {
    return false;
  }
}
