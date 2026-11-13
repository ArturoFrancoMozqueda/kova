import { csrfHeaders } from "../lib/csrf";
import type { Order } from "../orders/types";
import {
  markOfflineSaleFailed,
  markOfflineSaleStatus,
  markOfflineSaleSynced,
  rollbackOfflineSaleAttempt,
} from "./queue";
import type { OfflineSaleQueueItem } from "./types";
import { getActiveOfflineTenant, onActiveOfflineTenantChange } from "./activeTenant";
import { SyncSessionError } from "./syncStatus";

type ApiSyncResult = {
  client_uuid: string;
  status: "synced" | "failed";
  order_id: string | null;
  order: Order | null;
  error: string | null;
  error_code?: string | null;
};

export type SyncItemResult = {
  client_uuid: string;
  status: "synced" | "failed";
  order_id: string | null;
  order: Order | null;
  error: string | null;
  error_code?: string | null;
};

/**
 * Thrown when the sync endpoint rate-limits us (429). The affected items are
 * rolled back to pending (no attempt burned); the sync worker catches this and
 * schedules a single retry after `retryAfterMs` instead of hammering every
 * remaining chunk.
 */
export class RateLimitError extends Error {
  constructor(
    message: string,
    public readonly retryAfterMs: number,
  ) {
    super(message);
    this.name = "RateLimitError";
  }
}

export class BillingAccessError extends Error {
  constructor() {
    super("Activa el plan de Kova para sincronizar las ventas pendientes.");
    this.name = "BillingAccessError";
  }
}

/** The request did not finish in time. Outcome unknown; replay is safe. */
export class SyncTimeoutError extends Error {
  constructor() {
    super("Offline sync request timed out");
    this.name = "SyncTimeoutError";
  }
}

/** Network, timeout or 5xx: the sale is fine, the connection is not. */
export class SyncTransientError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "SyncTransientError";
  }
}

export const SYNC_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_RETRY_AFTER_MS = 60_000;
// Stored on released rows only; shown to people solely through safeUserMessage.
const TRANSIENT_MESSAGE = "No hubo respuesta de Kova; la venta sigue guardada y se reintentará.";
const SESSION_MESSAGE = "La sesión necesita verificarse; la venta sigue guardada y se enviará después.";
const REJECTED_MESSAGE = "No pudimos registrar esta venta en Kova. Sigue guardada en este dispositivo; revisa sus productos y pagos antes de reintentar.";
const TOO_LARGE_MESSAGE = "Esta venta es demasiado grande para enviarse. Sigue guardada en este dispositivo; contacta a soporte para registrarla.";
// Whole-request content errors: bisect the batch to isolate the sale at fault.
const SPLITTABLE_STATUSES = new Set([400, 413, 422]);
const ORDER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readSyncResults(body: unknown, tenantId: string, items: OfflineSaleQueueItem[]): ApiSyncResult[] {
  const invalidResponse = () => new Error(
    "La respuesta de sincronización está incompleta o no es válida; se reintentará.",
  );
  if (!body || typeof body !== "object" || !("results" in body) || !Array.isArray(body.results)) {
    throw invalidResponse();
  }

  const expected = new Set(items.map((item) => item.client_uuid));
  const origins = new Map(items.map((item) => [item.client_uuid, item.branch_id ?? tenantId]));
  for (const result of body.results) {
    if (
      !result || typeof result !== "object" ||
      typeof result.client_uuid !== "string" || !expected.delete(result.client_uuid) ||
      (result.status !== "synced" && result.status !== "failed") ||
      (result.status === "synced" && (
        typeof result.order_id !== "string" || !ORDER_ID_PATTERN.test(result.order_id)
      )) ||
      (result.order_id != null && typeof result.order_id !== "string") ||
      (result.error != null && typeof result.error !== "string") ||
      (result.order != null && (
        typeof result.order !== "object" ||
        result.order.id !== result.order_id || result.order.tenant_id !== tenantId ||
        (result.order.branch_id != null && result.order.branch_id !== origins.get(result.client_uuid))
      ))
    ) {
      throw invalidResponse();
    }
  }
  if (expected.size > 0) throw invalidResponse();

  return body.results as ApiSyncResult[];
}

export function parseRetryAfterMs(header: string | null): number {
  if (!header) return DEFAULT_RETRY_AFTER_MS;
  // Retry-After is either delta-seconds or an HTTP date.
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const dateMs = Date.parse(header);
  if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());
  return DEFAULT_RETRY_AFTER_MS;
}

/** Release leases without spending retry budget: the sale is not at fault. */
function releaseAttempts(tenantId: string, items: OfflineSaleQueueItem[], message: string) {
  return Promise.all(items.map((item) =>
    rollbackOfflineSaleAttempt(tenantId, item.client_uuid, item.lease_id!, message),
  ));
}

async function syncInHalves(tenantId: string, items: OfflineSaleQueueItem[]): Promise<SyncItemResult[]> {
  const middle = Math.ceil(items.length / 2);
  const first = items.slice(0, middle);
  const second = items.slice(middle);
  let firstResults: SyncItemResult[];
  try {
    firstResults = await syncOfflineSales(tenantId, first);
  } catch (err) {
    // The second half is still leased by us; hand it back before unwinding.
    await releaseAttempts(tenantId, second, TRANSIENT_MESSAGE);
    throw err;
  }
  return [...firstResults, ...await syncOfflineSales(tenantId, second)];
}

