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
