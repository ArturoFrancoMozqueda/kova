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

type ApiSyncResult = {
  client_uuid: string;
  status: "synced" | "failed";
  order_id: string | null;
  order: Order | null;
  error: string | null;
};

export type SyncItemResult = {
  client_uuid: string;
  status: "synced" | "failed";
  order_id: string | null;
  order: Order | null;
  error: string | null;
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

const DEFAULT_RETRY_AFTER_MS = 60_000;
const ORDER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readSyncResults(body: unknown, tenantId: string, items: OfflineSaleQueueItem[]): ApiSyncResult[] {
  const invalidResponse = () => new Error(
    "La respuesta de sincronización está incompleta o no es válida; se reintentará.",
  );
  if (!body || typeof body !== "object" || !("results" in body) || !Array.isArray(body.results)) {
    throw invalidResponse();
  }

  const expected = new Set(items.map((item) => item.client_uuid));
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
        result.order.id !== result.order_id || result.order.tenant_id !== tenantId
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

  let apiResults: ApiSyncResult[];

  try {
    const controller = new AbortController();
    const unsubscribe = onActiveOfflineTenantChange((activeTenant) => {
      if (activeTenant !== tenantId) controller.abort();
    });
    // Revalidate immediately before fetch. The listener also aborts an in-flight
    // request if logout/login changes ownership while the network is pending.
    if (getActiveOfflineTenant() !== tenantId) controller.abort();
    let response: Response;
    try {
      response = await fetch("/api/v1/sync/offline-sales", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...csrfHeaders("POST") },
        credentials: "include",
        signal: controller.signal,
        body: JSON.stringify({
          sales: items.map((item) => ({
            client_uuid: item.client_uuid,
            order: item.sale,
            ...(item.shift_id ? { shift_id: item.shift_id } : {}),
            ...(item.created_at ? { occurred_at: item.created_at } : {}),
          })),
        }),
      });
    } finally {
      unsubscribe();
    }

    if (!response.ok) {
      // 429: server rate-limited us. Don't dead-letter the sales — mark them
      // back to pending so the next sync attempt retries within the same
      // queue. Any other 4xx/5xx is a real failure and goes to dead letter.
      if (response.status === 429) {
        const message = "Rate limited; will retry on next sync.";
        for (const item of items) {
          await rollbackOfflineSaleAttempt(tenantId, item.client_uuid, item.lease_id!, message);
        }
        // Signal the worker so it schedules a Retry-After-honoring retry and
        // stops sending the remaining chunks (a big backlog must not turn into
        // a burst of 429s).
        throw new RateLimitError(message, parseRetryAfterMs(response.headers.get("Retry-After")));
      }
      const message = `Sync failed with status ${response.status}`;
      if (response.status >= 500) {
        await Promise.all(items.map((item) =>
          markOfflineSaleStatus(tenantId, item.client_uuid, item.lease_id!, "pending", message),
        ));
        throw new Error(message);
      }
      await Promise.all(items.map((item) =>
        markOfflineSaleFailed(tenantId, item.client_uuid, item.lease_id!, message),
      ));
      return items.map((item) => ({
        client_uuid: item.client_uuid,
        status: "failed" as const,
        order_id: null,
        order: null,
        error: message,
      }));
    }

    // Validate the entire acknowledgement before releasing any lease. A partial
    // or malformed 200 must not strand omitted sales in `syncing`, or turn an
    // unknown result into a dead letter. Replaying the original UUIDs is safe
    // even when the server already committed some sales from this batch.
    apiResults = readSyncResults(await response.json(), tenantId, items);
  } catch (err) {
    // Network error — mark back to pending so sync worker can retry
    for (const item of items) {
      await markOfflineSaleStatus(
        tenantId,
        item.client_uuid,
        item.lease_id!,
        "pending",
        err instanceof Error ? err.message : "Network error",
      );
    }
    throw err;
  }

  const results: SyncItemResult[] = [];
  for (const result of apiResults) {
    if (result.status === "synced") {
      const item = items.find((candidate) => candidate.client_uuid === result.client_uuid);
      if (!item) continue;
      await markOfflineSaleSynced(tenantId, result.client_uuid, item.lease_id!, result.order_id ?? undefined);
      results.push({ ...result, status: "synced" });
    } else {
      const item = items.find((candidate) => candidate.client_uuid === result.client_uuid);
      if (!item) continue;
      await markOfflineSaleFailed(tenantId, result.client_uuid, item.lease_id!, result.error ?? "Sync failed");
      results.push({ ...result, status: "failed", order_id: null, order: null });
    }
  }
  return results;
}
