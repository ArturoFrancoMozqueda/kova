import { csrfHeaders } from "../lib/csrf";

const QUEUE_KEY = "kova:funnel-events";
const CLIENT_ID_KEY = "kova:funnel-client-id";

type FunnelEvent = {
  event_name: string;
  client_event_id: string;
  properties: Record<string, unknown>;
};

function clientId(): string {
  try {
    const existing = window.localStorage.getItem(CLIENT_ID_KEY);
    if (existing) return existing;
    const next = crypto.randomUUID();
    window.localStorage.setItem(CLIENT_ID_KEY, next);
    return next;
  } catch {
    return "anonymous";
  }
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
    properties: {
      client_id: clientId(),
      path: window.location.pathname,
      ...properties,
    },
  };
  writeQueue([...readQueue(), event]);
}

export async function trackFunnelEvent(event_name: string, properties: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  const event: FunnelEvent = {
    event_name,
    client_event_id: eventId(event_name),
    properties: {
      client_id: clientId(),
      path: window.location.pathname,
      ...properties,
    },
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

// ── Anonymous / pre-authentication path ─────────────────────────────────────
// Landing events fire before any session exists, so they can't use the authed
// queue (which only flushes once authenticated). They POST cookieless to a
// dedicated allowlisted endpoint. Because the request carries no auth cookie it
// is correctly outside the CSRF path; because it's `credentials: "omit"` it
// never leaks a session. Best-effort only — ad/tracker blockers may drop some,
// so funnel counts are lower bounds.

// Guards `landing_viewed`-style events to once per page load (survives React
// StrictMode double-mounts; resets on a real reload). In-memory on purpose — a
// localStorage guard would suppress the event on every future visit too.
const anonymousFiredThisLoad = new Set<string>();

export async function trackAnonymousEvent(
  event_name: string,
  properties: Record<string, unknown> = {},
): Promise<void> {
  if (typeof window === "undefined") return;
  const body = {
    event_name,
    client_event_id: eventId(event_name),
    client_id: clientId(),
    properties: {
      path: window.location.pathname,
      ...properties,
    },
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