async function handleRejectedBatch(
  tenantId: string,
  items: OfflineSaleQueueItem[],
  response: Response,
): Promise<SyncItemResult[]> {
  const status = response.status;
  if (status === 402) {
    const error = new BillingAccessError();
    await releaseAttempts(tenantId, items, error.message);
    throw error;
  }
  // 429: release without burning a retry and let the worker honor Retry-After
  // instead of sending the remaining chunks as a burst of 429s.
  if (status === 429) {
    await releaseAttempts(tenantId, items, TRANSIENT_MESSAGE);
    throw new RateLimitError("Rate limited; will retry on next sync.", parseRetryAfterMs(response.headers.get("Retry-After")));
  }
  if (status >= 500 || status === 408) {
    await releaseAttempts(tenantId, items, TRANSIENT_MESSAGE);
    throw new SyncTransientError(`Sync failed with status ${status}`, status);
  }
  if (SPLITTABLE_STATUSES.has(status)) {
    if (items.length > 1) return syncInHalves(tenantId, items);
    // A single sale the server refuses as a whole is a definitive rejection.
    const [item] = items;
    const tooLarge = status === 413;
    const message = tooLarge ? TOO_LARGE_MESSAGE : REJECTED_MESSAGE;
    const errorCode = tooLarge ? "SYNC_PAYLOAD_TOO_LARGE" : "SYNC_REJECTED";
    await markOfflineSaleFailed(tenantId, item.client_uuid, item.lease_id!, message, errorCode);
    return [{ client_uuid: item.client_uuid, status: "failed", order_id: null, order: null, error: message, error_code: errorCode }];
  }
  // 401/403 (session or CSRF), 409 (identity mismatch), 404/405/415 (deploy
  // mismatch)… none of these describe a sale. Keep every sale pending.
  const error = new SyncSessionError(status);
  await releaseAttempts(tenantId, items, error.kind === "session" ? SESSION_MESSAGE : TRANSIENT_MESSAGE);
  throw error;
}

export async function syncOfflineSales(
  tenantId: string,
  items: OfflineSaleQueueItem[],
): Promise<SyncItemResult[]> {
  if (items.some((item) => item.tenant_id !== tenantId || !item.lease_id)) {
    throw new Error("Offline sync batch is not owned and leased by the active tenant");
  }
  if (getActiveOfflineTenant() !== tenantId) {
    await Promise.all(items.map((item) =>
      markOfflineSaleStatus(
        tenantId,
        item.client_uuid,
        item.lease_id!,
        "pending",
        "La sesión cambió antes de sincronizar.",
      ),
    ));
    throw new Error("Authenticated tenant changed before offline sync");
  }

  const controller = new AbortController();
  let timedOut = false;
  // A hung request must not hold the leases until they expire (and another tab
  // resends): abort it, release the batch and let the worker back off.
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, SYNC_REQUEST_TIMEOUT_MS);
  // The listener also aborts an in-flight request if logout/login changes
  // ownership while the network is pending.
  const unsubscribe = onActiveOfflineTenantChange((activeTenant) => {
    if (activeTenant !== tenantId) controller.abort();
  });
  let response: Response;
  let body: unknown;
  try {
    if (getActiveOfflineTenant() !== tenantId) controller.abort();
    response = await fetch("/api/v1/sync/offline-sales", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...csrfHeaders("POST") },
      credentials: "include",
      signal: controller.signal,
      body: JSON.stringify({
        sales: items.map((item) => ({
          client_uuid: item.client_uuid,
          ...(item.branch_id ? { branch_id: item.branch_id } : {}),
          order: item.sale,
          ...(item.lot_reconciliation ? { lot_reconciliation: item.lot_reconciliation } : {}),
          ...(item.shift_id ? { shift_id: item.shift_id } : {}),
          ...(item.created_at ? { occurred_at: item.created_at } : {}),
        })),
      }),
    });
    if (response.ok) body = await response.json();
  } catch (err) {
    // Network failure, timeout, abort or an unreadable body (e.g. a captive
    // portal page). The outcome is unknown but replaying the same UUIDs is
    // safe, so release every lease without consuming retry budget.
    await releaseAttempts(tenantId, items, TRANSIENT_MESSAGE);
    throw timedOut ? new SyncTimeoutError() : err;
  } finally {
    clearTimeout(timer);
    unsubscribe();
  }

  if (!response.ok) return handleRejectedBatch(tenantId, items, response);

  // Validate the entire acknowledgement before releasing any lease. A partial
  // or malformed 200 must not strand omitted sales in `syncing`, or turn an
  // unknown result into a dead letter. Replaying the original UUIDs is safe
  // even when the server already committed some sales from this batch. This
  // keeps the attempt: a server repeatedly answering nonsense is bounded.
  let apiResults: ApiSyncResult[];
  try {
    apiResults = readSyncResults(body, tenantId, items);
  } catch (err) {
    await Promise.all(items.map((item) =>
      markOfflineSaleStatus(tenantId, item.client_uuid, item.lease_id!, "pending", TRANSIENT_MESSAGE),
    ));
    throw err;
  }

  const results: SyncItemResult[] = [];
  for (const result of apiResults) {
    const item = items.find((candidate) => candidate.client_uuid === result.client_uuid);
    if (!item) continue;
    if (result.status === "synced") {
      await markOfflineSaleSynced(tenantId, result.client_uuid, item.lease_id!, result.order_id ?? undefined);
      results.push({ ...result, status: "synced" });
    } else {
      if (result.error_code) await markOfflineSaleFailed(tenantId, result.client_uuid, item.lease_id!, result.error ?? "Sync failed", result.error_code);
      else await markOfflineSaleFailed(tenantId, result.client_uuid, item.lease_id!, result.error ?? "Sync failed");
      results.push({ ...result, status: "failed", order_id: null, order: null });
    }
  }
  return results;
}
