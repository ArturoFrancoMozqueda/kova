import { csrfHeaders } from "../lib/csrf";

const QUEUE_KEY = "kova:funnel-events";
const CLIENT_ID_KEY = "kova:funnel-client-id";
const FIRST_TOUCH_KEY = "kova:funnel-first-touch";
const CTA_SPECIFICITY_EXPERIMENT_KEY = "kova:experiment:exp_01_cta_specificity";
const EXPERIMENT_EXPOSURE_SESSION_PREFIX = "kova:experiment-exposed:";
const ANONYMOUS_SESSION_KEY = "kova:anonymous-telemetry-session";

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

type AnonymousTelemetrySession = {
  token: string;
  clientId: string;
  expiresAt: number;
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
export type AnalysisDecisionArea =
  | "caja"
  | "inventario"
  | "margen"
  | "gasto"
  | "cliente"
  | "empleado"
  | "crecimiento";
export type AnalysisPriority = "alta" | "media" | "baja";
export type AnalysisSurface = "prioridad" | "plan";
export type AnalysisPreset = "today" | "seven_days" | "month" | "custom";
export type AnalysisHelpfulness = "helpful" | "not_yet";
export type AnalysisActionContext = {
  template_id: string;
  decision_area: AnalysisDecisionArea;
  priority: AnalysisPriority;
  surface: AnalysisSurface;
};

const DIRECT_ATTRIBUTION: FirstTouch = {
  source: "direct",
  medium: "none",
  campaign: "not_set",
};
const CAMPAIGN_VALUE_PATTERN = /^[a-z0-9][a-z0-9._~-]{0,79}$/;
const EMAIL_LIKE_PATTERN = /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/i;
const FORBIDDEN_PROPERTY_KEY_PATTERN =
  /(^|_)(email|name|phone|password|amount|tenant_id|user_id|order_id|product_id|customer_id|employee_id|supplier_id|subscription_id|query|url)($|_)/i;

let fallbackClientId: string | null = null;
let anonymousSessionRequest: Promise<string | null> | null = null;

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

/** Header form of {@link clientId}, for requests the server turns into funnel
 * events (currently signup). Returns an empty object when there is no window,
 * so callers can spread it unconditionally. */
export function funnelClientHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    return { "X-Kova-Client-Id": clientId() };
  } catch {
    return {};
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
  const delivery = await sendEvent(event);
  if (delivery === "retry") writeQueue([...readQueue(), event]);
}

export async function flushFunnelEvents() {
  if (typeof window === "undefined") return;
  const queue = readQueue();
  if (queue.length === 0) return;
  const remaining: FunnelEvent[] = [];
  for (const event of queue) {
    const sanitized = { ...event, properties: safeProperties(event.properties) };
    const delivery = await sendEvent(sanitized);
    if (delivery === "retry") remaining.push(sanitized);
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

function readAnonymousSession(expectedClientId: string): AnonymousTelemetrySession | null {
  try {
    const raw = window.sessionStorage.getItem(ANONYMOUS_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AnonymousTelemetrySession>;
    if (
      typeof parsed.token !== "string" ||
      parsed.clientId !== expectedClientId ||
      typeof parsed.expiresAt !== "number" ||
      parsed.expiresAt <= Date.now() + 5_000
    ) {
      window.sessionStorage.removeItem(ANONYMOUS_SESSION_KEY);
      return null;
    }
    return parsed as AnonymousTelemetrySession;
  } catch {
    return null;
  }
}

function storeAnonymousSession(session: AnonymousTelemetrySession) {
  try {
    window.sessionStorage.setItem(ANONYMOUS_SESSION_KEY, JSON.stringify(session));
  } catch {
    /* A storage-restricted browser can still use the token for this request. */
  }
}

function clearAnonymousSession() {
  try {
    window.sessionStorage.removeItem(ANONYMOUS_SESSION_KEY);
  } catch {
    /* best effort */
  }
}

async function anonymousSessionToken(expectedClientId: string): Promise<string | null> {
  const cached = readAnonymousSession(expectedClientId);
  if (cached) return cached.token;
  if (anonymousSessionRequest) return anonymousSessionRequest;

  anonymousSessionRequest = (async () => {
    try {
      const response = await fetch("/api/v1/telemetry/events/anonymous/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "omit",
        body: JSON.stringify({ client_id: expectedClientId }),
      });
      if (!response.ok) return null;
      const payload = (await response.json()) as { token?: unknown; expires_in?: unknown };
      if (
        typeof payload.token !== "string" ||
        typeof payload.expires_in !== "number" ||
        payload.expires_in <= 0
      ) {
        return null;
      }
      storeAnonymousSession({
        token: payload.token,
        clientId: expectedClientId,
        expiresAt: Date.now() + payload.expires_in * 1_000,
      });
      return payload.token;
    } catch {
      return null;
    } finally {
      anonymousSessionRequest = null;
    }
  })();
  return anonymousSessionRequest;
}

async function postAnonymousEvent(
  body: Record<string, unknown>,
  expectedClientId: string,
  allowTokenRefresh = true,
): Promise<void> {
  const token = await anonymousSessionToken(expectedClientId);
  if (!token) return;
  const response = await fetch("/api/v1/telemetry/events/anonymous", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Kova-Anonymous-Token": token,
    },
    credentials: "omit",
    keepalive: true,
    body: JSON.stringify(body),
  });
  // Even a fire-and-forget event must finish reading its acknowledgement.
  // With no-store, an unread fetch body can leave the transport pending.
  await response.text();
  if (response.status === 401 && allowTokenRefresh) {
    clearAnonymousSession();
    await postAnonymousEvent(body, expectedClientId, false);
  }
}

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
    await postAnonymousEvent(body, String(context.client_id));
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

