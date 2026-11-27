import { csrfHeaders } from "@/lib/csrf";

export type PrepStatus = "received" | "preparing" | "ready" | "delivered";

export type PrepStation = { id: string; name: string; alert_minutes: number; position: number; is_active: boolean };

export type PrepItem = { product_name: string; quantity: number; modifiers: string[]; note: string | null };

export type PrepCard = {
  /** sale: a counter sale's ticket; customer_order: a pedido shown with its own status. */
  kind: "sale" | "customer_order";
  id: string;
  station_id: string;
  status: PrepStatus;
  version: number;
  number: number | null;
  folio: string | null;
  customer_name: string | null;
  sale_order_id: string | null;
  payment_status: string | null;
  promised_at: string | null;
  received_at: string;
  preparing_at: string | null;
  ready_at: string | null;
  delivered_at: string | null;
  items: PrepItem[];
};

export type PrepQueue = { stations: PrepStation[]; cards: PrepCard[]; generated_at: string };

export class PrepApiError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...csrfHeaders(init?.method), ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: unknown } | null;
    throw new PrepApiError(typeof body?.detail === "string" ? body.detail : "", response.status);
  }
  return response.json() as Promise<T>;
}

export const getPrepQueue = () => request<PrepQueue>("/api/v1/prep-queue");

export const changePrepTicketStatus = (id: string, version: number, status: PrepStatus) =>
  request<{ id: string; status: PrepStatus; version: number }>(`/api/v1/prep-queue/tickets/${id}/status`, {
    method: "POST", body: JSON.stringify({ version, status }),
  });

export const listPrepStations = (includeInactive = false) =>
  request<PrepStation[]>(`/api/v1/prep-stations${includeInactive ? "?include_inactive=true" : ""}`);

export const createPrepStation = (name: string, alertMinutes: number) =>
  request<PrepStation>("/api/v1/prep-stations", {
    method: "POST", body: JSON.stringify({ name, alert_minutes: alertMinutes }),
  });

export const updatePrepStation = (id: string, body: Partial<Pick<PrepStation, "name" | "alert_minutes" | "is_active" | "position">>) =>
  request<PrepStation>(`/api/v1/prep-stations/${id}`, { method: "PATCH", body: JSON.stringify(body) });