export function trackAnalysisViewed(properties: {
  range_days: number;
  preset: AnalysisPreset;
  has_previous_period: boolean;
  recommendation_count: number;
}) {
  return trackFunnelEvent("analysis_viewed", properties);
}

export function trackAnalysisRecommendationOpened(context: AnalysisActionContext) {
  return trackFunnelEvent("analysis_recommendation_opened", context);
}

export function trackAnalysisActionStarted(context: AnalysisActionContext) {
  return trackFunnelEvent("analysis_action_started", context);
}

export function trackAnalysisActionState(
  completed: boolean,
  context: AnalysisActionContext,
) {
  return trackFunnelEvent(
    completed ? "analysis_action_completed" : "analysis_action_reopened",
    context,
  );
}

export function trackAnalysisActionFeedback(
  helpfulness: AnalysisHelpfulness,
  context: AnalysisActionContext,
) {
  return trackFunnelEvent("analysis_action_feedback", { ...context, helpfulness });
}

export function trackExperimentExposed(
  experiment_id: CroExperiment,
  variant: ExperimentVariant,
  cta: string,
) {
  if (typeof window === "undefined") return;
  const sessionKey = `${EXPERIMENT_EXPOSURE_SESSION_PREFIX}${experiment_id}:${variant}`;
  try {
    if (window.sessionStorage.getItem(sessionKey)) return;
    window.sessionStorage.setItem(sessionKey, "1");
  } catch {
    // Storage-restricted browsers still receive once-per-load deduplication.
    return trackAnonymousEventOnce(
      `experiment:${experiment_id}:${variant}`,
      "experiment_exposed",
      { experiment_id, variant, cta },
    );
  }
  void trackAnonymousEvent("experiment_exposed", { experiment_id, variant, cta });
}

type EventDelivery = "sent" | "retry" | "drop";

async function sendEvent(event: FunnelEvent): Promise<EventDelivery> {
  try {
    const response = await fetch("/api/v1/telemetry/events", {
      method: "POST",
      headers: { "content-type": "application/json", ...csrfHeaders("POST") },
      credentials: "same-origin",
      keepalive: true,
      body: JSON.stringify(event),
    });
    await response.text();
    if (response.ok) return "sent";
    if (
      response.status === 401 ||
      response.status === 403 ||
      response.status === 408 ||
      response.status === 425 ||
      response.status === 429
    ) {
      return "retry";
    }
    return response.status >= 500 ? "retry" : "drop";
  } catch {
    return "retry";
  }
}
